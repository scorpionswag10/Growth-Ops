# GrowthOps CRM

Multi-tenant growth platform for appointment-based local businesses. One platform, many client locations. Full plan and build order live in the Brain Vault: `03 - GrowthOps/GrowthOps CRM.md`.

## Architecture ground rules

1. **Every tenant table carries `locationId`** and is protected twice: the `TenancyGuard` (membership check per request) and Postgres Row-Level Security (`packages/db/prisma/rls.sql`). The API's DB role (`growthops_app`) cannot bypass RLS. New tenant tables MUST be added to `rls.sql` in the same change.
2. **Tenant data access goes through `PrismaService.withLocation()`** — it sets the RLS context per-transaction. Outside it, tenant tables return zero rows by design.
3. **Features ship dark.** Capabilities are gated per-location via `Location.features` + `@RequireFeature()`. SMS gets built in Phase 2 but stays off per tenant until A2P 10DLC registration is approved.
4. **Every provider action logs a `CostEvent`** (idempotent on provider ref). Clients pay flat retainers; this ledger is internal margin visibility.

## Stack

TypeScript strict · Node 22 · NestJS · PostgreSQL 16 + Prisma (+ RLS) · Redis 7 + BullMQ (from Phase 4) · Next.js frontend (from Phase 1) · pnpm workspaces.

## Local dev

**This Mac (macOS 12):** Docker Desktop and colima are both unusable here (OS too old for Docker.app; no brew bottles for qemu). Working method: native PostgreSQL 16.14 binaries from Postgres.app v2.9.5, vendored at `infra/pg16/` (gitignored), data dir `infra/.pgdata/`, port **5433**. Redis is not needed until Phase 4 (BullMQ) — solve it then. On any modern machine, `pnpm infra:up` (Docker Compose) replaces all of this; ports and credentials match either way.

```bash
pnpm install
pnpm pg:start                      # native PG on :5433 (this Mac) — or: pnpm infra:up (Docker)
cp apps/api/.env.example apps/api/.env
cp packages/db/.env.example packages/db/.env    # Prisma CLI reads env from the schema's package
pnpm db:push                       # schema → DB (runs as postgres via DIRECT_DATABASE_URL)
pnpm db:rls                        # apply RLS policies (idempotent, rerun after every db:push)
pnpm dev                           # API on :3000
```

One-time on a fresh database (Docker does this automatically via `infra/postgres-init/`): run `infra/postgres-init/001-app-role.sql` as postgres to create the RLS-bound `growthops_app` role.

First registered user becomes the platform admin; registration closes after that.

## Build order

Phase 0 tenancy/auth/costs (this) → 1 contacts+pipeline → 2 SMS/email inbox → 3 booking → 4 workflows → 5 social publishing → 6 client dashboard → 7 AI receptionist.
