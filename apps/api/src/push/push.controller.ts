import { Body, Controller, Delete, Get, Post, UseGuards } from "@nestjs/common";
import { IsObject, IsString } from "class-validator";
import { CurrentUser, JwtAuthGuard } from "../auth/guards";
import { JwtPayload } from "../auth/auth.service";
import { PushService } from "./push.service";

class SubscribeDto {
  @IsString()
  endpoint!: string;

  @IsObject()
  keys!: { p256dh: string; auth: string };
}

class UnsubscribeDto {
  @IsString()
  endpoint!: string;
}

@Controller("push")
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private push: PushService) {}

  @Post("subscribe")
  subscribe(@CurrentUser() user: JwtPayload, @Body() dto: SubscribeDto) {
    return this.push.subscribe(user.sub, dto);
  }

  @Post("unsubscribe")
  unsubscribe(@Body() dto: UnsubscribeDto) {
    return this.push.unsubscribe(dto.endpoint);
  }

  @Get("status")
  status(@CurrentUser() user: JwtPayload) {
    return this.push.status(user.sub);
  }
}
