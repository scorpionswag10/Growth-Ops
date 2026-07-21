import { Module } from "@nestjs/common";
import { CostEventsService } from "./cost-events.service";

@Module({
  providers: [CostEventsService],
  exports: [CostEventsService],
})
export class CostEventsModule {}
