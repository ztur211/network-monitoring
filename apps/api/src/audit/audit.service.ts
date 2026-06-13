import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { auditAls } from './audit.als';
import { ChangeLogRepository } from './change-log.repository';

interface FieldChange { field: string; oldValue: unknown; newValue: unknown; }

@Injectable()
export class AuditService {
  constructor(private readonly repo: ChangeLogRepository) {}

  private base(organizationId: string, entityType: string, entityId: string) {
    const ctx = auditAls.getStore();
    return {
      organizationId,
      userId: ctx?.userId ?? null,
      requestId: ctx?.requestId ?? 'unknown',
      ipAddress: ctx?.ipAddress ?? null,
      userAgent: ctx?.userAgent ?? null,
      entityType,
      entityId,
    };
  }

  async recordCreate(
    organizationId: string,
    entityType: string,
    entity: { id: string } & Record<string, unknown>,
  ): Promise<void> {
    await this.repo.createMany([{
      ...this.base(organizationId, entityType, entity.id),
      action: 'CREATE',
      field: null,
      oldValue: null,
      newValue: null,
      snapshot: entity as Prisma.InputJsonValue,
    }]);
  }

  async recordUpdate(
    organizationId: string,
    entityType: string,
    entityId: string,
    changes: FieldChange[],
  ): Promise<void> {
    const b = this.base(organizationId, entityType, entityId);
    await this.repo.createMany(changes.map((c) => ({
      ...b,
      action: 'UPDATE',
      field: c.field,
      oldValue: c.oldValue == null ? null : String(c.oldValue),
      newValue: c.newValue == null ? null : String(c.newValue),
      snapshot: undefined,
    })));
  }

  async recordDelete(
    organizationId: string,
    entityType: string,
    entity: { id: string } & Record<string, unknown>,
  ): Promise<void> {
    await this.repo.createMany([{
      ...this.base(organizationId, entityType, entity.id),
      action: 'DELETE',
      field: null,
      oldValue: null,
      newValue: null,
      snapshot: entity as Prisma.InputJsonValue,
    }]);
  }
}
