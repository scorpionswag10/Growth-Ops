import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Location } from "@growthops/db";
import { JwtAuthGuard } from "../auth/guards";
import { CurrentLocation, TenancyGuard } from "../tenancy/tenancy.guard";
import { PipelinesService } from "./pipelines.service";
import {
  CreateOpportunityDto,
  CreatePipelineDto,
  UpdateOpportunityDto,
} from "./dto";

@Controller("locations/:locationId")
@UseGuards(JwtAuthGuard, TenancyGuard)
export class PipelinesController {
  constructor(private pipelines: PipelinesService) {}

  @Post("pipelines")
  create(@CurrentLocation() loc: Location, @Body() dto: CreatePipelineDto) {
    return this.pipelines.create(loc.id, dto);
  }

  @Get("pipelines")
  list(@CurrentLocation() loc: Location) {
    return this.pipelines.list(loc.id);
  }

  @Get("pipelines/:pipelineId/board")
  board(
    @CurrentLocation() loc: Location,
    @Param("pipelineId") pipelineId: string,
  ) {
    return this.pipelines.board(loc.id, pipelineId);
  }

  @Post("pipelines/:pipelineId/opportunities")
  createOpportunity(
    @CurrentLocation() loc: Location,
    @Param("pipelineId") pipelineId: string,
    @Body() dto: CreateOpportunityDto,
  ) {
    return this.pipelines.createOpportunity(loc.id, pipelineId, dto);
  }

  @Patch("opportunities/:opportunityId")
  updateOpportunity(
    @CurrentLocation() loc: Location,
    @Param("opportunityId") opportunityId: string,
    @Body() dto: UpdateOpportunityDto,
  ) {
    return this.pipelines.updateOpportunity(loc.id, opportunityId, dto);
  }
}
