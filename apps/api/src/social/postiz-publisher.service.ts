import { Injectable, Logger } from "@nestjs/common";
import { SocialPost } from "@growthops/db";
import { PrismaService } from "../prisma/prisma.service";
import { SocialPublisher } from "./social.service";

// GrowthOps calls it gbp; Postiz's own provider identifier is gmb.
const PLATFORM_TO_POSTIZ: Record<string, string> = { gbp: "gmb" };

/**
 * Publishes through a self-hosted Postiz instance's Public API
 * (see apps/backend/src/public-api in gitroomhq/postiz-app upstream).
 * Ships dark like the AI receptionist — inert until POSTIZ_API_URL and
 * POSTIZ_API_KEY are both set.
 */
@Injectable()
export class PostizPublisherService implements SocialPublisher {
  private readonly log = new Logger("PostizPublisher");
  private readonly baseUrl = process.env.POSTIZ_API_URL;
  private readonly apiKey = process.env.POSTIZ_API_KEY;

  constructor(private prisma: PrismaService) {}

  isConfigured(): boolean {
    return !!this.baseUrl && !!this.apiKey;
  }

  async publish(post: SocialPost): Promise<{ providerRef?: string }> {
    const integrations = await this.prisma.withLocation(
      post.locationId,
      (tx) =>
        tx.socialIntegration.findMany({
          where: {
            locationId: post.locationId,
            platform: { in: post.platforms },
          },
        }),
    );
    if (!integrations.length) {
      throw new Error(
        `No connected Postiz account for platform(s): ${post.platforms.join(", ")}`,
      );
    }
    const missing = post.platforms.filter(
      (p) => !integrations.some((i) => i.platform === p),
    );
    if (missing.length) {
      this.log.warn(
        `post ${post.id}: no connected account for ${missing.join(", ")}, publishing to the rest`,
      );
    }

    const image = post.mediaUrls.length
      ? await Promise.all(
          post.mediaUrls.map((url) => this.uploadFromUrl(url)),
        )
      : [];

    const body = {
      type: "now",
      shortLink: false,
      date: new Date().toISOString(),
      tags: [],
      posts: integrations.map((integration) => ({
        integration: { id: integration.postizIntegrationId },
        value: [{ content: post.content, image }],
        settings: {
          __type:
            PLATFORM_TO_POSTIZ[integration.platform] ?? integration.platform,
        },
      })),
    };

    const created = await this.request<Array<{ id?: string; group?: string }>>(
      "/public/v1/posts",
      { method: "POST", body: JSON.stringify(body) },
    );
    return { providerRef: created?.[0]?.group ?? created?.[0]?.id };
  }

  private uploadFromUrl(url: string): Promise<{ id: string; path: string }> {
    return this.request("/public/v1/upload-from-url", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey!,
      },
    });
    if (!res.ok) {
      throw new Error(
        `Postiz ${path} failed: ${res.status} ${await res.text()}`,
      );
    }
    return res.json() as Promise<T>;
  }
}
