import { Module } from "@nestjs/common";
import { BookingPublicController } from "./booking.controller";
import { CalendarsController } from "./calendars.controller";
import { BookingService } from "./booking.service";
import { ContactsModule } from "../contacts/contacts.module";

@Module({
  imports: [ContactsModule],
  controllers: [BookingPublicController, CalendarsController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
