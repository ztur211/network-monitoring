import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { AgentRepository } from './agent.repository';
import { NodeScopeException } from '../common/filters/global-exception.filter';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const CODE_TTL_MS = 15 * 60 * 1000; // enrollment codes are valid for 15 minutes

/**
 * Agent enrollment + token verification.
 *
 * - `generateEnrollmentCode` mints a short-lived, single-use code (only its hash
 *   is stored) that an operator hands to a collector.
 * - `enroll` exchanges a valid code for a persistent agent token (again, only the
 *   hash is stored; the plaintext is returned once). The code is consumed.
 * - `verifyToken` resolves a presented token back to {orgId, agentId}, or null
 *   for unknown / revoked agents.
 */
@Injectable()
export class AgentTokenService {
  constructor(private readonly repo: AgentRepository) {}

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
    const row = await this.repo.findValidCode(hash(code));
    if (!row) {
      throw new NodeScopeException(
        'AGENT_001',
        'Invalid or expired enrollment code',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const token = randomBytes(32).toString('base64url');
    const agent = await this.repo.create({
      organizationId: row.organizationId,
      name: info.name,
      platform: info.platform,
      version: info.version,
      tokenHash: hash(token),
      createdByMemberId: row.createdByMemberId,
    });
    await this.repo.markCodeUsed(row.id); // single-use
    return { agentId: agent.id, token };
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
