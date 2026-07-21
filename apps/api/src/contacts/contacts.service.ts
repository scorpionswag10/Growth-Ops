import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { CustomFieldDef, Prisma } from "@growthops/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { UpsertContactDto } from "./dto";

/**
 * Normalize a phone number toward E.164. Bare 10-digit numbers are assumed US
 * (the entire ICP is US local businesses).
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

@Injectable()
export class ContactsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
    private audit: AuditService,
  ) {}

  /**
   * Upsert by identity: email match wins, then phone match, else create.
   * One person, one contact — however many channels they arrive through.
   */
  async upsert(locationId: string, dto: UpsertContactDto) {
    const email = dto.email?.toLowerCase();
    const phone = dto.phone ? normalizePhone(dto.phone) : undefined;

    const result = await this.prisma.withLocation(locationId, async (tx) => {
      if (dto.customFields) {
        await this.validateCustomFields(tx, dto.customFields);
      }

      let existing = null;
      if (email) {
        existing = await tx.contact.findFirst({ where: { email } });
      }
      if (!existing && phone) {
        existing = await tx.contact.findFirst({ where: { phone } });
      }

      const data = {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email,
        phone,
        source: dto.source,
        timezone: dto.timezone,
        dndSms: dto.dndSms,
        dndEmail: dto.dndEmail,
        tags: dto.tags,
        customFields: dto.customFields as Prisma.InputJsonValue | undefined,
      };

      if (existing) {
        const updated = await tx.contact.update({
          where: { id: existing.id },
          data: {
            ...data,
            // Merge, never clobber: absent fields keep their current values,
            // custom fields merge key-wise, tags union.
            customFields: {
              ...(existing.customFields as object),
              ...(dto.customFields ?? {}),
            } as Prisma.InputJsonValue,
            tags: dto.tags
              ? Array.from(new Set([...existing.tags, ...dto.tags]))
              : undefined,
            // First-touch attribution: keep the original utm values, never
            // let a later touch overwrite where this contact actually came from.
            utmSource: existing.utmSource ?? dto.utmSource,
            utmMedium: existing.utmMedium ?? dto.utmMedium,
            utmCampaign: existing.utmCampaign ?? dto.utmCampaign,
            utmContent: existing.utmContent ?? dto.utmContent,
            utmTerm: existing.utmTerm ?? dto.utmTerm,
          },
        });
        return { contact: updated, created: false };
      }
      const createdContact = await tx.contact.create({
        data: {
          utmSource: dto.utmSource,
          utmMedium: dto.utmMedium,
          utmCampaign: dto.utmCampaign,
          utmContent: dto.utmContent,
          utmTerm: dto.utmTerm,
          ...data,
          locationId,
          customFields: (dto.customFields ?? {}) as Prisma.InputJsonValue,
        },
      });
      return { contact: createdContact, created: true };
    });

    if (result.created) {
      this.events.emit("contact.created", {
        locationId,
        contactId: result.contact.id,
      });
    }
    return result.contact;
  }

  async list(
    locationId: string,
    opts: { q?: string; tag?: string; take?: number; skip?: number },
  ) {
    const where: Prisma.ContactWhereInput = {};
    if (opts.q) {
      where.OR = [
        { firstName: { contains: opts.q, mode: "insensitive" } },
        { lastName: { contains: opts.q, mode: "insensitive" } },
        { email: { contains: opts.q, mode: "insensitive" } },
        { phone: { contains: opts.q } },
      ];
    }
    if (opts.tag) where.tags = { has: opts.tag };

    return this.prisma.withLocation(locationId, async (tx) => {
      const [total, items] = await Promise.all([
        tx.contact.count({ where }),
        tx.contact.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: Math.min(opts.take ?? 50, 200),
          skip: opts.skip ?? 0,
        }),
      ]);
      return { total, items };
    });
  }

  async get(locationId: string, id: string) {
    const contact = await this.prisma.withLocation(locationId, (tx) =>
      tx.contact.findUnique({
        where: { id },
        include: { opportunities: true },
      }),
    );
    if (!contact) throw new NotFoundException("Contact not found");
    return contact;
  }

  async update(locationId: string, id: string, dto: UpsertContactDto) {
    return this.prisma.withLocation(locationId, async (tx) => {
      if (dto.customFields) {
        await this.validateCustomFields(tx, dto.customFields);
      }
      const existing = await tx.contact.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException("Contact not found");
      return tx.contact.update({
        where: { id },
        data: {
          ...dto,
          email: dto.email?.toLowerCase(),
          phone: dto.phone ? normalizePhone(dto.phone) : undefined,
          customFields: dto.customFields
            ? ({
                ...(existing.customFields as object),
                ...dto.customFields,
              } as Prisma.InputJsonValue)
            : undefined,
        },
      });
    });
  }

  async remove(locationId: string, id: string, actorId: string) {
    const deleted = await this.prisma.withLocation(locationId, (tx) =>
      tx.contact.delete({ where: { id } }),
    );
    const name = [deleted.firstName, deleted.lastName].filter(Boolean).join(" ")
      || deleted.email
      || deleted.phone
      || id;
    await this.audit.log(locationId, actorId, "Contacts", "contact_deleted", {
      targetLabel: name,
    });
    return { deleted: id };
  }

  async addTags(locationId: string, id: string, tags: string[]) {
    return this.prisma.withLocation(locationId, async (tx) => {
      const contact = await tx.contact.findUnique({ where: { id } });
      if (!contact) throw new NotFoundException("Contact not found");
      return tx.contact.update({
        where: { id },
        data: { tags: Array.from(new Set([...contact.tags, ...tags])) },
      });
    });
  }

  async removeTag(locationId: string, id: string, tag: string) {
    return this.prisma.withLocation(locationId, async (tx) => {
      const contact = await tx.contact.findUnique({ where: { id } });
      if (!contact) throw new NotFoundException("Contact not found");
      return tx.contact.update({
        where: { id },
        data: { tags: contact.tags.filter((t) => t !== tag) },
      });
    });
  }

  async distinctTags(locationId: string): Promise<string[]> {
    const rows = await this.prisma.withLocation(locationId, (tx) =>
      tx.$queryRaw<{ tag: string }[]>`
        SELECT DISTINCT unnest(tags) AS tag FROM contacts ORDER BY tag`,
    );
    return rows.map((r) => r.tag);
  }

  private async validateCustomFields(
    tx: Prisma.TransactionClient,
    fields: Record<string, unknown>,
  ) {
    const defs = await tx.customFieldDef.findMany();
    const byKey = new Map<string, CustomFieldDef>(defs.map((d) => [d.key, d]));
    for (const [key, value] of Object.entries(fields)) {
      const def = byKey.get(key);
      if (!def) {
        throw new BadRequestException(`Unknown custom field '${key}'`);
      }
      if (value === null) continue; // null clears a field
      const fail = (want: string) => {
        throw new BadRequestException(
          `Custom field '${key}' must be ${want}`,
        );
      };
      switch (def.type) {
        case "TEXT":
          if (typeof value !== "string") fail("a string");
          break;
        case "NUMBER":
          if (typeof value !== "number" || Number.isNaN(value)) fail("a number");
          break;
        case "BOOLEAN":
          if (typeof value !== "boolean") fail("a boolean");
          break;
        case "DATE":
          if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
            fail("an ISO date string");
          break;
        case "SELECT":
          if (typeof value !== "string" || !def.options.includes(value))
            fail(`one of: ${def.options.join(", ")}`);
          break;
      }
    }
  }
}
