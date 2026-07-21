import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from "class-validator";
import { Location } from "@growthops/db";
import { JwtAuthGuard } from "../auth/guards";
import { CurrentLocation, TenancyGuard } from "../tenancy/tenancy.guard";
import { PrismaService } from "../prisma/prisma.service";

const DEFAULT_HOURS = {
  mon: [["09:00", "17:00"]],
  tue: [["09:00", "17:00"]],
  wed: [["09:00", "17:00"]],
  thu: [["09:00", "17:00"]],
  fri: [["09:00", "17:00"]],
};

class CreateCalendarDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @Matches(/^[a-z0-9-]+$/, { message: "slug must be lowercase-with-dashes" })
  slug!: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  slotDurationMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  bufferMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minNoticeMin?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  maxAdvanceDays?: number;

  @IsOptional()
  @IsObject()
  weeklyHours?: Record<string, [string, string][]>;
}

class UpdateAppointmentDto {
  @IsIn(["CONFIRMED", "CANCELLED", "NO_SHOW", "COMPLETED"])
  status!: "CONFIRMED" | "CANCELLED" | "NO_SHOW" | "COMPLETED";
}

@Controller("locations/:locationId")
@UseGuards(JwtAuthGuard, TenancyGuard)
export class CalendarsController {
  constructor(private prisma: PrismaService) {}

  @Post("calendars")
  create(@CurrentLocation() loc: Location, @Body() dto: CreateCalendarDto) {
    return this.prisma.withLocation(loc.id, (tx) =>
      tx.calendar.create({
        data: {
          locationId: loc.id,
          name: dto.name,
          slug: dto.slug,
          timezone: dto.timezone,
          slotDurationMin: dto.slotDurationMin ?? 30,
          bufferMin: dto.bufferMin ?? 0,
          minNoticeMin: dto.minNoticeMin ?? 120,
          maxAdvanceDays: dto.maxAdvanceDays ?? 30,
          weeklyHours: dto.weeklyHours ?? DEFAULT_HOURS,
        },
      }),
    );
  }

  @Get("calendars")
  list(@CurrentLocation() loc: Location) {
    return this.prisma.withLocation(loc.id, (tx) =>
      tx.calendar.findMany({ orderBy: { createdAt: "asc" } }),
    );
  }

  @Get("appointments")
  appointments(
    @CurrentLocation() loc: Location,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.prisma.withLocation(loc.id, (tx) =>
      tx.appointment.findMany({
        where: {
          startsAt: {
            gte: from ? new Date(from) : new Date(Date.now() - 86_400_000),
            ...(to ? { lte: new Date(to) } : {}),
          },
        },
        orderBy: { startsAt: "asc" },
        take: 200,
        include: {
          contact: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          calendar: { select: { id: true, name: true } },
        },
      }),
    );
  }

  @Patch("appointments/:appointmentId")
  updateAppointment(
    @CurrentLocation() loc: Location,
    @Param("appointmentId") appointmentId: string,
    @Body() dto: UpdateAppointmentDto,
  ) {
    return this.prisma.withLocation(loc.id, (tx) =>
      tx.appointment.update({
        where: { id: appointmentId },
        data: { status: dto.status },
      }),
    );
  }
}
