import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Per-org ingest secret: the plaintext is shown once at (re)generation; only its
 * sha256 is stored. verify() resolves a presented token back to its org (or null).
 */
@Injectable()
export class IngestTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrRotate(organizationId: string): Promise<string> {
    const secret = randomBytes(32).toString('base64url');
    const tokenHash = hash(secret);
    await this.prisma.monitoringIngestToken.upsert({
      where: { organizationId },
      create: { organizationId, tokenHash },
      update: { tokenHash },
    });
    return secret; // shown once; only the hash is persisted
  }

  async verify(token: string): Promise<string | null> {
    if (!token) return null;
    const row = await this.prisma.monitoringIngestToken.findFirst({
      where: { tokenHash: hash(token) },
      select: { organizationId: true },
    });
    return row?.organizationId ?? null;
  }
}
