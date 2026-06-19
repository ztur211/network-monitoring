import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { AgentRepository } from './agent.repository';
import { PrismaService } from '../prisma/prisma.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const CODE_TTL_MS = 15 * 60 * 1000; // enrollment codes are valid for 15 minutes

/**
 * Agent enrollment + token verification.
 *
 * - `generateEnrollmentCode` mints a short-lived, single-use code (only its hash
 *   is stored) that an operator hands to a collector.
 * - `enroll` exchanges a valid code for a persistent agent token (again, only the
 *   hash is stored; the plaintext is returned once). The code is consumed
 *   atomically inside a transaction — concurrent enrollments with the same code
 *   are rejected via an `updateMany` optimistic-lock guard.
 * - `verifyToken` resolves a presented token back to {orgId, agentId}, or null
 *   for unknown / revoked agents.
 */
@Injectable()
export class AgentTokenService {
  constructor(
    private readonly repo: AgentRepository,
    private readonly prisma: PrismaService,
  ) {}

  async generateEnrollmentCode(
    organizationId: string,
    memberId: string | null,
  ): Promise<string> {
    const code = randomBytes(18).toString('base64url');
    await this.repo.createCode({
      organizationId,
      codeHash: hash(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      createdByMemberId: memberId,
    });
    return code; // shown once; only the hash is persisted
  }

  async enroll(
    code: string,
    info: { name: string; platform: string; version: string },
  ): Promise<{ agentId: string; token: string }> {
    const codeHash = hash(code);
    return this.prisma.$transaction(async (tx) => {
      // 1. Read — find a valid (unused, unexpired) code row.
      const row = await tx.agentEnrollmentCode.findFirst({
        where: { codeHash, usedAt: null, expiresAt: { gt: new Date() } },
      });
      if (!row) {
        throw new NodeScopeException(
          'AGENT_001',
          'Invalid or expired enrollment code',
          HttpStatus.UNAUTHORIZED,
        );
      }
      // 2. Atomic claim — updateMany returns count === 0 when a concurrent
      //    transaction already set usedAt, so only one caller wins.
      const claimed = await tx.agentEnrollmentCode.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new NodeScopeException(
          'AGENT_001',
          'Invalid or expired enrollment code',
          HttpStatus.UNAUTHORIZED,
        );
      }
      // 3. Create the agent with a fresh token (hash stored; plaintext returned once).
      const token = randomBytes(32).toString('base64url');
      const agent = await tx.agent.create({
        data: {
          organizationId: row.organizationId,
          name: info.name,
          platform: info.platform,
          version: info.version,
          status: 'APPROVED',
          tokenHash: hash(token),
          createdByMemberId: row.createdByMemberId,
        },
      });
      return { agentId: agent.id, token };
    });
  }

  async verifyToken(
    token: string,
  ): Promise<{ orgId: string; agentId: string } | null> {
    if (!token) return null;
    const a = await this.repo.findByTokenHash(hash(token));
    if (!a || a.status === 'REVOKED') return null;
    return { orgId: a.organizationId, agentId: a.id };
  }
}
