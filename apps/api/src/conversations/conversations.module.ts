import { Module } from "@nestjs/common";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";
import { DispatcherRegistry } from "./dispatcher";

@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService, DispatcherRegistry],
  exports: [ConversationsService, DispatcherRegistry],
})
export class ConversationsModule {}
