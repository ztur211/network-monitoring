import { Injectable } from '@nestjs/common';
import { DeviceCategory, PropertyType } from '@prisma/client';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { PropertiesRepository } from '../properties/properties.repository';
import { DevicesRepository } from './devices.repository';
import { roleCodeOf } from './role-code';
import { renderTemplate, fillSeq, hasSeqToken, LocationTokens } from './naming-tokens';

const SEQ_PAD = 2;
const SEQ_MAX = 9999;

@Injectable()
export class NameSuggestionService {
  constructor(
    private readonly orgs: OrganizationsRepository,
    private readonly props: PropertiesRepository,
    private readonly devices: DevicesRepository,
  ) {}

  async suggest(organizationId: string, propertyId: string, category: DeviceCategory, roleCode: string | null): Promise<string | null> {
    const org = await this.orgs.findOrganizationById(organizationId);
    if (!org?.namingTemplate) return null;

    const chain = await this.props.getAncestorChain(organizationId, propertyId); // self → root
    const codeOf = (t: PropertyType) => chain.find((c) => c.type === t)?.code ?? '';
    const tokens: LocationTokens = {
      site: codeOf('SITE'), building: codeOf('BUILDING'), floor: codeOf('FLOOR'), area: codeOf('AREA'),
      role: roleCode ?? roleCodeOf(category),
    };

    const rendered = renderTemplate(org.namingTemplate, tokens);
    if (!hasSeqToken(rendered)) return rendered.length > 0 ? rendered : null;

    for (let n = 1; n <= SEQ_MAX; n++) {
      const candidate = fillSeq(rendered, String(n).padStart(SEQ_PAD, '0'));
      if (!(await this.devices.existsByNameCaseInsensitive(organizationId, candidate))) return candidate;
    }
    return null;
  }
}
