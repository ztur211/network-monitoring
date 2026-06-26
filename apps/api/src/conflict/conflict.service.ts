import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { validateSync } from 'class-validator';
import { ChangesetDto } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { IRealtimeService, REALTIME_SERVICE } from '../realtime/realtime.types';

/** A create-DTO class whose decorators describe a writable field's rules. */
type FieldValidatorClass = new () => object;

@Injectable()
export class ConflictResolutionService {
  constructor(
    @Inject(REALTIME_SERVICE) private readonly realtimeService: IRealtimeService,
  ) {}

  buildUpdatePayload(
    changeset: ChangesetDto,
    writableFields: readonly string[],
    currentVersion: number,
    validatorClass?: FieldValidatorClass,
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
      if (validatorClass) {
        this.validateChangeValue(validatorClass, change.field, change.newValue);
      }
      payload[change.field] = change.newValue;
    }
    return payload;
  }

  /**
   * Validates a single changeset value against the create DTO's rules for that
   * field. Builds an instance carrying only the one field and runs class-validator
   * with `skipUndefinedProperties`, so exactly the patched field is checked with
   * the same decorators the create endpoint enforces (type, length, range, format)
   * — no rule duplication. A failure is bad client input → GEN_001 400, not a raw
   * Prisma type error mapped to 500.
   */
  private validateChangeValue(
    validatorClass: FieldValidatorClass,
    field: string,
    newValue: unknown,
  ): void {
    const instance = new validatorClass() as Record<string, unknown>;
    instance[field] = newValue;
    const errors = validateSync(instance as object, {
      skipUndefinedProperties: true,
      forbidUnknownValues: false,
    });
    if (errors.length > 0) {
      throw new NodeScopeException(
        'GEN_001',
        `Invalid value for field '${field}'`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  emitEntityEvent(event: string, payload: Record<string, unknown>, organizationId: string): void {
    this.realtimeService.pushToOrg(organizationId, event, {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  async emitScoped(
    orgId: string,
    governingSiteId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.realtimeService.emitScoped(orgId, governingSiteId, event, {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  async emitScopedMulti(
    orgId: string,
    governingSiteIds: string[],
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.realtimeService.emitScopedMulti(orgId, governingSiteIds, event, {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  /** Force-disconnect a removed member's live sockets so their stale org state cannot linger. */
  async evictOrgMember(orgId: string, userId: string): Promise<void> {
    await this.realtimeService.evictOrgMember(orgId, userId);
  }
}
