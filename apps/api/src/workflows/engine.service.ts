import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Job, Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { Prisma } from "@growthops/db";
import { PrismaService } from "../prisma/prisma.service";
import { ConversationsService } from "../conversations/conversations.service";
import { ContactsService } from "../contacts/contacts.service";
import { zonedTimeToUtc, dateStrInTz, formatInTz } from "../booking/tz";
import { WorkflowStep } from "./templates";

const QUEUE = "workflow-steps";
const QUIET_START_HOUR = 21; // no client-facing sends 9pm–8am local
const QUIET_END_HOUR = 8;

interface StepJob {
  executionId: string;
  locationId: string;
  stepIndex: number;
}

/**
 * The durable workflow engine. Every step is one idempotent BullMQ job;
 * waits are delayed jobs, so a 3-day pause survives restarts. State lives in
 * WorkflowExecution rows; the step list is the enrollment-time snapshot, so
 * editing a workflow never mutates in-flight runs.
 */
@Injectable()
export class EngineService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("WorkflowEngine");
  private queue!: Queue<StepJob>;
  private worker!: Worker<StepJob>;

  constructor(
    private prisma: PrismaService,
    private conversations: ConversationsService,
    private contacts: ContactsService,
  ) {}

  onModuleInit() {
    const connection = new IORedis(
      process.env.REDIS_URL ?? "redis://localhost:6380",
      { maxRetriesPerRequest: null },
    );
    this.queue = new Queue<StepJob>(QUEUE, { connection });
    this.worker = new Worker<StepJob>(
      QUEUE,
      (job) => this.process(job),
      { connection: connection.duplicate(), concurrency: 5 },
    );
    this.worker.on("failed", (job, err) =>
      this.log.error(`step job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  async schedule(jobData: StepJob, delayMs = 0) {
    await this.queue.add("step", jobData, {
      delay: Math.max(0, delayMs),
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
    });
  }

  private async process(job: Job<StepJob>) {
    const { executionId, locationId, stepIndex } = job.data;

    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
    });
    if (!location) return;

    const execution = await this.prisma.withLocation(locationId, (tx) =>
      tx.workflowExecution.findUnique({
        where: { id: executionId },
        include: { contact: true },
      }),
    );
    // Idempotency and cancellation: only act on the exact step the row expects.
    if (
      !execution ||
      (execution.status !== "RUNNING" && execution.status !== "WAITING") ||
      execution.currentStep !== stepIndex
    ) {
      return;
    }

    const steps = execution.stepsSnapshot as unknown as WorkflowStep[];
    const step = steps[stepIndex];
    if (!step) {
      await this.setExecution(locationId, executionId, {
        status: "COMPLETED",
        resumeAt: null,
      });
      return;
    }

    const ctx = (execution.context ?? {}) as Record<string, unknown>;

    try {
      switch (step.type) {
        case "wait": {
          const ms =
            (step.seconds ?? 0) * 1_000 +
            (step.minutes ?? 0) * 60_000 +
            (step.hours ?? 0) * 3_600_000 +
            (step.days ?? 0) * 86_400_000;
          await this.advance(locationId, executionId, stepIndex, steps.length, {
            status: "WAITING",
            resumeAt: new Date(Date.now() + ms),
          });
          await this.schedule({ executionId, locationId, stepIndex: stepIndex + 1 }, ms);
          return;
        }
        case "wait_until": {
          const anchorIso = ctx.appointmentStartsAt as string | undefined;
          if (!anchorIso) throw new Error("no appointment anchor in context");
          const target =
            new Date(anchorIso).getTime() + step.offsetHours * 3_600_000;
          const ms = target - Date.now();
          if (ms <= 0) {
            // Anchor already passed (e.g. booked 1h before a -24h reminder):
            // skip this wait rather than firing a stale message instantly...
            // but only skip the WAIT; the next step still runs at the later
            // anchor if there is one. Skipping to next step immediately.
            await this.advance(locationId, executionId, stepIndex, steps.length, {
              status: "RUNNING",
              resumeAt: null,
            });
            await this.schedule({ executionId, locationId, stepIndex: stepIndex + 1 }, 0);
            return;
          }
          await this.advance(locationId, executionId, stepIndex, steps.length, {
            status: "WAITING",
            resumeAt: new Date(target),
          });
          await this.schedule({ executionId, locationId, stepIndex: stepIndex + 1 }, ms);
          return;
        }
        case "send_message": {
          if (step.channel !== "NOTE") {
            const delayMs = this.quietHoursDelayMs(location.timezone);
            if (delayMs > 0) {
              // Requeue this same step at the location's next 8am. TCPA-style
              // quiet hours are a hard gate, not a preference.
              await this.setExecution(locationId, executionId, {
                status: "WAITING",
                resumeAt: new Date(Date.now() + delayMs),
              });
              await this.schedule({ executionId, locationId, stepIndex }, delayMs);
              return;
            }
          }
          const body = this.render(step.template, {
            firstName: execution.contact.firstName ?? "there",
            businessName: location.name,
            appointmentTime: ctx.appointmentStartsAt
              ? formatInTz(new Date(ctx.appointmentStartsAt as string), location.timezone)
              : "",
          });
          try {
            await this.conversations.send(
              location,
              execution.contactId,
              step.channel,
              body,
            );
          } catch (err) {
            // Dark channel or provider failure: the message row is already
            // recorded as FAILED by ConversationsService; log on the
            // execution and keep going — a nurture sequence should not die
            // because one send bounced.
            const errors = (ctx.errors as unknown[] | undefined) ?? [];
            errors.push({
              step: stepIndex,
              error: err instanceof Error ? err.message : String(err),
              at: new Date().toISOString(),
            });
            ctx.errors = errors;
          }
          break;
        }
        case "add_tag": {
          await this.contacts.addTags(locationId, execution.contactId, step.tags);
          break;
        }
      }

      // Instant steps fall through to here: advance and run the next one.
      const nextIndex = stepIndex + 1;
      const done = nextIndex >= steps.length;
      await this.setExecution(locationId, executionId, {
        currentStep: nextIndex,
        context: ctx as Prisma.InputJsonValue,
        status: done ? "COMPLETED" : "RUNNING",
        resumeAt: null,
      });
      if (!done) {
        await this.schedule({ executionId, locationId, stepIndex: nextIndex }, 0);
      }
    } catch (err) {
      this.log.error(
        `execution ${executionId} step ${stepIndex}: ${err instanceof Error ? err.message : err}`,
      );
      await this.setExecution(locationId, executionId, { status: "FAILED" });
    }
  }

  private async advance(
    locationId: string,
    executionId: string,
    stepIndex: number,
    total: number,
    extra: { status: "WAITING" | "RUNNING"; resumeAt: Date | null },
  ) {
    await this.setExecution(locationId, executionId, {
      currentStep: stepIndex + 1,
      ...extra,
      ...(stepIndex + 1 >= total ? { status: "COMPLETED" as const } : {}),
    });
  }

  private setExecution(
    locationId: string,
    executionId: string,
    data: Prisma.WorkflowExecutionUpdateInput,
  ) {
    return this.prisma.withLocation(locationId, (tx) =>
      tx.workflowExecution.update({ where: { id: executionId }, data }),
    );
  }

  /** 0 when sends are allowed now; otherwise ms until the next 8am local. */
  private quietHoursDelayMs(timezone: string): number {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
    );
    if (hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR) return 0;
    const todayStr = dateStrInTz(new Date(), timezone);
    let next8 = zonedTimeToUtc(todayStr, "08:00", timezone);
    if (next8.getTime() <= Date.now()) {
      const tomorrow = dateStrInTz(new Date(Date.now() + 86_400_000), timezone);
      next8 = zonedTimeToUtc(tomorrow, "08:00", timezone);
    }
    return next8.getTime() - Date.now();
  }

  private render(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
  }
}
