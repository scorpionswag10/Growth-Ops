import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { LocationsModule } from "./locations/locations.module";
import { CostEventsModule } from "./cost-events/cost-events.module";
import { ContactsModule } from "./contacts/contacts.module";
import { PipelinesModule } from "./pipelines/pipelines.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { BookingModule } from "./booking/booking.module";
import { ReportModule } from "./report/report.module";
import { WorkflowsModule } from "./workflows/workflows.module";
import { SocialModule } from "./social/social.module";
import { AiModule } from "./ai/ai.module";
import { InvitesModule } from "./invites/invites.module";
import { PushModule } from "./push/push.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuthModule,
    LocationsModule,
    CostEventsModule,
    ContactsModule,
    PipelinesModule,
    WebhooksModule,
    ConversationsModule,
    BookingModule,
    ReportModule,
    WorkflowsModule,
    SocialModule,
    AiModule,
    InvitesModule,
    PushModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
