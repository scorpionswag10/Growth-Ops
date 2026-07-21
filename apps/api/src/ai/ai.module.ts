import { Module } from "@nestjs/common";
import { AiReceptionistService } from "./ai.service";
import { ConversationsModule } from "../conversations/conversations.module";
import { CostEventsModule } from "../cost-events/cost-events.module";
import { BookingModule } from "../booking/booking.module";

@Module({
  imports: [ConversationsModule, CostEventsModule, BookingModule],
  providers: [AiReceptionistService],
})
export class AiModule {}
