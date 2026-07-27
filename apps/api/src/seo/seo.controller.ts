import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsString, MinLength } from "class-validator";
import { Location } from "@growthops/db";
import { JwtAuthGuard } from "../auth/guards";
import { CurrentLocation, TenancyGuard } from "../tenancy/tenancy.guard";
import { EntitlementsGuard, RequireFeature } from "../tenancy/entitlements.guard";
import { SeoService } from "./seo.service";

class RunAuditDto {
  @IsString()
  @MinLength(3)
  url!: string;
}

@Controller("locations/:locationId/seo-audits")
@UseGuards(JwtAuthGuard, TenancyGuard, EntitlementsGuard)
@RequireFeature("seo")
export class SeoController {
  constructor(private seo: SeoService) {}

  @Post()
  run(@CurrentLocation() loc: Location, @Body() dto: RunAuditDto) {
    return this.seo.run(loc.id, dto.url);
  }

  @Get()
  list(@CurrentLocation() loc: Location) {
    return this.seo.list(loc.id);
  }

  @Get(":id")
  async get(@CurrentLocation() loc: Location, @Param("id") id: string) {
    const audit = await this.seo.get(loc.id, id);
    if (!audit) throw new NotFoundException("Audit not found");
    return audit;
  }
}
