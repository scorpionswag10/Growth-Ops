import { BadRequestException } from "@nestjs/common";
import { ContactsService, normalizePhone } from "./contacts.service";

describe("normalizePhone", () => {
  it("assumes US on a bare 10-digit number", () => {
    expect(normalizePhone("(713) 555-0142")).toBe("+17135550142");
    expect(normalizePhone("713-555-0142")).toBe("+17135550142");
    expect(normalizePhone("7135550142")).toBe("+17135550142");
  });

  it("keeps an already-E.164 number as-is", () => {
    expect(normalizePhone("+17135550142")).toBe("+17135550142");
  });

  it("adds + to an 11-digit number already carrying the US country code", () => {
    expect(normalizePhone("17135550142")).toBe("+17135550142");
  });
});

/**
 * Unit-level: fakes the transaction Prisma hands to withLocation() rather
 * than hitting a real database. This isolates the identity-resolution and
 * merge logic — the part most likely to silently regress — from RLS/network
 * concerns, which the integration test covers separately.
 */
function makeService() {
  const tx = {
    contact: {
      findFirst: jest.fn(),
      create: jest.fn((args: { data: Record<string, unknown> }) => ({
        id: "new-id",
        ...args.data,
      })),
      update: jest.fn((args: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: args.where.id,
        ...args.data,
      })),
    },
    customFieldDef: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = {
    withLocation: jest.fn((_locationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  };
  const events = { emit: jest.fn() };
  const service = new ContactsService(prisma as never, events as never);
  return { service, tx, prisma, events };
}

describe("ContactsService.upsert", () => {
  it("creates a new contact and emits contact.created when nothing matches", async () => {
    const { service, tx, events } = makeService();
    tx.contact.findFirst.mockResolvedValue(null);

    const contact = await service.upsert("loc-1", {
      email: "sarah@example.com",
      phone: "713-555-0142",
      tags: ["lead"],
    });

    expect(tx.contact.create).toHaveBeenCalledTimes(1);
    expect(contact).toMatchObject({ email: "sarah@example.com", phone: "+17135550142" });
    expect(events.emit).toHaveBeenCalledWith("contact.created", {
      locationId: "loc-1",
      contactId: "new-id",
    });
  });

  it("matches an existing contact by email and does not emit contact.created", async () => {
    const { service, tx, events } = makeService();
    tx.contact.findFirst.mockResolvedValueOnce({
      id: "existing-1",
      tags: ["lead"],
      customFields: {},
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
    });

    await service.upsert("loc-1", { email: "sarah@example.com", tags: ["hot"] });

    expect(tx.contact.update).toHaveBeenCalledTimes(1);
    expect(tx.contact.create).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it("unions tags instead of replacing them on merge", async () => {
    const { service, tx } = makeService();
    tx.contact.findFirst.mockResolvedValueOnce({
      id: "existing-1",
      tags: ["lead", "hot"],
      customFields: {},
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
    });

    await service.upsert("loc-1", { email: "sarah@example.com", tags: ["hot", "booking"] });

    const updateCall = tx.contact.update.mock.calls[0][0] as unknown as { data: { tags: string[] } };
    expect(new Set(updateCall.data.tags)).toEqual(new Set(["lead", "hot", "booking"]));
  });

  it("falls back to a phone match only when no email is given", async () => {
    const { service, tx } = makeService();
    tx.contact.findFirst.mockResolvedValueOnce({
      id: "existing-1",
      tags: [],
      customFields: {},
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
    });

    await service.upsert("loc-1", { phone: "713-555-0142" });

    expect(tx.contact.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.contact.findFirst).toHaveBeenCalledWith({ where: { phone: "+17135550142" } });
  });

  it("preserves first-touch UTM attribution instead of overwriting it", async () => {
    const { service, tx } = makeService();
    tx.contact.findFirst.mockResolvedValueOnce({
      id: "existing-1",
      tags: [],
      customFields: {},
      utmSource: "facebook",
      utmMedium: "paid-social",
      utmCampaign: "july-promo",
      utmContent: null,
      utmTerm: null,
    });

    await service.upsert("loc-1", {
      email: "sarah@example.com",
      utmSource: "google",
      utmCampaign: "different-campaign",
    });

    const updateCall = tx.contact.update.mock.calls[0][0] as unknown as {
      data: { utmSource: string; utmCampaign: string };
    };
    expect(updateCall.data.utmSource).toBe("facebook");
    expect(updateCall.data.utmCampaign).toBe("july-promo");
  });

  it("rejects an unknown custom field key", async () => {
    const { service, tx } = makeService();
    tx.contact.findFirst.mockResolvedValue(null);
    tx.customFieldDef.findMany.mockResolvedValue([
      { key: "service_interest", type: "SELECT", options: ["whitening"] },
    ]);

    await expect(
      service.upsert("loc-1", { email: "x@y.com", customFields: { nope: 1 } }),
    ).rejects.toThrow(BadRequestException);
  });
});
