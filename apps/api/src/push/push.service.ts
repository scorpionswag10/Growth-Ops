import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import * as webpush from "web-push";
import { PrismaService } from "../prisma/prisma.service";

interface TriggerEvent {
  locationId: string;
  contactId: string;
}

/**
 * Web Push alerts — deliberately not tied to Twilio/Resend. Works today with
 * zero external accounts: the browser is the delivery channel. Fans out to
 * every member of the location that has an active subscription.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger("Push");
  private configured = false;

  constructor(private prisma: PrismaService) {
    const { PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY, PUSH_VAPID_SUBJECT } =
      process.env;
    if (PUSH_VAPID_PUBLIC_KEY && PUSH_VAPID_PRIVATE_KEY && PUSH_VAPID_SUBJECT) {
      webpush.setVapidDetails(
        PUSH_VAPID_SUBJECT,
        PUSH_VAPID_PUBLIC_KEY,
        PUSH_VAPID_PRIVATE_KEY,
      );
      this.configured = true;
    } else {
      this.log.warn("VAPID keys not configured — push alerts are inert");
    }
  }

  async subscribe(
    userId: string,
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  ) {
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  }

  async unsubscribe(endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
    return { ok: true };
  }

  async status(userId: string) {
    const count = await this.prisma.pushSubscription.count({ where: { userId } });
    return { subscribed: count > 0 };
  }

  @OnEvent("contact.created")
  onLead(e: TriggerEvent) {
    return this.notifyLocation(e.locationId, {
      title: "New lead",
      body: "A new lead just came in.",
      url: "/inbox",
    });
  }

  @OnEvent("appointment.booked")
  onBooking(e: TriggerEvent) {
    return this.notifyLocation(e.locationId, {
      title: "New appointment booked",
      body: "Someone just booked on your calendar.",
      url: "/calendar",
    });
  }

  private async notifyLocation(
    locationId: string,
    payload: { title: string; body: string; url: string },
  ) {
    if (!this.configured) return;
    try {
      const location = await this.prisma.location.findUnique({
        where: { id: locationId },
      });
      const [members, admins] = await Promise.all([
        this.prisma.membership.findMany({
          where: { locationId },
          select: { userId: true },
        }),
        // Platform admins can access any location without an explicit
        // Membership row (see TenancyGuard) — they must still get alerts,
        // or the person actually running the platform hears nothing.
        this.prisma.user.findMany({
          where: { isPlatformAdmin: true },
          select: { id: true },
        }),
      ]);
      const recipientIds = new Set([
        ...members.map((m) => m.userId),
        ...admins.map((a) => a.id),
      ]);
      const subs = await this.prisma.pushSubscription.findMany({
        where: { userId: { in: [...recipientIds] } },
      });
      const body = location ? `${payload.body} (${location.name})` : payload.body;
      await Promise.all(
        subs.map((s) =>
          webpush
            .sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify({ title: payload.title, body, url: payload.url }),
            )
            .catch(async (err) => {
              // 404/410 = the browser revoked or the subscription expired —
              // stop trying, don't let a stale row error on every future event.
              if (err?.statusCode === 404 || err?.statusCode === 410) {
                await this.prisma.pushSubscription.delete({ where: { id: s.id } });
              } else {
                this.log.warn(`push send failed: ${err?.message ?? err}`);
              }
            }),
        ),
      );
    } catch (err) {
      this.log.error(`notifyLocation failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
