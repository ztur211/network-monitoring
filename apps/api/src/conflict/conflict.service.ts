import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ChangesetDto } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { IRealtimeService, REALTIME_SERVICE } from '../realtime/realtime.types';

@Injectable()
export class ConflictResolutionService {
  constructor(
    @Inject(REALTIME_SERVICE) private readonly realtimeService: IRealtimeService,
  ) {}

  buildUpdatePayload(
    changeset: ChangesetDto,
    writableFields: readonly string[],
    currentVersion: number,
  ): Record<string, unknown> {
    if (changeset.baseVersion !== currentVersion) {
      throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    }

    const payload: Record<string, unknown> = {};
    for (const change of changeset.changes) {
      if (!writableFields.includes(change.field)) {
        throw new NodeScopeException(
          'GEN_001',
          `Field '${change.field}' is not writable`,
          HttpStatus.BAD_REQUEST,
        );
      }
      payload[change.field] = change.newValue;
    }
    return payload;
  }

  emitEntityEvent(event: string, payload: Record<string, unknown>, userId: string): void {
    this.realtimeService.pushToUser(userId, event, {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }
}
