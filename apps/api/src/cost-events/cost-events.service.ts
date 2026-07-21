import { Injectable } from "@nestjs/common";
import { CostType, Prisma } from "@growthops/db";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Internal provider-cost ledger. Every provider action (Twilio send, email
 * send, AI call, social publish) records its cost here at the moment it
 * happens — the one subsystem the GHL teardown says is brutal to retrofit.
 * Clients never see this; it exists so GrowthOps always knows its margin.
 */
@Injectable()
export class CostEventsService {
  constructor(private prisma: PrismaService) {}

  async record(params: {
    locationId: string;
    type: CostType;
    provider: string;
    providerRef?: string;
    quantity?: number;
    unitCost?: number;
    meta?: Prisma.InputJsonValue;
  }) {
    const quantity = params.quantity ?? 1;
    const unitCost = params.unitCost ?? 0;
    return this.prisma.withLocation(params.locationId, (tx) =>
      tx.costEvent.upsert({
        // Idempotent on (provider, providerRef, type): a re-delivered provider
        // webhook is a no-op, never a double-charge.
        where: {
          provider_providerRef_type: {
            provider: params.provider,
            providerRef: params.providerRef ?? crypto.randomUUID(),
            type: params.type,
          },
        },
        create: {
          locationId: params.locationId,
          type: params.type,
          provider: params.provider,
          providerRef: params.providerRef,
          quantity,
          unitCost,
          totalCost: quantity * unitCost,
          meta: params.meta,
        },
        update: {},
      }),
    );
  }

  async list(locationId: string) {
    return this.prisma.withLocation(locationId, (tx) =>
      tx.costEvent.findMany({ orderBy: { occurredAt: "desc" }, take: 100 }),
    );
  }
}
