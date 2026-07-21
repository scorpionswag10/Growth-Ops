import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Prisma, WorkflowTrigger } from "@growthops/db";
import { PrismaService } from "../prisma/prisma.service";
import { EngineService } from "./engine.service";
import { AuditService } from "../audit/audit.service";
import { TEMPLATE_CATALOG, WorkflowStep } from "./templates";

export interface TriggerEvent {
  locationId: string;
  contactId: string;
  appointmentStartsAt?: string;
}

@Injectable()
export class WorkflowsService {
  private readonly log = new Logger("Workflows");

  constructor(
    private prisma: PrismaService,
    private engine: EngineService,
    private audit: AuditService,
  ) {}

  catalog() {
    return TEMPLATE_CATALOG.map(({ key, name, description, trigger }) => ({
      key,
      name,
      description,
      trigger,
    }));
  }

  async createFromTemplate(locationId: string, key: string, actorId: string) {
    const tpl = TEMPLATE_CATALOG.find((t) => t.key === key);
    if (!tpl) throw new NotFoundException("Unknown template");
    const workflow = await this.prisma.withLocation(locationId, (tx) =>
      tx.workflow.create({
        data: {
          locationId,
          name: tpl.name,
          trigger: tpl.trigger,
          steps: tpl.steps as unknown as Prisma.InputJsonValue,
          stopOnReply: tpl.stopOnReply,
          status: "PAUSED",
        },
      }),
    );
    await this.audit.log(locationId, actorId, "Automations", "workflow_installed", {
      targetLabel: tpl.name,
    });
    return workflow;
  }

  list(locationId: string) {
    return this.prisma.withLocation(locationId, (tx) =>
      tx.workflow.findMany({
        orderBy: { createdAt: "asc" },
        include: {
          _count: { select: { executions: true } },
        },
      }),
    );
  }

  async setStatus(
    locationId: string,
    workflowId: string,
    status: "ACTIVE" | "PAUSED",
    actorId: string,
  ) {
    const workflow = await this.prisma.withLocation(locationId, (tx) =>
      tx.workflow.update({ where: { id: workflowId }, data: { status } }),
    );
    await this.audit.log(
      locationId,
      actorId,
      "Automations",
      status === "ACTIVE" ? "workflow_resumed" : "workflow_paused",
      { targetLabel: workflow.name },
    );
    return workflow;
  }

  executions(locationId: string, workflowId: string) {
    return this.prisma.withLocation(locationId, (tx) =>
      tx.workflowExecution.findMany({
        where: { workflowId },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          contact: {
            select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          },
        },
      }),
    );
  }

  /** Manually enroll one contact (also the path MANUAL-trigger templates use). */
  async enrollManual(locationId: string, workflowId: string, contactId: string) {
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    const features = (location?.features ?? {}) as Record<string, unknown>;
    if (features.workflows !== true) {
      throw new BadRequestException("Feature 'workflows' is not enabled for this location");
    }
    const workflow = await this.prisma.withLocation(locationId, (tx) =>
      tx.workflow.findUnique({ where: { id: workflowId } }),
    );
    if (!workflow) throw new NotFoundException("Workflow not found");
    const execution = await this.enroll(locationId, workflow.id, contactId, {});
    if (!execution) {
      throw new BadRequestException("Contact already has an active run of this workflow");
    }
    return execution;
  }

  // ── Event-driven enrollment ─────────────────────────────────────────

  @OnEvent("contact.created")
  onContactCreated(e: TriggerEvent) {
    return this.fanOut("CONTACT_CREATED", e);
  }

  @OnEvent("appointment.booked")
  onAppointmentBooked(e: TriggerEvent) {
    return this.fanOut("APPOINTMENT_BOOKED", e);
  }

  @OnEvent("appointment.no_show")
  onNoShow(e: TriggerEvent) {
    return this.fanOut("APPOINTMENT_NO_SHOW", e);
  }

  @OnEvent("appointment.cancelled")
  onCancelled(e: TriggerEvent) {
    return this.fanOut("APPOINTMENT_CANCELLED", e);
  }

  @OnEvent("appointment.completed")
  onCompleted(e: TriggerEvent) {
    return this.fanOut("APPOINTMENT_COMPLETED", e);
  }

  /** Stop-on-reply: an inbound message cancels waiting nurture runs. */
  @OnEvent("message.inbound")
  async onInboundMessage(e: TriggerEvent) {
    try {
      const cancelled = await this.prisma.withLocation(e.locationId, (tx) =>
        tx.workflowExecution.updateMany({
          where: {
            contactId: e.contactId,
            status: { in: ["RUNNING", "WAITING"] },
            stopOnReply: true,
          },
          data: { status: "CANCELLED", resumeAt: null },
        }),
      );
      if (cancelled.count > 0) {
        this.log.log(
          `stop-on-reply: cancelled ${cancelled.count} execution(s) for contact ${e.contactId}`,
        );
      }
    } catch (err) {
      this.log.error(`stop-on-reply failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async fanOut(trigger: WorkflowTrigger, e: TriggerEvent) {
    try {
      const location = await this.prisma.location.findUnique({
        where: { id: e.locationId },
      });
      const features = (location?.features ?? {}) as Record<string, unknown>;
      if (features.workflows !== true) return; // ships dark, like everything

      const workflows = await this.prisma.withLocation(e.locationId, (tx) =>
        tx.workflow.findMany({
          where: { trigger, status: "ACTIVE" },
        }),
      );
      for (const wf of workflows) {
        await this.enroll(e.locationId, wf.id, e.contactId, {
          ...(e.appointmentStartsAt
            ? { appointmentStartsAt: e.appointmentStartsAt }
            : {}),
        });
      }
    } catch (err) {
      this.log.error(`fanOut(${trigger}) failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async enroll(
    locationId: string,
    workflowId: string,
    contactId: string,
    context: Record<string, unknown>,
  ) {
    return this.prisma.withLocation(locationId, async (tx) => {
      const workflow = await tx.workflow.findUnique({ where: { id: workflowId } });
      if (!workflow) return null;
      // Re-entry policy: one live run per workflow per contact.
      const existing = await tx.workflowExecution.findFirst({
        where: {
          workflowId,
          contactId,
          status: { in: ["RUNNING", "WAITING"] },
        },
      });
      if (existing) return null;

      const steps = workflow.steps as unknown as WorkflowStep[];
      if (!Array.isArray(steps) || steps.length === 0 || steps.length > 50) {
        return null;
      }
      const execution = await tx.workflowExecution.create({
        data: {
          locationId,
          workflowId,
          contactId,
          stepsSnapshot: steps as unknown as Prisma.InputJsonValue,
          stopOnReply: workflow.stopOnReply,
          context: context as Prisma.InputJsonValue,
        },
      });
      await this.engine.schedule(
        { executionId: execution.id, locationId, stepIndex: 0 },
        0,
      );
      return execution;
    });
  }
}
