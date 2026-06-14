import { HttpStatus, Injectable } from '@nestjs/common';
import { WS_EVENTS } from '@nodescope/shared';
import { NetworkPropertyRepository } from './network-property.repository';
import { PropertiesRepository } from './properties.repository';
import { ContainmentService } from './containment.service';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { PermissionsService } from '../permissions/permissions.service';
import type { OrgMemberContext } from '../organizations/org-context.types';

@Injectable()
export class NetworkPropertyService {
  constructor(
    private readonly charters: NetworkPropertyRepository,
    private readonly props: PropertiesRepository,
    private readonly containment: ContainmentService,
    private readonly conflict: ConflictResolutionService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  async list(member: OrgMemberContext, networkId: string) {
    const organizationId = member.organizationId;
    const scope = await this.permissions.scopeFilter(member);
    const charters = await this.charters.listByNetwork(organizationId, networkId);
    const visible = scope ? charters.filter((c) => scope.propertyIdIn.includes(c.propertyId)) : charters;
    return visible.map((c) => ({ id: c.id, networkId: c.networkId, propertyId: c.propertyId }));
  }

  async add(member: OrgMemberContext, networkId: string, propertyId: string) {
    const organizationId = member.organizationId;
    const coverageSites = [...new Set([
      ...(await this.charters.listByNetwork(organizationId, networkId)).map((c) => c.propertyId),
      ...(await this.charters.deviceFootprintPropertyIds(organizationId, networkId)),
    ])];
    await this.permissions.assertNetworkFullCoverage(member, coverageSites);
    await this.permissions.assertCanConfigure(member, propertyId);
    const property = await this.props.findByIdAndOrgId(propertyId, organizationId);
    if (!property) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (await this.charters.existsCharter(organizationId, networkId, propertyId)) {
      throw new NodeScopeException('PROP_006', 'CHARTER_EXISTS', HttpStatus.CONFLICT);
    }
    const created = await this.charters.create(organizationId, networkId, propertyId);
    // Include the newly-added site in the fan-out so its members learn about the charter
    const allSites = [...new Set([...(await this.charters.listByNetwork(organizationId, networkId)).map((c) => c.propertyId), propertyId])];
    await this.conflict.emitScopedMulti(organizationId, allSites, WS_EVENTS.NETWORK_CHARTER_ADDED, { id: created.id, networkId, propertyId });
    await this.audit.recordCreate(organizationId, 'NetworkProperty', created);
    return { id: created.id, networkId, propertyId };
  }

  async remove(member: OrgMemberContext, networkId: string, propertyId: string) {
    const organizationId = member.organizationId;
    const coverageSites = [...new Set([
      ...(await this.charters.listByNetwork(organizationId, networkId)).map((c) => c.propertyId),
      ...(await this.charters.deviceFootprintPropertyIds(organizationId, networkId)),
    ])];
    await this.permissions.assertNetworkFullCoverage(member, coverageSites);
    const existing = await this.charters.existsCharter(organizationId, networkId, propertyId);
    if (!existing) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.containment.assertCharterRemovable(organizationId, networkId, propertyId);
    // Emit BEFORE delete so the removed charter's site viewers are still included
    const allSites = [...new Set([...(await this.charters.listByNetwork(organizationId, networkId)).map((c) => c.propertyId), propertyId])];
    await this.conflict.emitScopedMulti(organizationId, allSites, WS_EVENTS.NETWORK_CHARTER_REMOVED, { networkId, propertyId });
    await this.charters.deleteByNetworkAndProperty(organizationId, networkId, propertyId);
    await this.audit.recordDelete(organizationId, 'NetworkProperty', existing);
  }
}
