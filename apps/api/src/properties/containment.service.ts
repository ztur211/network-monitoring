import { HttpStatus, Injectable } from '@nestjs/common';
import { PropertiesRepository } from './properties.repository';
import { NetworkPropertyRepository } from './network-property.repository';
import { NodeScopeException } from '../common/filters/global-exception.filter';

@Injectable()
export class ContainmentService {
  constructor(
    private readonly props: PropertiesRepository,
    private readonly charters: NetworkPropertyRepository,
  ) {}

  /** PROP_007 unless `propertyId` is at/under one of `networkId`'s chartered sites. */
  async assertDevicePlacement(organizationId: string, networkId: string, propertyId: string): Promise<void> {
    const ancestors = await this.props.getAncestorIds(organizationId, propertyId);
    const charterProps = await this.charters.propertyIdsByNetwork(organizationId, networkId);
    if (!this.intersects(ancestors, charterProps)) {
      throw new NodeScopeException('PROP_007', 'DEVICE_NOT_IN_CHARTERED_SITE', HttpStatus.UNPROCESSABLE_ENTITY);
    }
  }

  /**
   * PROP_007 if moving `movedId` under `newParentId` would orphan any placed device in the moved subtree.
   * Post-move ancestors of a device d = (d's ancestors that stay within the moved subtree) ∪ (newParent + its ancestors).
   */
  async assertReparentKeepsContainment(organizationId: string, movedId: string, newParentId: string | null): Promise<void> {
    const subtree = await this.props.getSubtreeIds(organizationId, movedId);
    const devices = await this.props.devicesUnder(organizationId, subtree);
    if (devices.length === 0) return;
    const newAbove = newParentId ? await this.props.getAncestorIds(organizationId, newParentId) : [];
    const subtreeSet = new Set(subtree);
    const charterCache = new Map<string, string[]>();

    for (const d of devices) {
      const dAnc = await this.props.getAncestorIds(organizationId, d.propertyId);
      const withinMoved = dAnc.filter((a) => subtreeSet.has(a)); // d up to movedId, unchanged
      const post = new Set<string>([...withinMoved, ...newAbove]);
      let charterProps = charterCache.get(d.networkId);
      if (!charterProps) {
        charterProps = await this.charters.propertyIdsByNetwork(organizationId, d.networkId);
        charterCache.set(d.networkId, charterProps);
      }
      if (!charterProps.some((c) => post.has(c))) {
        throw new NodeScopeException('PROP_007', 'DEVICE_NOT_IN_CHARTERED_SITE', HttpStatus.UNPROCESSABLE_ENTITY);
      }
    }
  }

  /** PROP_008 if removing charter (networkId, propertyId) leaves any of that network's devices uncovered. */
  async assertCharterRemovable(organizationId: string, networkId: string, propertyId: string): Promise<void> {
    const removedSubtree = await this.props.getSubtreeIds(organizationId, propertyId);
    const devices = (await this.props.devicesUnder(organizationId, removedSubtree)).filter((d) => d.networkId === networkId);
    if (devices.length === 0) return;
    const remaining = (await this.charters.propertyIdsByNetwork(organizationId, networkId)).filter((p) => p !== propertyId);
    for (const d of devices) {
      const ancestors = await this.props.getAncestorIds(organizationId, d.propertyId);
      if (!this.intersects(ancestors, remaining)) {
        throw new NodeScopeException('PROP_008', 'CHARTER_IN_USE', HttpStatus.CONFLICT);
      }
    }
  }

  private intersects(a: string[], b: string[]): boolean {
    const set = new Set(a);
    return b.some((x) => set.has(x));
  }
}
