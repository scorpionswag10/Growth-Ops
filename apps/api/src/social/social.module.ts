import { Module } from "@nestjs/common";
import { SocialController, SocialIntegrationsController } from "./social.controller";
import { SocialService } from "./social.service";
import { PostizPublisherService } from "./postiz-publisher.service";

@Module({
  controllers: [SocialController, SocialIntegrationsController],
  providers: [SocialService, PostizPublisherService],
  exports: [SocialService],
})
export class SocialModule {}
