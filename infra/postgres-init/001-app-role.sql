-- The API connects as growthops_app: a non-superuser WITHOUT BYPASSRLS, so
-- Row-Level Security policies actually apply to every query the app makes.
-- Migrations (prisma db push) run as postgres via DIRECT_DATABASE_URL.
CREATE ROLE growthops_app LOGIN PASSWORD 'growthops_app' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE growthops TO growthops_app;

\connect growthops

GRANT USAGE ON SCHEMA public TO growthops_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO growthops_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO growthops_app;
