-- Row-Level Security for tenant-scoped tables.
-- Run after every `prisma db push` (pnpm db:rls). Idempotent.
--
-- The policy reads app.location_id, set per-transaction by
-- PrismaService.withLocation(). current_setting(..., true) returns NULL when
-- unset, which makes the policy false: no tenant context, no rows. Default deny.
--
-- Every future tenant table (contacts, conversations, messages, opportunities,
-- appointments, workflow_executions, social_posts, ...) MUST be added here in
-- the same change that creates it.

ALTER TABLE "cost_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "cost_events";
CREATE POLICY tenant_isolation ON "cost_events"
  USING ("locationId" = current_setting('app.location_id', true)::uuid)
  WITH CHECK ("locationId" = current_setting('app.location_id', true)::uuid);
