import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Job, Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { SocialPost } from "@growthops/db";
import { PrismaService } from "../prisma/prisma.service";
import { PostizPublisherService } from "./postiz-publisher.service";

const QUEUE = "social-posts";
export const PLATFORMS = ["facebook", "instagram", "gbp", "tiktok"] as const;

/**
 * A publishing provider (Ayrshare, or direct Meta/GBP/TikTok apps) implements
 * this and registers itself. Until one exists the module is wired but dark:
 * scheduled posts reach publish time and fail loudly with a clear error.
 */
export interface SocialPublisher {
  publish(post: SocialPost): Promise<{ providerRef?: string }>;
}

interface PublishJob {
  postId: string;
  locationId: string;
  scheduledAtMs: number; // reschedule guard: stale jobs no-op
}

@Injectable()
export class SocialService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Social");
  private queue!: Queue<PublishJob>;
  private worker!: Worker<PublishJob>;
  private publisher: SocialPublisher | null = null;

  constructor(
    private prisma: PrismaService,
    private postizPublisher: PostizPublisherService,
  ) {}

  registerPublisher(publisher: SocialPublisher) {
    this.publisher = publisher;
  }

  onModuleInit() {
    const connection = new IORedis(
      process.env.REDIS_URL ?? "redis://localhost:6380",
      { maxRetriesPerRequest: null },
    );
    this.queue = new Queue<PublishJob>(QUEUE, { connection });
    this.worker = new Worker<PublishJob>(
      QUEUE,
      (job) => this.publish(job),
      { connection: connection.duplicate(), concurrency: 3 },
    );
    if (this.postizPublisher.isConfigured()) {
      this.registerPublisher(this.postizPublisher);
    } else {
      this.log.warn(
        "POSTIZ_API_URL/POSTIZ_API_KEY not set — social publishing is inert",
      );
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  async create(
    locationId: string,
    dto: {
      content: string;
      platforms: string[];
      scheduledAt?: string;
      mediaUrls?: string[];
    },
  ) {
    const bad = dto.platforms.filter(
      (p) => !PLATFORMS.includes(p as (typeof PLATFORMS)[number]),
    );
    if (bad.length) {
      throw new BadRequestException(`Unknown platform(s): ${bad.join(", ")}`);
    }
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    if (scheduledAt && scheduledAt.getTime() < Date.now() - 60_000) {
      throw new BadRequestException("scheduledAt is in the past");
    }
    const post = await this.prisma.withLocation(locationId, (tx) =>
      tx.socialPost.create({
        data: {
          locationId,
          content: dto.content,
          platforms: dto.platforms,
          mediaUrls: dto.mediaUrls ?? [],
          scheduledAt,
          status: scheduledAt ? "SCHEDULED" : "DRAFT",
        },
      }),
    );
    if (scheduledAt) await this.enqueue(post.id, locationId, scheduledAt);
    return post;
  }

  list(locationId: string) {
    return this.prisma.withLocation(locationId, (tx) =>
      tx.socialPost.findMany({
        orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
        take: 200,
      }),
    );
  }

  async update(
    locationId: string,
    postId: string,
    dto: { content?: string; scheduledAt?: string | null; cancel?: boolean },
  ) {
    const post = await this.prisma.withLocation(locationId, (tx) =>
      tx.socialPost.findUnique({ where: { id: postId } }),
    );
    if (!post) throw new NotFoundException("Post not found");
    if (post.status === "PUBLISHED") {
      throw new BadRequestException("Published posts cannot be edited");
    }

    let scheduledAt = post.scheduledAt;
    let status = post.status;
    if (dto.cancel) {
      scheduledAt = null;
      status = "DRAFT";
    } else if (dto.scheduledAt !== undefined) {
      scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
      status = scheduledAt ? "SCHEDULED" : "DRAFT";
    }

    const updated = await this.prisma.withLocation(locationId, (tx) =>
      tx.socialPost.update({
        where: { id: postId },
        data: {
          content: dto.content ?? post.content,
          scheduledAt,
          status,
          error: null,
        },
      }),
    );
    // A stale queue job for the old time no-ops via the scheduledAtMs guard.
    if (status === "SCHEDULED" && scheduledAt) {
      await this.enqueue(postId, locationId, scheduledAt);
    }
    return updated;
  }

  async remove(locationId: string, postId: string) {
    await this.prisma.withLocation(locationId, (tx) =>
      tx.socialPost.delete({ where: { id: postId } }),
    );
    return { deleted: postId };
  }

  listIntegrations(locationId: string) {
    return this.prisma.withLocation(locationId, (tx) =>
      tx.socialIntegration.findMany({ orderBy: { platform: "asc" } }),
    );
  }

  setIntegration(
    locationId: string,
    platform: string,
    postizIntegrationId: string,
  ) {
    if (!PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) {
      throw new BadRequestException(`Unknown platform: ${platform}`);
    }
    return this.prisma.withLocation(locationId, (tx) =>
      tx.socialIntegration.upsert({
        where: { locationId_platform: { locationId, platform } },
        create: { locationId, platform, postizIntegrationId },
        update: { postizIntegrationId },
      }),
    );
  }

  async removeIntegration(locationId: string, platform: string) {
    await this.prisma.withLocation(locationId, (tx) =>
      tx.socialIntegration.delete({
        where: { locationId_platform: { locationId, platform } },
      }),
    );
    return { deleted: platform };
  }

  private async enqueue(postId: string, locationId: string, at: Date) {
    await this.queue.add(
      "publish",
      { postId, locationId, scheduledAtMs: at.getTime() },
      {
        delay: Math.max(0, at.getTime() - Date.now()),
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  }

  private async publish(job: Job<PublishJob>) {
    const { postId, locationId, scheduledAtMs } = job.data;
    const post = await this.prisma.withLocation(locationId, (tx) =>
      tx.socialPost.findUnique({ where: { id: postId } }),
    );
    if (
      !post ||
      post.status !== "SCHEDULED" ||
      post.scheduledAt?.getTime() !== scheduledAtMs
    ) {
      return; // deleted, cancelled, or rescheduled — this job is stale
    }
    if (!this.publisher) {
      await this.prisma.withLocation(locationId, (tx) =>
        tx.socialPost.update({
          where: { id: postId },
          data: {
            status: "FAILED",
            error:
              "No publishing provider configured yet (Ayrshare or platform APIs pending)",
          },
        }),
      );
      this.log.warn(`post ${postId}: publish attempted with no provider`);
      return;
    }
    try {
      const result = await this.publisher.publish(post);
      await this.prisma.withLocation(locationId, (tx) =>
        tx.socialPost.update({
          where: { id: postId },
          data: {
            status: "PUBLISHED",
            publishedAt: new Date(),
            providerRef: result.providerRef,
          },
        }),
      );
    } catch (err) {
      await this.prisma.withLocation(locationId, (tx) =>
        tx.socialPost.update({
          where: { id: postId },
          data: {
            status: "FAILED",
            error: err instanceof Error ? err.message : String(err),
          },
        }),
      );
    }
  }
}
