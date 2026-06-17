import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PropertiesService } from '../properties/properties.service';
import { PermissionsService } from '../permissions/permissions.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { buildNetworkIfc, ExportDevice } from './ifc2x3-writer';

@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly properties: PropertiesService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Spec 5: a building's in-scope placed devices → a federated IFC2x3 discipline file. The building must be
   * an in-scope `BUILDING` Property (else 404 — invisible-not-forbidden, F3); devices are the F2 subtree ∩
   * F3 read-scope, placed only (x/y/z not null). MEMBER may export (a read).
   */
  async getBuildingExport(
    member: OrgMemberContext,
    buildingPropertyId: string,
  ): Promise<{ filename: string; ifc: string }> {
    const organizationId = member.organizationId;
    const building = await this.prisma.property.findFirst({
      where: { id: buildingPropertyId, organizationId, type: 'BUILDING' },
    });
    const visible =
      !!building &&
      (member.role === 'OWNER' ||
        (await this.permissions.inScope(organizationId, member.id, buildingPropertyId)));
    if (!building || !visible) {
      throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const subtree = await this.properties.subtreePropertyIds(organizationId, buildingPropertyId);
    const scope = await this.permissions.scopeFilter(member); // null for OWNER → no filter
    const propertyIdIn = scope ? subtree.filter((id) => scope.propertyIdIn.includes(id)) : subtree;
    const rows = propertyIdIn.length
      ? await this.prisma.device.findMany({
          where: {
            organizationId,
            propertyId: { in: propertyIdIn },
            x: { not: null },
            y: { not: null },
            z: { not: null },
          },
          include: { network: { select: { name: true } } },
        })
      : [];

    const devices: ExportDevice[] = rows.map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      x: d.x!,
      y: d.y!,
      z: d.z!,
      ipAddress: d.ipAddress,
      macAddress: d.macAddress,
      networkName: d.network?.name ?? null,
    }));

    const ifc = buildNetworkIfc({
      building: { id: building.id, name: building.name },
      storeyName: 'Network',
      devices,
      timestamp: new Date().toISOString(),
    });
    return { filename: `${building.name.replace(/[^\w.-]+/g, '_')}-network.ifc`, ifc };
  }
}
