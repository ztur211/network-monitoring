import { BcfService } from '../bcf.service';
import type { OrgMemberContext } from '../../organizations/org-context.types';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=';
const member = { id: 'member-1', organizationId: 'org-1', role: 'OWNER' } as OrgMemberContext;

describe('BcfService storage lifecycle', () => {
  it('deletes uploaded snapshots when the topic transaction fails', async () => {
    const storage = { putObjectStream: jest.fn().mockResolvedValue(undefined), deleteObject: jest.fn().mockResolvedValue(undefined) };
    const prisma = { $transaction: jest.fn().mockRejectedValue(new Error('tx failed')) };
    const service = new BcfService(
      { assertCanConfigure: jest.fn().mockResolvedValue(undefined) } as never,
      {
        findInOrg: jest.fn().mockResolvedValue({ id: 'building-1' }),
        subtreePropertyIds: jest.fn().mockResolvedValue([]),
      } as never,
      { findAllByOrgId: jest.fn().mockResolvedValue([]) } as never,
      storage as never,
      prisma as never,
      { emitScoped: jest.fn() } as never,
    );

    await expect(service.createTopic(member, 'building-1', {
      title: 'Issue',
      viewpoints: [{
        guid: 'view-1',
        camera: {} as never,
        components: { selection: [], visibility: { defaultVisibility: true, exceptions: [] } },
        snapshotPngBase64: PNG_BASE64,
      }],
    })).rejects.toThrow('tx failed');

    expect(storage.putObjectStream).toHaveBeenCalledTimes(1);
    const key = storage.putObjectStream.mock.calls[0][0];
    expect(storage.deleteObject).toHaveBeenCalledWith(key);
  });
});
