import { Module } from "@nestjs/common";
import { LocationsController } from "./locations.controller";
import { CostEventsModule } from "../cost-events/cost-events.module";

@Module({
  imports: [CostEventsModule],
  controllers: [LocationsController],
})
export class LocationsModule {}
