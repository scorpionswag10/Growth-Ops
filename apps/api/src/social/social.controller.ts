import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";
import { Location } from "@growthops/db";
import { JwtAuthGuard } from "../auth/guards";
import { CurrentLocation, TenancyGuard } from "../tenancy/tenancy.guard";
import { EntitlementsGuard, RequireFeature } from "../tenancy/entitlements.guard";
import { SocialService } from "./social.service";

class CreatePostDto {
  @IsString()
  @MinLength(1)
  content!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  platforms!: string[];

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];
}

class UpdatePostDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  content?: string;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsOptional()
  @IsBoolean()
  cancel?: boolean;
}

@Controller("locations/:locationId/social-posts")
@UseGuards(JwtAuthGuard, TenancyGuard, EntitlementsGuard)
@RequireFeature("social")
export class SocialController {
  constructor(private social: SocialService) {}

  @Post()
  create(@CurrentLocation() loc: Location, @Body() dto: CreatePostDto) {
    return this.social.create(loc.id, dto);
  }

  @Get()
  list(@CurrentLocation() loc: Location) {
    return this.social.list(loc.id);
  }

  @Patch(":postId")
  update(
    @CurrentLocation() loc: Location,
    @Param("postId") postId: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.social.update(loc.id, postId, dto);
  }

  @Delete(":postId")
  remove(@CurrentLocation() loc: Location, @Param("postId") postId: string) {
    return this.social.remove(loc.id, postId);
  }
}
