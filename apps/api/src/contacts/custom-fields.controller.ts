import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Location } from "@growthops/db";
import { JwtAuthGuard } from "../auth/guards";
import { CurrentLocation, TenancyGuard } from "../tenancy/tenancy.guard";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCustomFieldDto } from "./dto";

@Controller("locations/:locationId/custom-fields")
@UseGuards(JwtAuthGuard, TenancyGuard)
export class CustomFieldsController {
  constructor(private prisma: PrismaService) {}

  @Post()
  create(@CurrentLocation() loc: Location, @Body() dto: CreateCustomFieldDto) {
    return this.prisma.withLocation(loc.id, (tx) =>
      tx.customFieldDef.create({
        data: {
          locationId: loc.id,
          key: dto.key,
          label: dto.label,
          type: dto.type,
          options: dto.options ?? [],
        },
      }),
    );
  }

  @Get()
  list(@CurrentLocation() loc: Location) {
    return this.prisma.withLocation(loc.id, (tx) =>
      tx.customFieldDef.findMany({ orderBy: { createdAt: "asc" } }),
    );
  }

  @Delete(":key")
  remove(@CurrentLocation() loc: Location, @Param("key") key: string) {
    return this.prisma.withLocation(loc.id, (tx) =>
      tx.customFieldDef.delete({
        where: { locationId_key: { locationId: loc.id, key } },
      }),
    );
  }
}
