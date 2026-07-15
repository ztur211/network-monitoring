import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import { INGEST_MAX_CHECKS_PER_BATCH, INGEST_MAX_METRICS_PER_BATCH } from './ingest.dto';

/**
 * Rejects an over-cap ingest batch with 413 Payload Too Large.
 *
 * Why a guard and not just the @ArrayMaxSize on IngestBatchDto? Because of the STATUS CODE, which
 * for this endpoint is a control signal, not decoration:
 *
 *   - 413 tells the agent "this batch is too big" -> it splits it and retries. No data is lost.
 *   - 400 tells the agent "this batch is malformed" -> it drops it. Data IS lost (and rightly so:
 *     a poison batch must not retry forever).
 *
 * The global ValidationPipe raises BadRequestException for every constraint it fails, @ArrayMaxSize
 * included - so an over-cap batch would come back 400 and the agent would DESTROY it. That is the
 * exact bug this endpoint already had once, just relocated. Nest runs guards BEFORE pipes, so this
 * guard sees the parsed body first and converts "too many items" into the retryable 413 before the
 * pipe can call it malformed.
 *
 * @ArrayMaxSize stays on the DTO regardless: it documents the contract, shares these same constants
 * so the two cannot drift, and remains a backstop if this guard is ever dropped from the route.
 */
@Injectable()
export class IngestBatchSizeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ body?: { checks?: unknown; metrics?: unknown } }>();
    const body = req.body ?? {};
    const checks = Array.isArray(body.checks) ? body.checks.length : 0;
    const metrics = Array.isArray(body.metrics) ? body.metrics.length : 0;

    if (checks > INGEST_MAX_CHECKS_PER_BATCH || metrics > INGEST_MAX_METRICS_PER_BATCH) {
      throw new NodeScopeException(
        'GEN_005',
        `INGEST_BATCH_TOO_LARGE: max ${INGEST_MAX_CHECKS_PER_BATCH} checks and ` +
          `${INGEST_MAX_METRICS_PER_BATCH} metrics per batch (got ${checks} / ${metrics}); split and retry`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    return true;
  }
}
