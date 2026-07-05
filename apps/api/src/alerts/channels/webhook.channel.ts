import { Injectable, Optional } from '@nestjs/common';
import { AlertChannel, AlertEvent } from '@prisma/client';
import { CryptoService } from '../../common/crypto/crypto.service';

type Fetch = typeof fetch;

const WEBHOOK_TIMEOUT_MS = Number(process.env.ALERT_WEBHOOK_TIMEOUT_MS ?? 10000);

@Injectable()
export class WebhookChannel {
  // fetchFn is test-injected; @Optional() stops Nest from trying to resolve the
  // bare `Function` design-type as a DI token (it has no provider) — without it,
  // real app boot throws "can't resolve dependencies ... Function". Optional lets
  // Nest pass `undefined` when nothing is bound, so the JS default (`= fetch`) applies.
  constructor(private readonly crypto: CryptoService, @Optional() private readonly fetchFn: Fetch = fetch) {}

  async send(channel: AlertChannel, event: AlertEvent): Promise<void> {
    const url = (channel.config as { url?: string })?.url;
    if (!url) throw new Error('webhook channel has no url');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (channel.secretEnc) headers.Authorization = `Bearer ${this.crypto.decrypt(channel.secretEnc)}`;
    const body = JSON.stringify({
      kind: event.kind, severity: event.severity, deviceId: event.deviceId,
      detail: event.detail, at: event.createdAt,
    });
    const res = await this.fetchFn(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`webhook POST failed: HTTP ${res.status}`);
  }
}
