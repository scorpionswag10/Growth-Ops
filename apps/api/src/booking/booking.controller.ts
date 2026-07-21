import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Query,
} from "@nestjs/common";
import { IsEmail, IsISO8601, IsOptional, IsString, MaxLength } from "class-validator";
import { Post } from "@nestjs/common";
import { BookingService } from "./booking.service";
import { formatInTz } from "./tz";

class PublicBookDto {
  @IsISO8601()
  startsAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** Public booking surface — no auth; gated per location by features.booking. */
@Controller("book")
export class BookingPublicController {
  constructor(private booking: BookingService) {}

  @Get(":locationId/:slug")
  async info(@Param("locationId") locationId: string, @Param("slug") slug: string) {
    const { location, calendar } = await this.booking.resolvePublicCalendar(
      locationId,
      slug,
    );
    return {
      businessName: location.name,
      calendarName: calendar.name,
      slotDurationMin: calendar.slotDurationMin,
      timezone: calendar.timezone ?? location.timezone,
      maxAdvanceDays: calendar.maxAdvanceDays,
    };
  }

  @Get(":locationId/:slug/slots")
  async slots(
    @Param("locationId") locationId: string,
    @Param("slug") slug: string,
    @Query("from") from: string,
    @Query("to") to: string,
  ) {
    const { location, calendar } = await this.booking.resolvePublicCalendar(
      locationId,
      slug,
    );
    return this.booking.slots(location, calendar, from, to);
  }

  @Post(":locationId/:slug")
  @HttpCode(201)
  async book(
    @Param("locationId") locationId: string,
    @Param("slug") slug: string,
    @Body() dto: PublicBookDto,
  ) {
    const { location, calendar } = await this.booking.resolvePublicCalendar(
      locationId,
      slug,
    );
    const { appointment } = await this.booking.book(location, calendar, dto);
    const tz = calendar.timezone ?? location.timezone;
    return {
      ok: true,
      appointmentId: appointment.id,
      startsAt: appointment.startsAt,
      localTime: formatInTz(appointment.startsAt, tz),
      businessName: location.name,
    };
  }
}
