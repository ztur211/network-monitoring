import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AlertRepository } from './alert.repository';
import { RedisService } from '../redis/redis.service';
import { CHANNEL_DISPATCHER, ChannelDispatcher } from './channel-dispatcher';

const LOCK = 'nodescope:lock:alert_deliver';

export function backoffMs(attempts: number): number {
  return Math.min(5000 * 2 ** attempts, 3_600_000);
}

@Injectable()
export class AlertDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertDeliveryService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly repo: AlertRepository,
    @Inject(CHANNEL_DISPATCHER) private readonly dispatcher: ChannelDispatcher,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    const ms = Number(process.env.ALERT_DELIVER_INTERVAL_SECONDS ?? 15) * 1000;
    this.timer = setInterval(() => void this.cycle(), ms);
    if (this.timer.unref) this.timer.unref();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async cycle(): Promise<void> {
    try {
      const ok = await this.redis.set(LOCK, '1', 'EX', Number(process.env.ALERT_DELIVER_INTERVAL_SECONDS ?? 15), 'NX');
      if (!ok) return;
      await this.drainOnce(new Date());
    } catch (err) {
      this.logger.error({ err }, 'delivery cycle failed');
    }
  }

  async drainOnce(now: Date): Promise<void> {
    const maxAttempts = Number(process.env.ALERT_MAX_ATTEMPTS ?? 10);
    const due = await this.repo.dueDeliveries(now, 50);
    const channels = new Map((await this.repo.channelsByIds(due.map((d) => d.channelId))).map((c) => [c.id, c]));
    for (const d of due) {
      const channel = channels.get(d.channelId);
      if (!channel || !channel.enabled) {
        await this.repo.markDelivery(d.id, { status: 'GAVE_UP', lastError: 'channel missing or disabled', lastAttemptAt: now });
        continue;
      }
      try {
        await this.dispatcher.dispatch(channel, d.event);
        await this.repo.markDelivery(d.id, { status: 'SENT', lastAttemptAt: now });
      } catch (err) {
        const attempts = d.attempts + 1;
        const msg = err instanceof Error ? err.message : String(err);
        if (attempts >= maxAttempts) {
          await this.repo.markDelivery(d.id, { status: 'GAVE_UP', attempts, lastError: msg, lastAttemptAt: now });
        } else {
          await this.repo.markDelivery(d.id, {
            status: 'FAILED', attempts, lastError: msg, lastAttemptAt: now,
            nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
          });
        }
      }
    }
  }
}
