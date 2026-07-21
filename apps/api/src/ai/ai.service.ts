import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { Location, MessageChannel } from "@growthops/db";
import { PrismaService } from "../prisma/prisma.service";
import { ConversationsService } from "../conversations/conversations.service";
import { CostEventsService } from "../cost-events/cost-events.service";
import { BookingService } from "../booking/booking.service";
import { dateStrInTz, formatInTz } from "../booking/tz";

const MODEL = process.env.AI_MODEL ?? "claude-opus-4-8";
const MAX_AI_REPLIES_PER_CONTACT_PER_HOUR = 6;

/**
 * The AI receptionist: replies to inbound customer messages, answers from the
 * location's business profile, and books appointments through real tools.
 * Ships dark like everything else — per-location `ai` feature flag, and
 * gracefully inert when no Anthropic credentials are configured.
 */
@Injectable()
export class AiReceptionistService {
  private readonly log = new Logger("AiReceptionist");
  private client: Anthropic | null | undefined; // undefined = not yet tried

  constructor(
    private prisma: PrismaService,
    private conversations: ConversationsService,
    private costEvents: CostEventsService,
    private booking: BookingService,
  ) {}

  private getClient(): Anthropic | null {
    if (this.client !== undefined) return this.client;
    try {
      this.client = new Anthropic();
    } catch {
      this.client = null;
      this.log.warn(
        "No Anthropic credentials configured (set ANTHROPIC_API_KEY in apps/api/.env) — AI receptionist is inert",
      );
    }
    return this.client;
  }

