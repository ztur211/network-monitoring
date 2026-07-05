import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { AlertRepository } from './alert.repository';
import { AlertDedupService } from './alert-dedup.service';
import { AlertEvaluatorService } from './alert-evaluator.service';
import { AlertMetricEvaluatorService, METRIC_READER } from './alert-metric-evaluator.service';
import { TimescaleMetricReader } from './timescale-metric-reader';
import { AlertDeliveryService } from './alert-delivery.service';
import { CHANNEL_DISPATCHER } from './channel-dispatcher';
import { ChannelDispatcherImpl } from './channels/channel-dispatcher.impl';
import { WebhookChannel } from './channels/webhook.channel';
import { EmailChannel } from './channels/email.channel';
import { InAppChannel } from './channels/inapp.channel';
import { AlertHeartbeatService } from './alert-heartbeat.service';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';

@Module({
  imports: [PrismaModule, RedisModule, CryptoModule, ConflictResolutionModule],
  controllers: [AlertsController],
  providers: [
    AlertRepository, AlertDedupService, AlertEvaluatorService,
    AlertMetricEvaluatorService, { provide: METRIC_READER, useClass: TimescaleMetricReader },
    AlertDeliveryService, WebhookChannel, EmailChannel, InAppChannel,
    { provide: CHANNEL_DISPATCHER, useClass: ChannelDispatcherImpl },
    AlertHeartbeatService, AlertsService,
  ],
  exports: [AlertEvaluatorService],
})
export class AlertModule {}
