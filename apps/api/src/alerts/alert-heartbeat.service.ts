import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const LOCK = 'nodescope:lock:alert_heartbeat';
type Fetch = typeof fetch;

@Injectable()
export class AlertHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertHeartbeatService.name);
  private timer?: ReturnType<typeof setInterval>;

  // fetchFn is test-injected; @Optional() stops Nest from trying to resolve the bare
  // `Function` design-type as a DI token (see webhook.channel.ts for the full rationale).
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService, @Optional() private readonly fetchFn: Fetch = fetch) {}

  onModuleInit(): void {
    const ms = Number(process.env.ALERT_HEARTBEAT_INTERVAL_SECONDS ?? 60) * 1000;
    this.timer = setInterval(() => void this.cycle(), ms);
    if (this.timer.unref) this.timer.unref();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async cycle(): Promise<void> {
    try {
      const ok = await this.redis.set(LOCK, '1', 'EX', Number(process.env.ALERT_HEARTBEAT_INTERVAL_SECONDS ?? 60), 'NX');
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
