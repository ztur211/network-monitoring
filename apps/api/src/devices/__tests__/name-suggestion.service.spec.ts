import { Test } from '@nestjs/testing';
import { NameSuggestionService } from '../name-suggestion.service';
import { OrganizationsRepository } from '../../organizations/organizations.repository';
import { PropertiesRepository } from '../../properties/properties.repository';
import { DevicesRepository } from '../devices.repository';

const orgsMock = () => ({ findOrganizationById: jest.fn() });
const propsMock = () => ({ getAncestorChain: jest.fn() });
const devicesMock = () => ({ existsByNameCaseInsensitive: jest.fn() });

describe('NameSuggestionService', () => {
  let svc: NameSuggestionService; let orgs: any; let props: any; let devices: any;
  beforeEach(async () => {
    orgs = orgsMock(); props = propsMock(); devices = devicesMock();
    const m = await Test.createTestingModule({ providers: [
      NameSuggestionService,
      { provide: OrganizationsRepository, useValue: orgs },
      { provide: PropertiesRepository, useValue: props },
      { provide: DevicesRepository, useValue: devices },
    ] }).compile();
    svc = m.get(NameSuggestionService);
  });

  it('returns null when the org has no template', async () => {
    orgs.findOrganizationById.mockResolvedValue({ namingTemplate: null });
    expect(await svc.suggest('o1', 'p1', 'ROUTER', null)).toBeNull();
  });

  it('resolves tokens and the lowest free {seq}', async () => {
    orgs.findOrganizationById.mockResolvedValue({ namingTemplate: '{site}-{role}-{seq}' });
    props.getAncestorChain.mockResolvedValue([{ type: 'FLOOR', code: '3' }, { type: 'BUILDING', code: 'a' }, { type: 'SITE', code: 'hq' }]);
    devices.existsByNameCaseInsensitive.mockResolvedValueOnce(true).mockResolvedValueOnce(false); // hq-rtr-01 taken, 02 free
    expect(await svc.suggest('o1', 'p1', 'ROUTER', null)).toBe('hq-rtr-02');
  });
});
