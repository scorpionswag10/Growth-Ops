import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Location } from "@growthops/db";
import { CurrentUser, JwtAuthGuard } from "../auth/guards";
import { JwtPayload } from "../auth/auth.service";
import { CurrentLocation, TenancyGuard } from "../tenancy/tenancy.guard";
import { ConversationsService } from "./conversations.service";
import { IngestMessageDto, SendMessageDto } from "./dto";

@Controller("locations/:locationId")
@UseGuards(JwtAuthGuard, TenancyGuard)
export class ConversationsController {
  constructor(private conversations: ConversationsService) {}

  @Get("conversations")
  list(
    @CurrentLocation() loc: Location,
    @Query("unread") unread?: string,
    @Query("take") take?: string,
    @Query("skip") skip?: string,
  ) {
    return this.conversations.list(loc.id, {
      unread: unread === "true",
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get("conversations/:conversationId")
  get(
    @CurrentLocation() loc: Location,
    @Param("conversationId") conversationId: string,
    @Query("take") take?: string,
    @Query("skip") skip?: string,
  ) {
    return this.conversations.get(loc.id, conversationId, {
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Post("conversations/:conversationId/read")
  markRead(
    @CurrentLocation() loc: Location,
    @Param("conversationId") conversationId: string,
  ) {
    return this.conversations.markRead(loc.id, conversationId);
  }

  @Post("contacts/:contactId/messages")
  send(
    @CurrentLocation() loc: Location,
    @Param("contactId") contactId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.conversations.send(
      loc,
      contactId,
      dto.channel,
      dto.body,
      user.sub,
    );
  }

  // Manual/simulated ingestion: log a phone call, paste an outside thread, or
  // (until provider webhooks land) record an inbound message by hand.
  @Post("contacts/:contactId/messages/ingest")
  ingest(
    @CurrentLocation() loc: Location,
    @Param("contactId") contactId: string,
    @Body() dto: IngestMessageDto,
  ) {
    return this.conversations.ingest(loc.id, contactId, {
      channel: dto.channel,
      direction: dto.direction,
      body: dto.body,
      providerMessageId: dto.providerMessageId,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
    });
  }
}
