import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Location } from "@growthops/db";
import { CurrentUser, JwtAuthGuard } from "../auth/guards";
import { JwtPayload } from "../auth/auth.service";
import { CurrentLocation, TenancyGuard } from "../tenancy/tenancy.guard";
import { ContactsService } from "./contacts.service";
import { TagsDto, UpsertContactDto } from "./dto";

@Controller("locations/:locationId/contacts")
@UseGuards(JwtAuthGuard, TenancyGuard)
export class ContactsController {
  constructor(private contacts: ContactsService) {}

  // Upsert semantics: resolves identity on email, then phone. Returns the
  // existing (merged) contact rather than erroring on duplicates.
  @Post()
  upsert(@CurrentLocation() loc: Location, @Body() dto: UpsertContactDto) {
    return this.contacts.upsert(loc.id, dto);
  }

  @Get()
  list(
    @CurrentLocation() loc: Location,
    @Query("q") q?: string,
    @Query("tag") tag?: string,
    @Query("take") take?: string,
    @Query("skip") skip?: string,
  ) {
    return this.contacts.list(loc.id, {
      q,
      tag,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  // Declared before :id so "tags" isn't swallowed by the param route.
  @Get("tags")
  tags(@CurrentLocation() loc: Location) {
    return this.contacts.distinctTags(loc.id);
  }

  @Get(":id")
  get(@CurrentLocation() loc: Location, @Param("id") id: string) {
    return this.contacts.get(loc.id, id);
  }

  @Patch(":id")
  update(
    @CurrentLocation() loc: Location,
    @Param("id") id: string,
    @Body() dto: UpsertContactDto,
  ) {
    return this.contacts.update(loc.id, id, dto);
  }

  @Delete(":id")
  remove(
    @CurrentLocation() loc: Location,
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ) {
    return this.contacts.remove(loc.id, id, user.sub);
  }

  @Post(":id/tags")
  addTags(
    @CurrentLocation() loc: Location,
    @Param("id") id: string,
    @Body() dto: TagsDto,
  ) {
    return this.contacts.addTags(loc.id, id, dto.tags);
  }

  @Delete(":id/tags/:tag")
  removeTag(
    @CurrentLocation() loc: Location,
    @Param("id") id: string,
    @Param("tag") tag: string,
  ) {
    return this.contacts.removeTag(loc.id, id, tag);
  }
}
