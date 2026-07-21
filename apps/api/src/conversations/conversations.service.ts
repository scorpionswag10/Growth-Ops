import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Location,
  Message,
  MessageChannel,
  MessageDirection,
  Prisma,
} from "@growthops/db";
import { PrismaService } from "../prisma/prisma.service";
import { DispatcherRegistry } from "./dispatcher";

const PREVIEW_LEN = 120;

// Outbound sends on these channels require the location's entitlement flag.
// NOTE / LIVECHAT / CALL logging have no external provider, so no flag.
const CHANNEL_FEATURE: Partial<Record<MessageChannel, string>> = {
  SMS: "sms",
  EMAIL: "email",
  FB: "social",
  IG: "social",
};

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    private dispatchers: DispatcherRegistry,
  ) {}

  /** The inbox: conversations newest-activity-first with contact summaries. */
  list(
    locationId: string,
    opts: { unread?: boolean; take?: number; skip?: number },
  ) {
    return this.prisma.withLocation(locationId, async (tx) => {
      const where: Prisma.ConversationWhereInput = opts.unread
        ? { unreadCount: { gt: 0 } }
        : {};
      const [total, items] = await Promise.all([
        tx.conversation.count({ where }),
        tx.conversation.findMany({
          where,
          orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
          take: Math.min(opts.take ?? 50, 200),
          skip: opts.skip ?? 0,
          include: {
            contact: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                tags: true,
              },
            },
          },
        }),
      ]);
      return { total, items };
    });
  }

  async get(
    locationId: string,
    conversationId: string,
    opts: { take?: number; skip?: number },
  ) {
    const convo = await this.prisma.withLocation(locationId, (tx) =>
      tx.conversation.findUnique({
        where: { id: conversationId },
        include: {
          contact: true,
          messages: {
            orderBy: { occurredAt: "desc" },
            take: Math.min(opts.take ?? 50, 200),
            skip: opts.skip ?? 0,
          },
        },
      }),
    );
    if (!convo) throw new NotFoundException("Conversation not found");
    // Serve oldest-first for rendering; queried newest-first for pagination.
    convo.messages.reverse();
    return convo;
  }

  markRead(locationId: string, conversationId: string) {
    return this.prisma.withLocation(locationId, async (tx) => {
      const convo = await tx.conversation.findUnique({
        where: { id: conversationId },
      });
      if (!convo) throw new NotFoundException("Conversation not found");
      return tx.conversation.update({
        where: { id: conversationId },
        data: { unreadCount: 0 },
      });
    });
  }

  /**
   * Outbound send from the inbox. NOTE is stored directly; provider channels
   * check the location's entitlement flag, then hand off to their dispatcher.
   * No dispatcher registered (channel built but dark) → loud 502, message
   * recorded as FAILED so the timeline never lies about what happened.
   */
  async send(
    location: Location,
    contactId: string,
    channel: MessageChannel,
    body: string,
    sentByUserId: string,
  ) {
    const flag = CHANNEL_FEATURE[channel];
    if (flag) {
      const features = (location.features ?? {}) as Record<string, unknown>;
      if (features[flag] !== true) {
        throw new ForbiddenException(
          `Feature '${flag}' is not enabled for this location`,
        );
      }
    }

    const message = await this.prisma.withLocation(location.id, async (tx) => {
      const contact = await tx.contact.findUnique({ where: { id: contactId } });
      if (!contact) throw new NotFoundException("Contact not found");
      const conversation = await this.ensureConversation(
        tx,
        location.id,
        contactId,
      );
      const msg = await tx.message.create({
        data: {
          locationId: location.id,
          conversationId: conversation.id,
          contactId,
          channel,
          direction: "OUTBOUND",
          status: channel === "NOTE" ? "SENT" : "QUEUED",
          body,
          sentByUserId,
        },
      });
      await this.touchConversation(tx, conversation.id, msg, false);
      return msg;
    });

    if (channel === "NOTE") return message;

    const dispatcher = this.dispatchers.get(channel);
    if (!dispatcher) {
      await this.setStatus(location.id, message.id, "FAILED", {
        error: `No provider configured for channel ${channel}`,
      });
      throw new BadGatewayException(
        `Channel ${channel} has no provider configured yet`,
      );
    }
    try {
      const result = await dispatcher.send(message);
      return await this.prisma.withLocation(location.id, (tx) =>
        tx.message.update({
          where: { id: message.id },
          data: {
            status: "SENT",
            providerMessageId: result.providerMessageId,
            providerMeta: result.providerMeta as Prisma.InputJsonValue,
          },
        }),
      );
    } catch (err) {
      await this.setStatus(location.id, message.id, "FAILED", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new BadGatewayException(`Send failed on channel ${channel}`);
    }
  }

  /**
   * Record a message that happened elsewhere: a provider webhook (inbound
   * SMS/DM), or manual logging (a phone call). Idempotent on
   * (channel, providerMessageId) — re-delivered webhooks are no-ops.
   */
  async ingest(
    locationId: string,
    contactId: string,
    params: {
      channel: MessageChannel;
      direction: MessageDirection;
      body: string;
      providerMessageId?: string;
      providerMeta?: Record<string, unknown>;
      occurredAt?: Date;
    },
  ) {
    return this.prisma.withLocation(locationId, async (tx) => {
      const contact = await tx.contact.findUnique({ where: { id: contactId } });
      if (!contact) throw new NotFoundException("Contact not found");

      if (params.providerMessageId) {
        const existing = await tx.message.findUnique({
          where: {
            channel_providerMessageId: {
              channel: params.channel,
              providerMessageId: params.providerMessageId,
            },
          },
        });
        if (existing) return existing;
      }

      const conversation = await this.ensureConversation(
        tx,
        locationId,
        contactId,
      );
      const msg = await tx.message.create({
        data: {
          locationId,
          conversationId: conversation.id,
          contactId,
          channel: params.channel,
          direction: params.direction,
          status: params.direction === "INBOUND" ? "RECEIVED" : "SENT",
          body: params.body,
          providerMessageId: params.providerMessageId,
          providerMeta: params.providerMeta as Prisma.InputJsonValue,
          occurredAt: params.occurredAt ?? new Date(),
        },
      });
      await this.touchConversation(
        tx,
        conversation.id,
        msg,
        params.direction === "INBOUND",
      );
      return msg;
    });
  }

  private async ensureConversation(
    tx: Prisma.TransactionClient,
    locationId: string,
    contactId: string,
  ) {
    return tx.conversation.upsert({
      where: { locationId_contactId: { locationId, contactId } },
      create: { locationId, contactId },
      update: {},
    });
  }

  private async touchConversation(
    tx: Prisma.TransactionClient,
    conversationId: string,
    msg: Message,
    countUnread: boolean,
  ) {
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: msg.occurredAt,
        lastMessagePreview: msg.body.slice(0, PREVIEW_LEN),
        ...(countUnread ? { unreadCount: { increment: 1 } } : {}),
      },
    });
  }

  private setStatus(
    locationId: string,
    messageId: string,
    status: "FAILED",
    meta: Record<string, unknown>,
  ) {
    return this.prisma.withLocation(locationId, (tx) =>
      tx.message.update({
        where: { id: messageId },
        data: { status, providerMeta: meta as Prisma.InputJsonValue },
      }),
    );
  }
}
