import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@growthops/db";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Run tenant-scoped queries. Sets app.location_id for the transaction so
   * Postgres RLS policies apply — outside this helper, tenant tables return
   * zero rows. Every read/write of tenant data must go through here.
   */
  async withLocation<T>(
    locationId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!UUID_RE.test(locationId)) {
      throw new Error(`Invalid locationId: ${locationId}`);
    }
    return this.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL app.location_id = '${locationId}'`,
      );
      return fn(tx);
    });
  }
}
