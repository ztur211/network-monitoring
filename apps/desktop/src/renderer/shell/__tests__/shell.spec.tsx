/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { OrganizationDto, PropertyDto } from '@nodescope/shared';
import { Sidebar } from '../Sidebar';
import { TopBar } from '../TopBar';
import { useSitesStore } from '../../stores/sites-store';
import { useAuthStore } from '../../stores/auth-store';
import { useViewportStore } from '../../stores/viewport-store';

const prop = (
  id: string,
  type: PropertyDto['type'],
  parentId: string | null,
  name: string,
): PropertyDto => ({
  id,
  organizationId: 'o',
  parentId,
  type,
  name,
  code: null,
  version: 1,
  createdAt: '',
  updatedAt: '',
});

beforeEach(() => {
  useSitesStore.setState({ properties: [], selectedBuildingId: null });
  useAuthStore.setState({ authed: true, org: null });
  useViewportStore.setState({ activeBuildingPropertyId: null });
  (window as any).nodescope = {
    auth: { login: vi.fn(), logout: vi.fn(), getToken: vi.fn(), onAuthChanged: vi.fn() },
    app: { getConfig: vi.fn() },
  };
});
afterEach(() => cleanup());

describe('Sidebar', () => {
  it('lists buildings under their site and selects one on click', () => {
    useSitesStore.setState({
      properties: [prop('s', 'SITE', null, 'HQ'), prop('b', 'BUILDING', 's', 'Bld A')],
      selectedBuildingId: null,
    });
    render(<Sidebar />);
    expect(screen.getByText('HQ')).toBeTruthy();
    fireEvent.click(screen.getByText('Bld A'));
    expect(useSitesStore.getState().selectedBuildingId).toBe('b');
    expect(useViewportStore.getState().activeBuildingPropertyId).toBe('b');
  });
});

describe('TopBar', () => {
  it('shows the org name and logs out on click', () => {
    useAuthStore.setState({
      authed: true,
      org: { id: 'o', name: 'Acme' } as unknown as OrganizationDto,
    });
    render(<TopBar />);
    expect(screen.getByText('Acme')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect((window as any).nodescope.auth.logout).toHaveBeenCalled();
  });
});

// ViewportHost is now the real Spec 3 viewport (state overlays) — covered by viewport/ui/__tests__/overlays.spec.tsx.
