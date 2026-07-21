import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { LocationsModule } from "./locations/locations.module";
import { CostEventsModule } from "./cost-events/cost-events.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    LocationsModule,
    CostEventsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
