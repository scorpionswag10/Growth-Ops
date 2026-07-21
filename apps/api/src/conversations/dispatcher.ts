import { Injectable } from "@nestjs/common";
import { Message, MessageChannel } from "@growthops/db";

export interface DispatchResult {
  providerMessageId?: string;
  providerMeta?: Record<string, unknown>;
}

/**
 * A channel provider (Twilio for SMS, Meta for FB/IG, ...) implements this
 * and registers itself. Outbound messages for a channel with no registered
 * dispatcher fail loudly — the channel is "wired but dark."
 */
export interface ChannelDispatcher {
  send(message: Message): Promise<DispatchResult>;
}

@Injectable()
export class DispatcherRegistry {
  private dispatchers = new Map<MessageChannel, ChannelDispatcher>();

  register(channel: MessageChannel, dispatcher: ChannelDispatcher) {
    this.dispatchers.set(channel, dispatcher);
  }

  get(channel: MessageChannel): ChannelDispatcher | undefined {
    return this.dispatchers.get(channel);
  }
}
