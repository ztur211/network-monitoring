import { Test } from '@nestjs/testing';
import { NetworkPropertyService } from '../network-property.service';
import { NetworkPropertyRepository } from '../network-property.repository';
import { PropertiesRepository } from '../properties.repository';
import { ContainmentService } from '../containment.service';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { AuditService } from '../../audit/audit.service';

const charterRepoMock = () => ({
  listByNetwork: jest.fn(),
  existsCharter: jest.fn(),
  create: jest.fn(),
  deleteByNetworkAndProperty: jest.fn(),
  propertyIdsByNetwork: jest.fn(),
});
const propsRepoMock = () => ({ findByIdAndOrgId: jest.fn() });
const containmentMock = () => ({ assertCharterRemovable: jest.fn() });
const conflictMock = () => ({ emitEntityEvent: jest.fn() });
const auditMock = () => ({ recordCreate: jest.fn(), recordDelete: jest.fn() });

describe('NetworkPropertyService', () => {
  let svc: NetworkPropertyService;
  let charterRepo: ReturnType<typeof charterRepoMock>;
  let propsRepo: ReturnType<typeof propsRepoMock>;
  let containment: ReturnType<typeof containmentMock>;
  let conflict: ReturnType<typeof conflictMock>;
  let audit: ReturnType<typeof auditMock>;

  beforeEach(async () => {
    charterRepo = charterRepoMock();
    propsRepo = propsRepoMock();
    containment = containmentMock();
    conflict = conflictMock();
    audit = auditMock();

    const m = await Test.createTestingModule({
      providers: [
        NetworkPropertyService,
        { provide: NetworkPropertyRepository, useValue: charterRepo },
        { provide: PropertiesRepository, useValue: propsRepo },
        { provide: ContainmentService, useValue: containment },
        { provide: ConflictResolutionService, useValue: conflict },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    svc = m.get(NetworkPropertyService);
  });

  describe('list', () => {
    it('returns mapped DTOs from the repository', async () => {
      charterRepo.listByNetwork.mockResolvedValue([
        { id: 'c1', networkId: 'net1', propertyId: 'prop1', organizationId: 'o1', createdAt: new Date() },
      ]);
      const result = await svc.list('o1', 'net1');
      expect(result).toEqual([{ id: 'c1', networkId: 'net1', propertyId: 'prop1' }]);
    });
  });

  describe('add', () => {
    it('throws PROP_001 when property does not exist in the org', async () => {
      propsRepo.findByIdAndOrgId.mockResolvedValue(null);
      await expect(svc.add('o1', 'net1', 'missing-prop')).rejects.toMatchObject({ code: 'PROP_001' });
    });

    it('throws PROP_006 when charter already exists', async () => {
      propsRepo.findByIdAndOrgId.mockResolvedValue({ id: 'prop1' });
      charterRepo.existsCharter.mockResolvedValue({ id: 'existing-charter' });
      await expect(svc.add('o1', 'net1', 'prop1')).rejects.toMatchObject({ code: 'PROP_006' });
    });

    it('creates the charter and emits the event on success', async () => {
      const created = { id: 'c1', networkId: 'net1', propertyId: 'prop1', organizationId: 'o1', createdAt: new Date() };
      propsRepo.findByIdAndOrgId.mockResolvedValue({ id: 'prop1' });
      charterRepo.existsCharter.mockResolvedValue(null);
      charterRepo.create.mockResolvedValue(created);
      audit.recordCreate.mockResolvedValue(undefined);

      const result = await svc.add('o1', 'net1', 'prop1');
      expect(result).toEqual({ id: 'c1', networkId: 'net1', propertyId: 'prop1' });
      expect(charterRepo.create).toHaveBeenCalledWith('o1', 'net1', 'prop1');
      expect(conflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:network:charter:added',
        expect.objectContaining({ id: 'c1', networkId: 'net1', propertyId: 'prop1' }),
        'o1',
      );
      expect(audit.recordCreate).toHaveBeenCalledWith('o1', 'NetworkProperty', created);
    });
  });

  describe('remove', () => {
    it('throws PROP_001 when charter does not exist', async () => {
      charterRepo.existsCharter.mockResolvedValue(null);
      await expect(svc.remove('o1', 'net1', 'prop1')).rejects.toMatchObject({ code: 'PROP_001' });
    });

    it('delegates to assertCharterRemovable and throws when in use (PROP_008)', async () => {
      const existing = { id: 'c1', networkId: 'net1', propertyId: 'prop1', organizationId: 'o1', createdAt: new Date() };
      charterRepo.existsCharter.mockResolvedValue(existing);
      const err = Object.assign(new Error(), { code: 'PROP_008' });
      containment.assertCharterRemovable.mockRejectedValue(err);
      await expect(svc.remove('o1', 'net1', 'prop1')).rejects.toMatchObject({ code: 'PROP_008' });
      expect(charterRepo.deleteByNetworkAndProperty).not.toHaveBeenCalled();
    });

    it('deletes and emits the event on success', async () => {
      const existing = { id: 'c1', networkId: 'net1', propertyId: 'prop1', organizationId: 'o1', createdAt: new Date() };
      charterRepo.existsCharter.mockResolvedValue(existing);
      containment.assertCharterRemovable.mockResolvedValue(undefined);
      charterRepo.deleteByNetworkAndProperty.mockResolvedValue(1);
      audit.recordDelete.mockResolvedValue(undefined);

      await svc.remove('o1', 'net1', 'prop1');
      expect(charterRepo.deleteByNetworkAndProperty).toHaveBeenCalledWith('o1', 'net1', 'prop1');
      expect(conflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:network:charter:removed',
        expect.objectContaining({ networkId: 'net1', propertyId: 'prop1' }),
        'o1',
      );
      expect(audit.recordDelete).toHaveBeenCalledWith('o1', 'NetworkProperty', existing);
    });
  });
});
