import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictResolutionService } from '../conflict.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import { ChangesetDto, WS_EVENTS } from '@nodescope/shared';
import { REALTIME_SERVICE } from '../../realtime/realtime.types';
import { CreateDeviceDto, DEVICE_WRITABLE_FIELDS } from '../../devices/devices.dto';

const mockRealtimeService = { pushToUser: jest.fn(), pushToOrg: jest.fn() };

/** Asserts a call throws a NodeScopeException carrying GEN_001 / 400. */
function expectGen001BadRequest(fn: () => unknown): void {
  expect(fn).toThrow(NodeScopeException);
  try {
    fn();
  } catch (err) {
    expect((err as NodeScopeException).code).toBe('GEN_001');
    expect((err as NodeScopeException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
  }
}

describe('ConflictResolutionService', () => {
  let service: ConflictResolutionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConflictResolutionService,
        { provide: REALTIME_SERVICE, useValue: mockRealtimeService },
      ],
    }).compile();

    service = module.get<ConflictResolutionService>(ConflictResolutionService);
    jest.clearAllMocks();
  });

  describe('buildUpdatePayload', () => {
    const writableFields = ['name', 'notes'] as const;

    it('returns update payload for valid changeset', () => {
      const changeset: ChangesetDto = {
        baseVersion: 1,
        changes: [{ field: 'name', oldValue: 'Old', newValue: 'New' }],
      };
      const result = service.buildUpdatePayload(changeset, writableFields, 1);
      expect(result).toEqual({ name: 'New' });
    });

    it('builds payload with multiple changes', () => {
      const changeset: ChangesetDto = {
        baseVersion: 1,
        changes: [
          { field: 'name', oldValue: 'Old', newValue: 'New' },
          { field: 'notes', oldValue: null, newValue: 'Added notes' },
        ],
      };
      const result = service.buildUpdatePayload(changeset, writableFields, 1);
      expect(result).toEqual({ name: 'New', notes: 'Added notes' });
    });

    it('throws SYNC_001 NodeScopeException when baseVersion does not match', () => {
      const changeset: ChangesetDto = {
        baseVersion: 2,
        changes: [{ field: 'name', oldValue: 'Old', newValue: 'New' }],
      };
      expect(() => service.buildUpdatePayload(changeset, writableFields, 1)).toThrow(NodeScopeException);
    });

    it('throws GEN_001 NodeScopeException when field is not writable', () => {
      const changeset: ChangesetDto = {
        baseVersion: 1,
        changes: [{ field: 'id', oldValue: '1', newValue: '2' }],
      };
      expect(() => service.buildUpdatePayload(changeset, writableFields, 1)).toThrow(NodeScopeException);
    });

    it('returns empty payload when changeset has no changes', () => {
      const changeset: ChangesetDto = { baseVersion: 1, changes: [] };
      const result = service.buildUpdatePayload(changeset, writableFields, 1);
      expect(result).toEqual({});
    });

    it('uses last value when changeset contains duplicate field entries', () => {
      const changeset: ChangesetDto = {
        baseVersion: 1,
        changes: [
          { field: 'name', oldValue: null, newValue: 'First' },
          { field: 'name', oldValue: 'First', newValue: 'Last' },
        ],
      };
      const result = service.buildUpdatePayload(changeset, writableFields, 1);
      expect(result).toEqual({ name: 'Last' });
    });

    it('rejects mixed changeset on the first non-writable field encountered', () => {
      const changeset: ChangesetDto = {
        baseVersion: 1,
        changes: [
          { field: 'name', oldValue: 'Old', newValue: 'New' },
          { field: 'createdAt', oldValue: '2026-01-01', newValue: '2027-01-01' },
          { field: 'notes', oldValue: null, newValue: 'never reached' },
        ],
      };
      expect(() => service.buildUpdatePayload(changeset, writableFields, 1)).toThrow(
        /createdAt/,
      );
    });
  });

  describe('buildUpdatePayload — per-field value validation', () => {
    // Reuses the real CreateDeviceDto decorators: the PATCH path must enforce the
    // same per-field rules (type, length, range, format) the create endpoint does,
    // instead of copying an unchecked value into the Prisma payload (which lets bad
    // data persist and 500s on a type mismatch).
    const fields = DEVICE_WRITABLE_FIELDS;
    const patch = (field: string, newValue: unknown): ChangesetDto => ({
      baseVersion: 1,
      changes: [{ field, oldValue: null, newValue }],
    });

    it('accepts a valid value and returns it in the payload', () => {
      const result = service.buildUpdatePayload(patch('name', 'Edge Router'), fields, 1, CreateDeviceDto);
      expect(result).toEqual({ name: 'Edge Router' });
    });

    it('accepts null for an optional field (clears it)', () => {
      const result = service.buildUpdatePayload(patch('notes', null), fields, 1, CreateDeviceDto);
      expect(result).toEqual({ notes: null });
    });

    it('rejects an over-length string (bypassed @MaxLength) with GEN_001 400', () => {
      expectGen001BadRequest(() =>
        service.buildUpdatePayload(patch('name', 'x'.repeat(101)), fields, 1, CreateDeviceDto),
      );
    });

    it('rejects a wrong-typed value instead of 500-ing in Prisma (string for latitude)', () => {
      expectGen001BadRequest(() =>
        service.buildUpdatePayload(patch('latitude', 'not-a-number'), fields, 1, CreateDeviceDto),
      );
    });

    it('rejects an out-of-range latitude', () => {
      expectGen001BadRequest(() =>
        service.buildUpdatePayload(patch('latitude', 999), fields, 1, CreateDeviceDto),
      );
    });

    it('rejects an invalid enum value for category', () => {
      expectGen001BadRequest(() =>
        service.buildUpdatePayload(patch('category', 'NOT_A_CATEGORY'), fields, 1, CreateDeviceDto),
      );
    });

    it('rejects a malformed macAddress', () => {
      expectGen001BadRequest(() =>
        service.buildUpdatePayload(patch('macAddress', 'xyz'), fields, 1, CreateDeviceDto),
      );
    });

    it('validates every change in a multi-field changeset', () => {
      const changeset: ChangesetDto = {
        baseVersion: 1,
        changes: [
          { field: 'name', oldValue: null, newValue: 'Valid Name' },
          { field: 'floor', oldValue: null, newValue: 'top-floor' }, // not an int
        ],
      };
      expectGen001BadRequest(() => service.buildUpdatePayload(changeset, fields, 1, CreateDeviceDto));
    });

    it('skips value validation when no validator class is supplied (back-compat)', () => {
      // Without a validator class the legacy behavior stands: the field name is
      // whitelisted but the value passes through unchecked.
      const result = service.buildUpdatePayload(patch('latitude', 'not-a-number'), fields, 1);
      expect(result).toEqual({ latitude: 'not-a-number' });
    });
  });

  describe('emitEntityEvent', () => {
    it('emits entity events to the org room, not a user room', () => {
      const entityPayload = { deviceId: 'd1' };
      service.emitEntityEvent(WS_EVENTS.DEVICE_UPDATED, entityPayload, 'org1');
      expect(mockRealtimeService.pushToOrg).toHaveBeenCalledWith(
        'org1',
        WS_EVENTS.DEVICE_UPDATED,
        expect.objectContaining({ deviceId: 'd1' }),
      );
      expect(mockRealtimeService.pushToUser).not.toHaveBeenCalled();
    });

    it('enriches the payload with a timestamp', () => {
      const entityPayload = { deviceId: 'dev-1', device: { id: 'dev-1' } };
      service.emitEntityEvent(WS_EVENTS.DEVICE_UPDATED, entityPayload, 'org-1');
      expect(mockRealtimeService.pushToOrg).toHaveBeenCalledWith(
        'org-1',
        WS_EVENTS.DEVICE_UPDATED,
        expect.objectContaining({ deviceId: 'dev-1', timestamp: expect.any(String) }),
      );
    });

    it('routes delete events to the org room', () => {
      service.emitEntityEvent(WS_EVENTS.DEVICE_DELETED, { deviceId: 'dev-1' }, 'org-1');
      expect(mockRealtimeService.pushToOrg).toHaveBeenCalledWith(
        'org-1',
        WS_EVENTS.DEVICE_DELETED,
        expect.objectContaining({ deviceId: 'dev-1' }),
      );
      expect(mockRealtimeService.pushToUser).not.toHaveBeenCalled();
    });
  });
});
