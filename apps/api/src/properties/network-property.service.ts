import { HttpStatus, Injectable } from '@nestjs/common';
import { WS_EVENTS } from '@nodescope/shared';
import { NetworkPropertyRepository } from './network-property.repository';
import { PropertiesRepository } from './properties.repository';
import { ContainmentService } from './containment.service';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';

@Injectable()
export class NetworkPropertyService {
  constructor(
    private readonly charters: NetworkPropertyRepository,
    private readonly props: PropertiesRepository,
    private readonly containment: ContainmentService,
    private readonly conflict: ConflictResolutionService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, networkId: string) {
    return (await this.charters.listByNetwork(organizationId, networkId)).map((c) => ({
      id: c.id,
      networkId: c.networkId,
      propertyId: c.propertyId,
    }));
  }

  async add(organizationId: string, networkId: string, propertyId: string) {
    const property = await this.props.findByIdAndOrgId(propertyId, organizationId);
    if (!property) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (await this.charters.existsCharter(organizationId, networkId, propertyId)) {
      throw new NodeScopeException('PROP_006', 'CHARTER_EXISTS', HttpStatus.CONFLICT);
    }
    const created = await this.charters.create(organizationId, networkId, propertyId);
    this.conflict.emitEntityEvent(WS_EVENTS.NETWORK_CHARTER_ADDED, { id: created.id, networkId, propertyId }, organizationId);
    await this.audit.recordCreate(organizationId, 'NetworkProperty', created);
    return { id: created.id, networkId, propertyId };
  }

  async remove(organizationId: string, networkId: string, propertyId: string) {
    const existing = await this.charters.existsCharter(organizationId, networkId, propertyId);
    if (!existing) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.containment.assertCharterRemovable(organizationId, networkId, propertyId);
    await this.charters.deleteByNetworkAndProperty(organizationId, networkId, propertyId);
    this.conflict.emitEntityEvent(WS_EVENTS.NETWORK_CHARTER_REMOVED, { networkId, propertyId }, organizationId);
    await this.audit.recordDelete(organizationId, 'NetworkProperty', existing);
  }
}
