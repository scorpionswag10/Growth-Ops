import { PrismaClient } from "@growthops/db";

/**
 * Integration test — needs the local dev Postgres running (`pnpm pg:start`).
 * This is the single most important guarantee in the whole platform: a
 * missing tenant filter must be physically incapable of leaking another
 * client's data. Every prior verification of this was done by hand with
 * psql over the course of the build; this codifies it so a future schema
 * change that forgets to add a table to rls.sql fails a test, not a client.
 */
describe("Row-Level Security tenant isolation", () => {
  // superuser: bypasses RLS, used only to set up and tear down fixtures.
  const admin = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_DATABASE_URL } },
  });
  // app role: the same non-BYPASSRLS credential the running API uses.
  const app = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  let locationA: string;
  let locationB: string;

  beforeAll(async () => {
    const a = await admin.location.create({ data: { name: "RLS Test Tenant A" } });
    const b = await admin.location.create({ data: { name: "RLS Test Tenant B" } });
    locationA = a.id;
    locationB = b.id;
    await admin.contact.create({
      data: { locationId: locationA, email: "a-contact@example.com" },
    });
    await admin.contact.create({
      data: { locationId: locationB, email: "b-contact@example.com" },
    });
  });

  afterAll(async () => {
    await admin.location.deleteMany({ where: { id: { in: [locationA, locationB] } } });
    await admin.$disconnect();
    await app.$disconnect();
  });

  it("returns zero rows with no tenant context, even though data exists", async () => {
    const rows = await app.contact.findMany({
      where: { id: { in: await contactIds() } },
    });
    expect(rows).toHaveLength(0);
  });

  it("returns only the scoped tenant's rows when app.location_id is set", async () => {
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.location_id = '${locationA}'`);
      return tx.contact.findMany({});
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("a-contact@example.com");
  });

  it("never returns another tenant's row even when scoped", async () => {
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.location_id = '${locationA}'`);
      return tx.contact.findMany({});
    });
    expect(rows.some((r) => r.email === "b-contact@example.com")).toBe(false);
  });

  it("switching the scope to tenant B switches visibility, not additively", async () => {
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.location_id = '${locationB}'`);
      return tx.contact.findMany({});
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("b-contact@example.com");
  });

  it("rejects writing a row into a different tenant than the active scope", async () => {
    await expect(
      app.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.location_id = '${locationA}'`);
        // WITH CHECK on the policy must reject this: locationId doesn't
        // match the scoped tenant, so the write itself is invalid, not just
        // invisible afterward.
        return tx.contact.create({
          data: { locationId: locationB, email: "smuggled@example.com" },
        });
      }),
    ).rejects.toThrow();
  });

  async function contactIds(): Promise<string[]> {
    const rows = await admin.contact.findMany({
      where: { locationId: { in: [locationA, locationB] } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
});
