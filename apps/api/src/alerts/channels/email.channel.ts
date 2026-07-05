import { Injectable } from '@nestjs/common';
import { AlertChannel, AlertEvent } from '@prisma/client';
import { createTransport, Transporter } from 'nodemailer';
import { CryptoService } from '../../common/crypto/crypto.service';

type Cfg = { host: string; port: number; fromAddr: string; toAddrs: string[]; username?: string; secure?: boolean };

@Injectable()
export class EmailChannel {
  constructor(private readonly crypto: CryptoService, private readonly make: typeof createTransport = createTransport) {}

  async send(channel: AlertChannel, event: AlertEvent): Promise<void> {
    const c = channel.config as unknown as Cfg;
    if (!c?.host || !c?.fromAddr || !c?.toAddrs?.length) throw new Error('email channel misconfigured');
    const t: Transporter = this.make({
      host: c.host, port: c.port ?? 587, secure: c.secure ?? false,
      auth: channel.secretEnc && c.username ? { user: c.username, pass: this.crypto.decrypt(channel.secretEnc) } : undefined,
    });
    const subject = `[NodeScope ${event.severity}] ${event.kind === 'FIRING' ? 'ALERT' : 'RESOLVED'}: device ${event.deviceId ?? ''}`;
    await t.sendMail({ from: c.fromAddr, to: c.toAddrs.join(','), subject, text: JSON.stringify(event.detail, null, 2) });
  }
}
