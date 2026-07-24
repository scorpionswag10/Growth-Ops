import { Container, getContainer } from "@cloudflare/containers";

// Runs the self-hosted Postiz social-scheduling app as a single, always-on
// Cloudflare Container — the free alternative to Ayrshare. GrowthOps CRM's
// own SocialPublisher will call this instance's REST API.
export class PostizContainer extends Container<Env> {
  defaultPort = 5000;

  constructor(ctx: DurableObjectState<Env>, env: Env) {
    super(ctx, env);
    this.envVars = {
      DATABASE_URL: env.POSTIZ_DATABASE_URL ?? "",
      // Redis runs co-located inside this same container (see
      // Dockerfile.postiz) — Upstash's free tier only allows one
      // database per account, already used by GrowthOps CRM's own
      // BullMQ queue.
      REDIS_URL: "redis://localhost:6379",
      JWT_SECRET: env.JWT_SECRET ?? "",
      FRONTEND_URL: "https://postiz.scorpionswag10.workers.dev",
      NEXT_PUBLIC_BACKEND_URL: "https://postiz.scorpionswag10.workers.dev/api",
      // Internal-to-the-container address, per Postiz's own reference
      // config — not something we route externally.
      BACKEND_INTERNAL_URL: "http://localhost:3000",
      STORAGE_PROVIDER: "cloudflare",
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID ?? "",
      CLOUDFLARE_ACCESS_KEY: env.CLOUDFLARE_ACCESS_KEY ?? "",
      CLOUDFLARE_SECRET_ACCESS_KEY: env.CLOUDFLARE_SECRET_ACCESS_KEY ?? "",
      CLOUDFLARE_BUCKETNAME: "postiz-media",
      CLOUDFLARE_BUCKET_URL: env.CLOUDFLARE_BUCKET_URL ?? "",
      CLOUDFLARE_REGION: "auto",
    };
  }

  override onStart() {
    console.log("Postiz container started");
  }

  override onStop() {
    console.log("Postiz container stopped");
  }

  override onError(error: unknown) {
    console.log("Postiz container error:", error);
  }

  // Keep it warm, matching the growthops-api container — scheduled posts
  // need the queue worker inside Postiz running continuously, not just
  // answering requests.
  override async onActivityExpired() {}
}

interface Env {
  POSTIZ_CONTAINER: DurableObjectNamespace<PostizContainer>;
  POSTIZ_DATABASE_URL?: string;
  JWT_SECRET?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ACCESS_KEY?: string;
  CLOUDFLARE_SECRET_ACCESS_KEY?: string;
  CLOUDFLARE_BUCKET_URL?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.POSTIZ_CONTAINER, "primary");
    return container.fetch(request);
  },
};
