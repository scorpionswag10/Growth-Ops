import { Container, getContainer } from "@cloudflare/containers";

// Runs the existing NestJS API + BullMQ workers as a single, always-on
// Cloudflare Container. This repo has no separate worker process — BullMQ
// Workers (workflows/engine.service.ts, social/social.service.ts) run
// inside the same Nest app that serves HTTP — so the container must stay
// warm and keep consuming the job queue even with no inbound HTTP traffic,
// not idle-sleep between requests the way a purely request-driven
// container would.
export class ApiContainer extends Container<Env> {
  defaultPort = 8080;

  constructor(ctx: DurableObjectState<Env>, env: Env) {
    super(ctx, env);
    // Verified pattern (README example "MultiPortContainer"): a Container
    // subclass's constructor receives the Worker's bound `env`, which is
    // where `wrangler secret put` values land. Forwarding the app's real
    // runtime config into `envVars` here is how it reaches `process.env`
    // inside the running container — the full list matches every
    // `process.env.X` read in apps/api/src (grepped, not guessed).
    // DATABASE_URL specifically comes through the Hyperdrive binding, not
    // a plain secret — `env.HYPERDRIVE.connectionString` is the expected
    // shape but hasn't been verified against real Hyperdrive docs yet;
    // confirm this once Neon + Hyperdrive actually exist.
    this.envVars = {
      DATABASE_URL: env.HYPERDRIVE?.connectionString ?? "",
      REDIS_URL: env.REDIS_URL ?? "",
      JWT_SECRET: env.JWT_SECRET ?? "",
      JWT_ACCESS_TTL_SECONDS: env.JWT_ACCESS_TTL_SECONDS ?? "",
      REFRESH_TTL_DAYS: env.REFRESH_TTL_DAYS ?? "",
      AI_MODEL: env.AI_MODEL ?? "",
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ?? "",
      PUSH_VAPID_PUBLIC_KEY: env.PUSH_VAPID_PUBLIC_KEY ?? "",
      PUSH_VAPID_PRIVATE_KEY: env.PUSH_VAPID_PRIVATE_KEY ?? "",
      PUSH_VAPID_SUBJECT: env.PUSH_VAPID_SUBJECT ?? "",
    };
  }

  override onStart() {
    console.log("GrowthOps API container started");
  }

  override onStop() {
    console.log("GrowthOps API container stopped");
  }

  override onError(error: unknown) {
    console.log("GrowthOps API container error:", error);
  }

  // The base class's default onActivityExpired() calls this.stop() once
  // sleepAfter elapses with no HTTP activity. This container has to keep
  // running regardless — it's consuming the BullMQ queue continuously, not
  // just answering requests — so this deliberately does nothing instead of
  // calling super.onActivityExpired(). Verified against the installed
  // @cloudflare/containers source: there's no separate "never sleep" flag,
  // this override is the real mechanism.
  override async onActivityExpired() {}
}

interface Env {
  API_CONTAINER: DurableObjectNamespace<ApiContainer>;
  HYPERDRIVE?: { connectionString: string };
  REDIS_URL?: string;
  JWT_SECRET?: string;
  JWT_ACCESS_TTL_SECONDS?: string;
  REFRESH_TTL_DAYS?: string;
  AI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  PUSH_VAPID_PUBLIC_KEY?: string;
  PUSH_VAPID_PRIVATE_KEY?: string;
  PUSH_VAPID_SUBJECT?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Fixed name, not per-path — this is one persistent API+worker
    // process (matching how it already runs today), not a
    // per-resource-isolated container instance.
    const container = getContainer(env.API_CONTAINER, "primary");
    return container.fetch(request);
  },
};
