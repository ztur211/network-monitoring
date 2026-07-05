import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const LOCK = 'nodescope:lock:alert_heartbeat';
type Fetch = typeof fetch;

@Injectable()
export class AlertHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertHeartbeatService.name);
  private timer?: ReturnType<typeof setInterval>;
  // Parsed once so the interval and the lock TTL can never drift apart (they used to be
  // parsed independently in onModuleInit and cycle).
  private readonly intervalSeconds = Number(process.env.ALERT_HEARTBEAT_INTERVAL_SECONDS ?? 60);

  // fetchFn is test-injected; @Optional() stops Nest from trying to resolve the bare
  // `Function` design-type as a DI token (see webhook.channel.ts for the full rationale).
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService, @Optional() private readonly fetchFn: Fetch = fetch) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.cycle(), this.intervalSeconds * 1000);
    if (this.timer.unref) this.timer.unref();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async cycle(): Promise<void> {
    try {
      const ok = await this.redis.set(LOCK, '1', 'EX', this.intervalSeconds, 'NX');
      if (!ok) return;
      await this.beatOnce();
    } catch (err) {
      this.logger.error({ err }, 'heartbeat cycle failed');
    }
  }

  async beatOnce(): Promise<void> {
    const url = process.env.ALERT_HEARTBEAT_URL;
    if (!url) return;
    try {
      const down = await this.prisma.deviceStatus.count({ where: { state: 'DOWN' } });
      await this.fetchFn(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ at: new Date().toISOString(), devicesDown: down }),
      });
    } catch (err) {
      this.logger.warn({ err }, 'heartbeat POST failed (external dead-man switch will flag silence)');
    }
  }
}
