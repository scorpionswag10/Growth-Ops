import { Injectable } from "@nestjs/common";
import { Prisma } from "@growthops/db";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditEntry {
  targetLabel?: string;
  detail?: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /**
   * Record an admin-level action. actorId is a real user (label resolved
   * from their current name/email) or null for a system-initiated action
   * (actorLabel is then supplied directly, e.g. "System").
   */
  async log(
    locationId: string,
    actorId: string | null,
    module: string,
    action: string,
    entry: AuditEntry = {},
    systemActorLabel = "System",
  ) {
    let actorLabel = systemActorLabel;
    if (actorId) {
      const user = await this.prisma.user.findUnique({
        where: { id: actorId },
        select: { name: true, email: true },
      });
      actorLabel = user?.name || user?.email || "Unknown user";
    }
    await this.prisma.withLocation(locationId, (tx) =>
      tx.auditLog.create({
        data: {
          locationId,
          actorId,
          actorLabel,
          module,
          action,
          targetLabel: entry.targetLabel,
          detail: entry.detail,
        },
      }),
    );
  }

  async list(
    locationId: string,
    opts: {
      actorId?: string;
      module?: string;
      action?: string;
      from?: string;
      to?: string;
      q?: string;
      take?: number;
      skip?: number;
    },
  ) {
    const where: Prisma.AuditLogWhereInput = {};
    if (opts.actorId) where.actorId = opts.actorId;
    if (opts.module) where.module = opts.module;
    if (opts.action) where.action = opts.action;
    if (opts.from || opts.to) {
      where.createdAt = {
        ...(opts.from ? { gte: new Date(opts.from) } : {}),
        ...(opts.to ? { lte: new Date(opts.to) } : {}),
      };
    }
    if (opts.q) {
      where.OR = [
        { actorLabel: { contains: opts.q, mode: "insensitive" } },
        { targetLabel: { contains: opts.q, mode: "insensitive" } },
        { detail: { contains: opts.q, mode: "insensitive" } },
      ];
    }

    return this.prisma.withLocation(locationId, async (tx) => {
      const [total, items] = await Promise.all([
        tx.auditLog.count({ where }),
        tx.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: Math.min(opts.take ?? 50, 200),
          skip: opts.skip ?? 0,
        }),
      ]);
      return { total, items };
    });
  }

  /** Distinct module/action values seen so far, to populate filter dropdowns. */
  async facets(locationId: string) {
    return this.prisma.withLocation(locationId, async (tx) => {
      const [modules, actions] = await Promise.all([
        tx.auditLog.findMany({ distinct: ["module"], select: { module: true } }),
        tx.auditLog.findMany({ distinct: ["action"], select: { action: true } }),
      ]);
      return {
        modules: modules.map((m) => m.module).sort(),
        actions: actions.map((a) => a.action).sort(),
      };
    });
  }
}
