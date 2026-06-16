import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { RedisService } from '../redis/redis.service';

const CODE_TTL_SECONDS = 120;
const key = (code: string) => `desktop-auth:code:${code}`;

@Injectable()
export class DesktopAuthService {
  constructor(private readonly redis: RedisService) {}

  async issueCode(data: { sessionToken: string; challenge: string }): Promise<string> {
    const code = randomBytes(32).toString('base64url');
    await this.redis.set(key(code), JSON.stringify(data), 'EX', CODE_TTL_SECONDS);
    return code;
  }

  async exchange(code: string, verifier: string): Promise<string> {
    const raw = await this.redis.get(key(code));
    if (!raw) throw new NodeScopeException('DAUTH_002', 'CODE_INVALID_OR_EXPIRED', HttpStatus.BAD_REQUEST);
    await this.redis.del(key(code)); // one-time — del before verify prevents brute-force on a single code
    const { sessionToken, challenge } = JSON.parse(raw) as { sessionToken: string; challenge: string };
    const expected = createHash('sha256').update(verifier).digest('base64url');
    if (expected.length !== challenge.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(challenge))) {
      throw new NodeScopeException('DAUTH_003', 'PKCE_VERIFICATION_FAILED', HttpStatus.BAD_REQUEST);
    }
    return sessionToken;
  }
}
