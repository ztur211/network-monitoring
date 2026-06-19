/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import { IssuesPanel } from '../ui/IssuesPanel';
import { useBcfStore } from '../use-bcf';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';
import * as clientsModule from '../../../data/clients';
import * as ViewCommandsModule from '../../scene/ViewCommands';

// ─── helpers ──────────────────────────────────────────────────────────────────

const frame = { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' as const };

function fakeModel() {
  return {
    frame,
    guidIndex: new Map<string, number>([['ELEM-G', 7]]),
    bbox: new THREE.Box3(),
    root: new THREE.Group(),
    categories: new Map(),
    elementIndex: new Map(),
    getProperties: async () => ({ expressID: 7, ifcType: 'IfcWall', name: null, tag: null, propertySets: [] }),
    dispose: () => {},
  } as any;
}

function fakeDevice(id: string) {
  return {
    id,
    name: id,
    category: 'SWITCH',
    propertyId: 'b1',
    networkId: 'n',
    x: 1, y: 1, z: 1,
    floor: 1,
    ipAddress: null,
    macAddress: null,
  } as any;
}

function fakeTopic(override: Partial<any> = {}) {
  return {
    id: 't1',
    organizationId: 'o',
    propertyId: 'b1',
    guid: 'g1',
    title: 'Clash',
    topicType: null,
    topicStatus: 'Open',
    priority: null,
    labels: [],
    creationAuthor: 'user@test.com',
    creationDate: '2026-01-01',
    modifiedAuthor: null,
    modifiedDate: null,
    assignedTo: null,
    dueDate: null,
    description: null,
    version: 1,
    commentCount: 0,
    deviceIds: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    comments: [],
    viewpoints: [
      {
        id: 'v1',
        guid: 'vg1',
        camera: {
          kind: 'perspective',
          position: [0, 0, 5] as [number, number, number],
          direction: [0, 0, -1] as [number, number, number],
          up: [0, 1, 0] as [number, number, number],
          fieldOfView: 60,
        },
        components: {
          selection: [] as string[],
          visibility: { defaultVisibility: true, exceptions: [] as string[] },
        },
        clippingPlanes: [],
        isPrimary: true,
        hasSnapshot: false,
      },
    ],
    ...override,
  } as any;
}

// ─── lifecycle ────────────────────────────────────────────────────────────────

/** A no-op rest client: keeps useBcf() from clearing topics when buildingId is set */
const noopRest = {
  listBcfTopics: () => new Promise<never>(() => {}), // never resolves → keeps pre-seeded topics
  createBcfTopic: vi.fn().mockResolvedValue({ id: 'noop' }),
};

beforeEach(() => {
  useBcfStore.setState({ topics: [] });
  useViewportStore.setState({
    ...initialViewportState(),
  });
  // Default: no-op rest so useBcf() doesn't clear the pre-seeded store state
  vi.spyOn(clientsModule, 'getClients').mockReturnValue({
    rest: noopRest,
    realtime: null,
  } as any);
  // Fix 3: default live camera so create-from-view tests have a THREE.Vector3-bearing camera
  vi.spyOn(ViewCommandsModule, 'getLiveCamera').mockReturnValue({
    position: new THREE.Vector3(0, 5, 0),
    target: new THREE.Vector3(0, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    fov: 60,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('IssuesPanel', () => {
  it('renders "No issues" when the store is empty', () => {
    render(<IssuesPanel />);
    expect(screen.getByText('No issues')).toBeTruthy();
  });

  it('lists topics and navigates on click (sets viewpointRequest)', () => {
    useBcfStore.setState({ topics: [fakeTopic()] });
    useViewportStore.setState({ model: fakeModel(), activeBuildingPropertyId: 'b1' });

    render(<IssuesPanel />);
    expect(screen.getByText('Clash')).toBeTruthy();
    // Status is shown as a badge (may also appear in filter options, use getAllByText)
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('Clash'));

    const state = useViewportStore.getState();
    expect(state.viewpointRequest).toBeTruthy();
    expect(state.viewpointRequest?.nonce).toBe(1);
  });

  it('clicking a topic with no model does nothing (no crash)', () => {
    useBcfStore.setState({ topics: [fakeTopic()] });
    useViewportStore.setState({ activeBuildingPropertyId: 'b1' });
    // model stays null
    render(<IssuesPanel />);
    fireEvent.click(screen.getByText('Clash'));
    expect(useViewportStore.getState().viewpointRequest).toBeNull();
  });

  it('clicking a topic with no viewpoints does nothing (no crash)', () => {
    useBcfStore.setState({ topics: [fakeTopic({ viewpoints: [] })] });
    useViewportStore.setState({ model: fakeModel(), activeBuildingPropertyId: 'b1' });
    render(<IssuesPanel />);
    fireEvent.click(screen.getByText('Clash'));
    expect(useViewportStore.getState().viewpointRequest).toBeNull();
  });

  it('hides "New issue from view" for MEMBER access', () => {
    useBcfStore.setState({ topics: [] });
    useViewportStore.setState({
      access: { role: 'MEMBER', assignedRoots: [] } as any,
      model: fakeModel(),
    });
    render(<IssuesPanel />);
    expect(screen.queryByText('New issue from view')).toBeNull();
  });

  it('shows "New issue from view" for ADMIN access', () => {
    useBcfStore.setState({ topics: [] });
    useViewportStore.setState({
      access: { role: 'ADMIN', assignedRoots: [] } as any,
      model: fakeModel(),
    });
    render(<IssuesPanel />);
    expect(screen.getByText('New issue from view')).toBeTruthy();
  });

  it('shows "New issue from view" for OWNER access', () => {
    useBcfStore.setState({ topics: [] });
    useViewportStore.setState({
      access: { role: 'OWNER', assignedRoots: [] } as any,
      model: fakeModel(),
    });
    render(<IssuesPanel />);
    expect(screen.getByText('New issue from view')).toBeTruthy();
  });

  it('create-from-view calls createBcfTopic with a captured viewpoint', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'new-topic' });
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({
      rest: { createBcfTopic: mockCreate },
      realtime: null,
    } as any);

    // Stub toDataURL on canvas
    const origQuerySelector = document.querySelector.bind(document);
    vi.spyOn(document, 'querySelector').mockImplementation((sel) => {
      if (sel === 'canvas') {
        return { toDataURL: () => 'data:image/png;base64,SNAPSHOTDATA' } as any;
      }
      return origQuerySelector(sel);
    });

    useViewportStore.setState({
      access: { role: 'ADMIN', assignedRoots: [] } as any,
      model: fakeModel(),
      activeBuildingPropertyId: 'b1',
      cameraSnapshot: {
        position: new THREE.Vector3(0, 5, 0),
        target: new THREE.Vector3(0, 0, 0),
        up: new THREE.Vector3(0, 1, 0),
        fov: 60,
      },
      devices: [fakeDevice('dev1')],
    });

    render(<IssuesPanel />);
    fireEvent.click(screen.getByText('New issue from view'));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    const [buildingId, dto] = mockCreate.mock.calls[0];
    expect(buildingId).toBe('b1');
    expect(dto.title).toMatch(/Issue from view/);
    expect(dto.viewpoints).toHaveLength(1);
    const vp = dto.viewpoints[0];
    expect(vp.camera.kind).toBe('perspective');
    expect(vp.camera.position).toBeDefined();
    expect(vp.components).toBeDefined();
    expect(vp.snapshotPngBase64).toBe('SNAPSHOTDATA');
  });

  it('create-from-view includes selected device in viewpoint components', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'new-topic' });
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({
      rest: { createBcfTopic: mockCreate },
      realtime: null,
    } as any);
    vi.spyOn(document, 'querySelector').mockReturnValue(null as any);

    useViewportStore.setState({
      access: { role: 'ADMIN', assignedRoots: [] } as any,
      model: fakeModel(),
      activeBuildingPropertyId: 'b1',
      selection: { kind: 'device', deviceId: 'dev1' },
      cameraSnapshot: {
        position: new THREE.Vector3(1, 2, 3),
        target: new THREE.Vector3(0, 0, 0),
        up: new THREE.Vector3(0, 1, 0),
        fov: 50,
      },
      devices: [fakeDevice('dev1')],
    });

    render(<IssuesPanel />);
    fireEvent.click(screen.getByText('New issue from view'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const [, dto] = mockCreate.mock.calls[0];
    // The device's IFC GUID should be in selection
    expect(dto.viewpoints[0].components.selection.length).toBe(1);
  });

  it('status filter narrows the topic list', () => {
    useBcfStore.setState({
      topics: [
        fakeTopic({ id: 't1', title: 'Open Issue', topicStatus: 'Open' }),
        fakeTopic({ id: 't2', title: 'Closed Issue', topicStatus: 'Closed' }),
      ],
    });
    useViewportStore.setState({ activeBuildingPropertyId: 'b1' });
    render(<IssuesPanel />);
    expect(screen.getByText('Open Issue')).toBeTruthy();
    expect(screen.getByText('Closed Issue')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'Closed' } });
    expect(screen.queryByText('Open Issue')).toBeNull();
    expect(screen.getByText('Closed Issue')).toBeTruthy();
  });

  // Fix 3: create-from-view uses the live camera (getLiveCamera()) not the stale store snapshot
  it('create-from-view uses the live camera from getLiveCamera() (Fix 3)', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'new-topic' });
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({
      rest: { createBcfTopic: mockCreate },
      realtime: null,
    } as any);
    vi.spyOn(document, 'querySelector').mockReturnValue(null as any);

    // Live camera returned at click time
    const livePos = new THREE.Vector3(9, 8, 7);
    vi.spyOn(ViewCommandsModule, 'getLiveCamera').mockReturnValue({
      position: livePos,
      target: new THREE.Vector3(1, 2, 3),
      up: new THREE.Vector3(0, 1, 0),
      fov: 45,
    });

    useViewportStore.setState({
      access: { role: 'ADMIN', assignedRoots: [] } as any,
      model: fakeModel(),
      activeBuildingPropertyId: 'b1',
      // cameraSnapshot is stale/different — should NOT be used
      cameraSnapshot: {
        position: new THREE.Vector3(0, 0, 0),
        target: new THREE.Vector3(0, 0, 0),
        up: new THREE.Vector3(0, 1, 0),
        fov: 10,
      },
      devices: [],
    });

    render(<IssuesPanel />);
    fireEvent.click(screen.getByText('New issue from view'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const [, dto] = mockCreate.mock.calls[0];
    // The camera position should come from getLiveCamera() (9,8,7 in Y-up viewport space),
    // NOT the stale store snapshot (0,0,0). captureViewpoint converts to IFC native Z-up via
    // Rx(+90°): (x,y,z)_viewport → (x,-z,y)_native, so (9,8,7) → (9,-7,8).
    // We verify it's not the stale (0,0,0) default, and that x matches (untouched by rotation).
    const vp = dto.viewpoints[0];
    expect(vp.camera.position[0]).toBeCloseTo(9);  // x unchanged
    expect(vp.camera.position[1]).toBeCloseTo(-7); // native y = -viewport_z
    expect(vp.camera.position[2]).toBeCloseTo(8);  // native z = viewport_y
  });
});
