import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { isMeshVisible } from '../visibility';

const mesh = (expressID: number, ifcType: string) =>
  Object.assign(new THREE.Mesh(), { userData: { expressID, ifcType } });

describe('isMeshVisible', () => {
  const base = {
    hiddenCategories: new Set<string>(),
    hiddenElements: new Set<number>(),
    isolated: null as number | null,
  };
  it('visible by default', () => expect(isMeshVisible(mesh(1, 'IfcWall'), base)).toBe(true));
  it('hidden when its category is hidden', () =>
    expect(isMeshVisible(mesh(1, 'IfcWall'), { ...base, hiddenCategories: new Set(['IfcWall']) })).toBe(false));
  it('hidden when individually hidden', () =>
    expect(isMeshVisible(mesh(1, 'IfcWall'), { ...base, hiddenElements: new Set([1]) })).toBe(false));
  it('isolation hides everything except the isolated element', () => {
    expect(isMeshVisible(mesh(1, 'IfcWall'), { ...base, isolated: 2 })).toBe(false);
    expect(isMeshVisible(mesh(2, 'IfcWall'), { ...base, isolated: 2 })).toBe(true);
  });
});
