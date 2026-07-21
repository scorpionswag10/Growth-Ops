import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Calendar, Location, Prisma } from "@growthops/db";
import { PrismaService } from "../prisma/prisma.service";
import { ContactsService } from "../contacts/contacts.service";
import { dateStrInTz, weekdayInTz, zonedTimeToUtc } from "./tz";

type WeeklyHours = Record<string, [string, string][]>;

const MS_MIN = 60_000;
const MS_DAY = 86_400_000;

@Injectable()
export class BookingService {
  constructor(
    private prisma: PrismaService,
    private contacts: ContactsService,
    private events: EventEmitter2,
  ) {}

  async resolvePublicCalendar(locationId: string, slug: string) {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
    });
    const features = (location?.features ?? {}) as Record<string, unknown>;
    if (!location || location.status !== "ACTIVE" || features.booking !== true) {
      // Uniform 404: probing reveals nothing about locations or flags.
      throw new NotFoundException();
    }
    const calendar = await this.prisma.withLocation(locationId, (tx) =>
      tx.calendar.findUnique({
        where: { locationId_slug: { locationId, slug } },
      }),
    );
    if (!calendar) throw new NotFoundException();
    return { location, calendar };
  }

  /**
   * Free UTC slots between two local dates (inclusive), honoring weekly
   * hours, slot duration, buffer, minimum notice, max advance, and every
   * CONFIRMED appointment.
   */
  async slots(
    location: Location,
    calendar: Calendar,
    fromStr: string,
    toStr: string,
  ): Promise<{ startsAt: string; endsAt: string }[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
      throw new BadRequestException("from/to must be YYYY-MM-DD");
    }
    const tz = calendar.timezone ?? location.timezone;
    const hours = (calendar.weeklyHours ?? {}) as WeeklyHours;
    const now = Date.now();
    const earliest = now + calendar.minNoticeMin * MS_MIN;
    const latest = now + calendar.maxAdvanceDays * MS_DAY;

    const rangeStart = zonedTimeToUtc(fromStr, "00:00", tz);
    const rangeEnd = new Date(
      zonedTimeToUtc(toStr, "00:00", tz).getTime() + MS_DAY,
    );
    if (rangeEnd.getTime() - rangeStart.getTime() > 62 * MS_DAY) {
      throw new BadRequestException("Range too large");
    }

    const busy = await this.prisma.withLocation(location.id, (tx) =>
      tx.appointment.findMany({
        where: {
          calendarId: calendar.id,
          status: "CONFIRMED",
          startsAt: { lt: rangeEnd },
          endsAt: { gt: rangeStart },
        },
        select: { startsAt: true, endsAt: true },
      }),
    );
    const buffer = calendar.bufferMin * MS_MIN;
    const slotMs = calendar.slotDurationMin * MS_MIN;

    const out: { startsAt: string; endsAt: string }[] = [];
    for (
      let dayCursor = rangeStart.getTime();
      dayCursor < rangeEnd.getTime();
      dayCursor += MS_DAY
    ) {
      const dayAnchor = new Date(dayCursor + MS_DAY / 2); // midday, DST-safe
      const dayStr = dateStrInTz(dayAnchor, tz);
      const windows = hours[weekdayInTz(dayAnchor, tz)] ?? [];
      for (const [open, close] of windows) {
        const windowStart = zonedTimeToUtc(dayStr, open, tz).getTime();
        const windowEnd = zonedTimeToUtc(dayStr, close, tz).getTime();
        for (let s = windowStart; s + slotMs <= windowEnd; s += slotMs) {
          const e = s + slotMs;
          if (s < earliest || s > latest) continue;
          const collides = busy.some(
            (b) =>
              s < b.endsAt.getTime() + buffer &&
              e > b.startsAt.getTime() - buffer,
          );
          if (collides) continue;
          out.push({
            startsAt: new Date(s).toISOString(),
            endsAt: new Date(e).toISOString(),
          });
        }
      }
    }
    return out;
  }

  async book(
    location: Location,
    calendar: Calendar,
    params: {
      startsAt: string;
      name?: string;
      email?: string;
      phone?: string;
      notes?: string;
    },
  ) {
    if (!params.email && !params.phone) {
      throw new BadRequestException("email or phone is required");
    }
    const startsAt = new Date(params.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException("startsAt must be an ISO timestamp");
    }
    const tz = calendar.timezone ?? location.timezone;
    const dayStr = dateStrInTz(startsAt, tz);
    const daySlots = await this.slots(location, calendar, dayStr, dayStr);
    if (!daySlots.some((s) => s.startsAt === startsAt.toISOString())) {
      throw new ConflictException("That time is no longer available");
    }

    const [first, ...rest] = (params.name ?? "").trim().split(/\s+/);
    const contact = await this.contacts.upsert(location.id, {
      firstName: first || undefined,
      lastName: rest.join(" ") || undefined,
      email: params.email,
      phone: params.phone,
      source: "booking-page",
      tags: ["booking"],
    });

    const endsAt = new Date(
      startsAt.getTime() + calendar.slotDurationMin * MS_MIN,
    );
    try {
      const appointment = await this.prisma.withLocation(location.id, (tx) =>
        tx.appointment.create({
          data: {
            locationId: location.id,
            calendarId: calendar.id,
            contactId: contact.id,
            startsAt,
            endsAt,
            notes: params.notes,
            source: "booking-page",
          },
        }),
      );
      this.events.emit("appointment.booked", {
        locationId: location.id,
        contactId: contact.id,
        appointmentStartsAt: appointment.startsAt.toISOString(),
      });
      return { appointment, contact };
    } catch (err) {
      // The DB exclusion constraint is the final word on races: two
      // simultaneous bookings for one slot — exactly one wins.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError ||
        (err instanceof Error && err.message.includes("no_double_booking"))
      ) {
        throw new ConflictException("That time was just taken");
      }
      throw err;
    }
  }
}
