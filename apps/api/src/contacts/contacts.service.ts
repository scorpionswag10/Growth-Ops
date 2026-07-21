import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { CustomFieldDef, Prisma } from "@growthops/db";
import { PrismaService } from "../prisma/prisma.service";
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
  constructor(private prisma: PrismaService) {}

  /**
   * Upsert by identity: email match wins, then phone match, else create.
   * One person, one contact — however many channels they arrive through.
   */
  async upsert(locationId: string, dto: UpsertContactDto) {
    const email = dto.email?.toLowerCase();
    const phone = dto.phone ? normalizePhone(dto.phone) : undefined;

    return this.prisma.withLocation(locationId, async (tx) => {
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
        return tx.contact.update({
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
          },
        });
      }
      return tx.contact.create({
        data: {
          ...data,
          locationId,
          customFields: (dto.customFields ?? {}) as Prisma.InputJsonValue,
        },
      });
    });
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

  async remove(locationId: string, id: string) {
    await this.prisma.withLocation(locationId, (tx) =>
      tx.contact.delete({ where: { id } }),
    );
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
