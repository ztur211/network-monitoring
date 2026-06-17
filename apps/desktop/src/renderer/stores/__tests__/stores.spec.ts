import { describe, it, expect } from 'vitest';
import type { OrganizationDto, PropertyDto } from '@nodescope/shared';
import { useSitesStore } from '../sites-store';
import { useAuthStore } from '../auth-store';
import { useViewportStore } from '../viewport-store';

const prop = (id: string, type: PropertyDto['type'], parentId: string | null): PropertyDto => ({
  id,
  organizationId: 'o',
  parentId,
  type,
  name: id,
  code: null,
  version: 1,
  createdAt: '',
  updatedAt: '',
});

describe('sitesStore', () => {
  it('stores the property list and tracks the selected building', () => {
    useSitesStore.getState().setProperties([prop('s', 'SITE', null), prop('b', 'BUILDING', 's')]);
    expect(useSitesStore.getState().properties).toHaveLength(2);
    useSitesStore.getState().selectBuilding('b');
    expect(useSitesStore.getState().selectedBuildingId).toBe('b');
  });
});

describe('authStore', () => {
  it('tracks the authed flag and the org', () => {
    const org = { id: 'o', name: 'Acme' } as unknown as OrganizationDto;
    useAuthStore.getState().setAuthed(true);
    useAuthStore.getState().setOrg(org);
    expect(useAuthStore.getState().authed).toBe(true);
    expect(useAuthStore.getState().org).toBe(org);
  });
});

describe('viewportStore', () => {
  it('tracks the active building (the Spec 3 boundary)', () => {
    useViewportStore.getState().setActiveBuilding('b');
    expect(useViewportStore.getState().activeBuildingPropertyId).toBe('b');
  });
});
