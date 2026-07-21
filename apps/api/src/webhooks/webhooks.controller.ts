import {
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ContactsService } from "../contacts/contacts.service";

/**
 * Public (unauthenticated) inbound integrations. Auth is the per-location
 * secret token in the URL — the same model LeadPages/Zapier/etc. expect.
 * Payload shapes vary by form builder, so mapping is permissive: common field
 * aliases are normalized, unknown extras are ignored.
 */
@Controller("webhooks")
export class WebhooksController {
  constructor(
    private prisma: PrismaService,
    private contacts: ContactsService,
  ) {}

  @Post("leads/:locationId/:token")
  @HttpCode(200)
  async captureLead(
    @Param("locationId") locationId: string,
    @Param("token") token: string,
    @Body() body: Record<string, unknown>,
  ) {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
    });
    if (
      !location ||
      location.webhookToken !== token ||
      location.status !== "ACTIVE"
    ) {
      // One error for every failure mode — a probing caller learns nothing.
      throw new NotFoundException();
    }

    const s = (v: unknown): string | undefined =>
      typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

    let firstName = s(body.firstName) ?? s(body.first_name);
    let lastName = s(body.lastName) ?? s(body.last_name);
    const fullName = s(body.name) ?? s(body.full_name);
    if (!firstName && fullName) {
      const [first, ...rest] = fullName.split(/\s+/);
      firstName = first;
      lastName = lastName ?? (rest.join(" ") || undefined);
    }

    const rawTags = body.tags;
    const tags = Array.isArray(rawTags)
      ? rawTags.filter((t): t is string => typeof t === "string")
      : typeof rawTags === "string"
        ? rawTags.split(",").map((t) => t.trim()).filter(Boolean)
        : [];

    const email = s(body.email);
    const phone = s(body.phone) ?? s(body.phone_number);
    if (!email && !phone) {
      // Nothing to identify the lead by; acknowledge so the sender doesn't
      // retry forever, but create nothing.
      return { ok: true, skipped: "no email or phone in payload" };
    }

    const contact = await this.contacts.upsert(location.id, {
      firstName,
      lastName,
      email,
      phone,
      source: s(body.source) ?? "webhook",
      tags: Array.from(new Set(["new-lead", ...tags])),
    });
    return { ok: true, contactId: contact.id };
  }
}
