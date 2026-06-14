import { HttpStatus } from '@nestjs/common';
import { PropertyType } from '@prisma/client';
import { NodeScopeException } from '../common/filters/global-exception.filter';

// Parent type → the child types it may contain (spec §5).
export const ALLOWED_CHILDREN: Record<PropertyType, PropertyType[]> = {
  SITE: ['SITE', 'BUILDING', 'AREA'],
  BUILDING: ['FLOOR', 'AREA'],
  FLOOR: ['AREA'],
  AREA: ['AREA'],
};

/** Throws PROP_002 if `childType` may not sit under `parentType` (null parent = root, must be SITE). */
export function assertValidNesting(parentType: PropertyType | null, childType: PropertyType): void {
  if (parentType === null) {
    if (childType !== 'SITE') {
      throw new NodeScopeException('PROP_002', 'INVALID_PARENT_TYPE', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return;
  }
  if (!ALLOWED_CHILDREN[parentType].includes(childType)) {
    throw new NodeScopeException('PROP_002', 'INVALID_PARENT_TYPE', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