  @OnEvent("message.inbound")
  async onInbound(e: { locationId: string; contactId: string }) {
    try {
      await this.reply(e.locationId, e.contactId);
    } catch (err) {
      this.log.error(
        `reply failed for contact ${e.contactId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private async reply(locationId: string, contactId: string) {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
    });
    if (!location) return;
    const features = (location.features ?? {}) as Record<string, unknown>;
    if (features.ai !== true) return;

    const client = this.getClient();
    if (!client) return;

    // Loop guard: cap AI replies per contact per hour, tracked via the
    // AI_TOKENS cost ledger (one entry per reply).
    const recentReplies = await this.prisma.withLocation(locationId, (tx) =>
      tx.costEvent.count({
        where: {
          type: "AI_TOKENS",
          occurredAt: { gte: new Date(Date.now() - 3_600_000) },
          meta: { path: ["contactId"], equals: contactId },
        },
      }),
    );
    if (recentReplies >= MAX_AI_REPLIES_PER_CONTACT_PER_HOUR) {
      this.log.warn(`rate cap hit for contact ${contactId} — skipping AI reply`);
      return;
    }

    const data = await this.prisma.withLocation(locationId, async (tx) => {
      const contact = await tx.contact.findUnique({ where: { id: contactId } });
      const conversation = await tx.conversation.findUnique({
        where: { locationId_contactId: { locationId, contactId } },
        include: {
          messages: {
            where: { channel: { not: "NOTE" } },
            orderBy: { occurredAt: "desc" },
            take: 20,
          },
        },
      });
      return { contact, conversation };
    });
    if (!data.contact || !data.conversation) return;

    const thread = [...data.conversation.messages].reverse();
    const lastInbound = [...thread].reverse().find((m) => m.direction === "INBOUND");
    if (!lastInbound) return;
    const replyChannel = lastInbound.channel as MessageChannel;

    const history: Anthropic.Beta.BetaMessageParam[] = thread.map((m) => ({
      role: m.direction === "INBOUND" ? ("user" as const) : ("assistant" as const),
      content: m.body,
    }));
    if (history.length === 0 || history[0].role !== "user") {
      history.unshift({ role: "user", content: "(conversation started)" });
    }

    const tools = this.buildTools(location, data.contact.id, {
      name: [data.contact.firstName, data.contact.lastName].filter(Boolean).join(" "),
      email: data.contact.email,
      phone: data.contact.phone,
    });

    let finalMessage: Anthropic.Beta.BetaMessage;
    try {
      finalMessage = await client.beta.messages.toolRunner({
        model: MODEL,
        max_tokens: 1024,
        system: this.systemPrompt(location),
        tools,
        messages: history,
        max_iterations: 5,
      });
    } catch (err) {
      // The SDK defers credential resolution to request time. Trip the kill
      // switch on the first auth failure so we warn once, not per message.
      if (
        err instanceof Anthropic.AuthenticationError ||
        (err instanceof Error && err.message.includes("Could not resolve authentication"))
      ) {
        this.client = null;
        this.log.warn(
          "No Anthropic credentials configured (set ANTHROPIC_API_KEY in apps/api/.env) — AI receptionist is inert",
        );
        return;
      }
      throw err;
    }

    const text = finalMessage.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const usage = finalMessage.usage;
    await this.costEvents.record({
      locationId,
      type: "AI_TOKENS",
      provider: "anthropic",
      providerRef: finalMessage.id,
      quantity: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      meta: {
        contactId,
        model: MODEL,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      },
    });

    if (!text) return;
    try {
      await this.conversations.send(location, contactId, replyChannel, text);
    } catch {
      // Dark channel (e.g. SMS pre-carrier-approval): the message row is
      // already recorded as FAILED by ConversationsService — timeline stays
      // honest, nothing more to do here.
    }
  }

  private systemPrompt(location: Location): string {
    const now = new Date();
    return [
      `You are the virtual receptionist for ${location.name}, replying to customer text messages.`,
      `Current local time: ${formatInTz(now, location.timezone)} (${location.timezone}).`,
      "",
      "Rules:",
      "- Reply in 1-3 short, friendly sentences — this is SMS, not email.",
      "- Use the tools to check real availability and to book appointments. Never invent times.",
      "- Only state services, prices, and policies that appear in the business profile below. If you don't know, say a team member will follow up shortly.",
      "- Never ask for payment details.",
      "",
      "Business profile:",
      location.aiProfile?.trim() ||
        "(No profile provided yet — answer only scheduling questions and defer everything else to the team.)",
    ].join("\n");
  }

  private buildTools(
    location: Location,
    contactId: string,
    contact: { name: string; email: string | null; phone: string | null },
  ) {
    const getCalendar = () =>
      this.prisma.withLocation(location.id, (tx) =>
        tx.calendar.findFirst({ orderBy: { createdAt: "asc" } }),
      );

    return [
      betaTool({
        name: "get_available_slots",
        description:
          "Get open appointment slots for the next 7 days. Call this before proposing any time.",
        inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
        run: async () => {
          try {
            const calendar = await getCalendar();
            if (!calendar) return "No booking calendar is set up.";
            const tz = calendar.timezone ?? location.timezone;
            const from = dateStrInTz(new Date(), tz);
            const to = dateStrInTz(new Date(Date.now() + 7 * 86_400_000), tz);
            const slots = await this.booking.slots(location, calendar, from, to);
            if (slots.length === 0) return "No open slots in the next 7 days.";
            return slots
              .slice(0, 24)
              .map((s) => `${s.startsAt} = ${formatInTz(new Date(s.startsAt), tz)}`)
              .join("\n");
          } catch (err) {
            return `Error checking availability: ${err instanceof Error ? err.message : err}`;
          }
        },
      }),
      betaTool({
        name: "book_appointment",
        description:
          "Book an appointment for this customer at one of the available slot times. Use the exact ISO startsAt value from get_available_slots.",
        inputSchema: {
          type: "object" as const,
          properties: {
            startsAt: {
              type: "string" as const,
              description: "The ISO timestamp of the chosen slot",
            },
            notes: { type: "string" as const, description: "Optional note about the visit" },
          },
          required: ["startsAt"],
          additionalProperties: false,
        },
        run: async (input: { startsAt: string; notes?: string }) => {
          try {
            const calendar = await getCalendar();
            if (!calendar) return "No booking calendar is set up.";
            const { appointment } = await this.booking.book(location, calendar, {
              startsAt: input.startsAt,
              name: contact.name || undefined,
              email: contact.email ?? undefined,
              phone: contact.phone ?? undefined,
              notes: input.notes,
            });
            const tz = calendar.timezone ?? location.timezone;
            return `Booked for ${formatInTz(appointment.startsAt, tz)}.`;
          } catch (err) {
            return `Could not book: ${err instanceof Error ? err.message : err}`;
          }
        },
      }),
    ];
  }
}
