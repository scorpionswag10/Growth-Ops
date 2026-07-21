import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const MS_DAY = 86_400_000;

export interface GrowthReport {
  businessName: string;
  periodDays: number;
  generatedAt: string;
  leads: { current: number; previous: number; bySource: { source: string; count: number }[] };
  appointments: {
    booked: number;
    previousBooked: number;
    completed: number;
    noShows: number;
    showRatePct: number | null;
  };
  revenue: { wonInPeriod: number; openPipeline: number };
  messages: { inbound: number; outbound: number };
  daily: { date: string; leads: number; appointments: number }[];
  funnel: { stage: string; count: number }[];
  funnelBySource: { source: string; leads: number; customers: number }[];
}

@Injectable()
export class ReportService {
  constructor(private prisma: PrismaService) {}

  async resolvePublic(locationId: string, token: string) {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
    });
    if (!location || location.reportToken !== token || location.status !== "ACTIVE") {
      throw new NotFoundException();
    }
    return location;
  }

  async compute(locationId: string, businessName: string, days = 30): Promise<GrowthReport> {
    const periodDays = Math.min(Math.max(days, 7), 90);
    const now = Date.now();
    const since = new Date(now - periodDays * MS_DAY);
    const prevSince = new Date(now - 2 * periodDays * MS_DAY);

    return this.prisma.withLocation(locationId, async (tx) => {
      const [
        leadsNow,
        leadsPrev,
        leadRows,
        apptRows,
        apptsPrev,
        wonAgg,
        openAgg,
        inbound,
        outbound,
        contactedCount,
        bookedCount,
        showedUpCount,
        customerCount,
      ] = await Promise.all([
        tx.contact.count({ where: { createdAt: { gte: since } } }),
        tx.contact.count({ where: { createdAt: { gte: prevSince, lt: since } } }),
        tx.contact.findMany({
          where: { createdAt: { gte: since } },
          select: {
            createdAt: true,
            source: true,
            opportunities: { where: { status: "WON" }, select: { id: true }, take: 1 },
          },
        }),
        tx.appointment.findMany({
          where: { createdAt: { gte: since } },
          select: { createdAt: true, status: true },
        }),
        tx.appointment.count({
          where: { createdAt: { gte: prevSince, lt: since } },
        }),
        tx.opportunity.aggregate({
          where: { status: "WON", updatedAt: { gte: since } },
          _sum: { monetaryValue: true },
        }),
        tx.opportunity.aggregate({
          where: { status: "OPEN" },
          _sum: { monetaryValue: true },
        }),
        tx.message.count({
          where: { direction: "INBOUND", occurredAt: { gte: since } },
        }),
        tx.message.count({
          where: {
            direction: "OUTBOUND",
            channel: { not: "NOTE" },
            occurredAt: { gte: since },
          },
        }),
        // Funnel stages: each computed on leads created within the period, so
        // the funnel always describes "what happened to this period's leads,"
        // not a mix of old and new contacts. "Contacted" also counts anyone
        // who got far enough to book or become a customer — reaching a later
        // stage implies being reached, even for self-service bookings that
        // never got an explicit outbound message. Keeps the funnel monotonic.
        tx.contact.count({
          where: {
            createdAt: { gte: since },
            OR: [
              { messages: { some: { direction: "OUTBOUND", channel: { not: "NOTE" } } } },
              { tags: { has: "followed-up" } },
              { appointments: { some: {} } },
              { opportunities: { some: { status: "WON" } } },
            ],
          },
        }),
        tx.contact.count({
          where: { createdAt: { gte: since }, appointments: { some: {} } },
        }),
        tx.contact.count({
          where: {
            createdAt: { gte: since },
            appointments: { some: { status: "COMPLETED" } },
          },
        }),
        tx.contact.count({
          where: {
            createdAt: { gte: since },
            opportunities: { some: { status: "WON" } },
          },
        }),
      ]);

      const bySourceMap = new Map<string, number>();
      const bySourceCustomers = new Map<string, number>();
      for (const r of leadRows) {
        const key = r.source ?? "direct";
        bySourceMap.set(key, (bySourceMap.get(key) ?? 0) + 1);
        if (r.opportunities.length > 0) {
          bySourceCustomers.set(key, (bySourceCustomers.get(key) ?? 0) + 1);
        }
      }
      const bySource = [...bySourceMap.entries()]
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);
      const funnelBySource = [...bySourceMap.entries()]
        .map(([source, leads]) => ({
          source,
          leads,
          customers: bySourceCustomers.get(source) ?? 0,
        }))
        .sort((a, b) => b.leads - a.leads)
        .slice(0, 8);

      const completed = apptRows.filter((a) => a.status === "COMPLETED").length;
      const noShows = apptRows.filter((a) => a.status === "NO_SHOW").length;
      const finished = completed + noShows;

      const daily: GrowthReport["daily"] = [];
      for (let i = periodDays - 1; i >= 0; i--) {
        const dayStart = new Date(now - (i + 1) * MS_DAY);
        const dayEnd = new Date(now - i * MS_DAY);
        daily.push({
          date: dayEnd.toISOString().slice(0, 10),
          leads: leadRows.filter(
            (r) => r.createdAt >= dayStart && r.createdAt < dayEnd,
          ).length,
          appointments: apptRows.filter(
            (r) => r.createdAt >= dayStart && r.createdAt < dayEnd,
          ).length,
        });
      }

      return {
        businessName,
        periodDays,
        generatedAt: new Date(now).toISOString(),
        leads: { current: leadsNow, previous: leadsPrev, bySource },
        appointments: {
          booked: apptRows.length,
          previousBooked: apptsPrev,
          completed,
          noShows,
          showRatePct: finished > 0 ? Math.round((completed / finished) * 100) : null,
        },
        revenue: {
          wonInPeriod: Number(wonAgg._sum.monetaryValue ?? 0),
          openPipeline: Number(openAgg._sum.monetaryValue ?? 0),
        },
        messages: { inbound, outbound },
        daily,
        funnel: [
          { stage: "Leads", count: leadsNow },
          { stage: "Contacted", count: contactedCount },
          { stage: "Booked", count: bookedCount },
          { stage: "Showed Up", count: showedUpCount },
          { stage: "Customer", count: customerCount },
        ],
        funnelBySource,
      };
    });
  }
}
