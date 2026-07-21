import { Module } from "@nestjs/common";
import { LocationsController } from "./locations.controller";
import { CostEventsModule } from "../cost-events/cost-events.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [CostEventsModule, AuditModule],
  controllers: [LocationsController],
})
export class LocationsModule {}
