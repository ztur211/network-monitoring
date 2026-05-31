import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RedisService } from '../../redis/redis.service';

const IDEMPOTENCY_HEADER = 'idempotency-key';
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * Makes a write endpoint idempotent on a client-supplied `Idempotency-Key`
 * header, scoped to the authenticated user. If a request carrying a key that
 * already produced a response replays — e.g. the original POST reached the
 * server but its response was lost and the offline queue retried it — the
 * cached response is returned instead of running the handler again, so the
 * write isn't duplicated.
 *
 * Best-effort: a missing header (or unauthenticated request) falls straight
 * through. Uses a simple GET-then-SET, which is sufficient for offline replay
 * (the original and its retry are never concurrent); it does not guard two
 * genuinely-simultaneous requests that share a key.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly redis: RedisService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const key = req.header(IDEMPOTENCY_HEADER);
    const userId = req.user?.id;

    if (!key || !userId) {
      return next.handle();
    }

    const redisKey = `idempotency:${userId}:${key}`;

    let cached: string | null = null;
    try {
      cached = await this.redis.get(redisKey);
    } catch (err) {
      // Best-effort: a Redis read failure must not 500 the create. Treat it as
      // a cache miss and run the handler (the write-back below is already
      // fire-and-forget, so the whole interceptor degrades to a no-op).
      this.logger.warn({ err, redisKey }, 'Idempotency cache read failed — proceeding without dedup');
      return next.handle();
    }
    if (cached) {
      try {
        return of(JSON.parse(cached) as unknown);
      } catch {
        // Corrupt cache entry — fall through and recompute.
      }
    }

    return next.handle().pipe(
      tap((response) => {
        void this.redis.set(
          redisKey,
          JSON.stringify(response),
          'EX',
          IDEMPOTENCY_TTL_SECONDS,
        );
      }),
    );
  }
}
