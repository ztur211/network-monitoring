import { Injectable } from '@nestjs/common';
import { AlertChannel, AlertEvent } from '@prisma/client';
import { ChannelDispatcher } from '../channel-dispatcher';
import { WebhookChannel } from './webhook.channel';
import { EmailChannel } from './email.channel';
import { InAppChannel } from './inapp.channel';

@Injectable()
export class ChannelDispatcherImpl implements ChannelDispatcher {
  constructor(private readonly webhook: WebhookChannel, private readonly email: EmailChannel, private readonly inapp: InAppChannel) {}

  dispatch(channel: AlertChannel, event: AlertEvent): Promise<void> {
    switch (channel.type) {
      case 'WEBHOOK': return this.webhook.send(channel, event);
      case 'EMAIL': return this.email.send(channel, event);
      case 'INAPP': return this.inapp.send(channel, event);
      default: return Promise.reject(new Error(`unknown channel type: ${channel.type}`));
    }
  }
}
