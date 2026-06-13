import { Test } from '@nestjs/testing';
import { AuditService } from '../audit.service';
import { ChangeLogRepository } from '../change-log.repository';
import { auditAls } from '../audit.als';

describe('AuditService', () => {
  let service: AuditService;
  let repo: { createMany: jest.Mock };

  beforeEach(async () => {
    repo = { createMany: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [AuditService, { provide: ChangeLogRepository, useValue: repo }],
    }).compile();
    service = moduleRef.get(AuditService);
  });

  it('writes one CREATE row with a snapshot and the actor from context', async () => {
    await auditAls.run(
      { requestId: 'req-1', userId: 'u1', ipAddress: '1.2.3.4', userAgent: 'jest' },
      async () => service.recordCreate('org1', 'Device', { id: 'd1', name: 'X' }),
    );
    expect(repo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        organizationId: 'org1', userId: 'u1', requestId: 'req-1',
        action: 'CREATE', entityType: 'Device', entityId: 'd1',
        field: null, snapshot: { id: 'd1', name: 'X' }, ipAddress: '1.2.3.4', userAgent: 'jest',
      }),
    ]);
  });

  it('writes one UPDATE row per changed field sharing the requestId', async () => {
    await auditAls.run(
      { requestId: 'req-2', userId: 'u1', ipAddress: null, userAgent: null },
      async () => service.recordUpdate('org1', 'Device', 'd1', [
        { field: 'name', oldValue: 'A', newValue: 'B' },
        { field: 'floor', oldValue: 1, newValue: 2 },
      ]),
    );
    const rows = repo.createMany.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.requestId === 'req-2' && r.action === 'UPDATE')).toBe(true);
  });
});
