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

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cost_events',
    'contacts',
    'custom_field_defs',
    'pipelines',
    'pipeline_stages',
    'opportunities',
    'conversations',
    'messages',
    'calendars',
    'appointments'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("locationId" = current_setting(''app.location_id'', true)::uuid)
         WITH CHECK ("locationId" = current_setting(''app.location_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;

-- Double-booking is impossible at the database level: two CONFIRMED
-- appointments on the same calendar can never overlap, no matter what the
-- application layer does. prisma db push may drop this; rerunning this file
-- (pnpm db:rls) always restores it.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS no_double_booking;
ALTER TABLE "appointments" ADD CONSTRAINT no_double_booking
  EXCLUDE USING gist (
    "calendarId" WITH =,
    tstzrange("startsAt", "endsAt") WITH &&
  ) WHERE (status = 'CONFIRMED');
