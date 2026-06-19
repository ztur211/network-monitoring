/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { loadBcfTopics, applyBcfEvent, useBcfStore, useBcf } from '../use-bcf';
import * as clientsModule from '../../../data/clients';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';
import { WS_EVENTS } from '@nodescope/shared';

const topic = (id: string, title: string, propertyId = 'b1') =>
  ({ id, title, topicStatus: 'Open', comments: [], viewpoints: [], deviceIds: [], propertyId }) as any;

const comment = (id: string) =>
  ({ id, comment: 'hi', author: 'x', date: '2026-01-01', viewpointGuid: null }) as any;

beforeEach(() => {
  useBcfStore.setState({ topics: [] });
  useViewportStore.setState({ ...initialViewportState() });
  vi.spyOn(clientsModule, 'getClients').mockReturnValue(null as any);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useBcfStore + loadBcfTopics + applyBcfEvent', () => {
  it('loads topics and applies a realtime topic event', async () => {
    const rest = { listBcfTopics: async () => [topic('t1', 'A')] };
    await loadBcfTopics('b', rest as any, () => true);
    expect(useBcfStore.getState().topics.map((t: any) => t.id)).toEqual(['t1']);

    applyBcfEvent('created', topic('t2', 'B'));
    expect(useBcfStore.getState().topics.find((t: any) => t.id === 't2')).toBeTruthy();
  });

  it('discards a stale load when isCurrent returns false', async () => {
    const rest = { listBcfTopics: async () => [topic('t1', 'A')] };
    await loadBcfTopics('b', rest as any, () => false);
    expect(useBcfStore.getState().topics).toEqual([]);
  });

  it('upserts an existing topic on BCF_TOPIC_UPDATED event', async () => {
    useBcfStore.getState().set([topic('t1', 'Old Title')]);
    applyBcfEvent('updated', topic('t1', 'New Title'));
    const topics = useBcfStore.getState().topics;
    expect(topics).toHaveLength(1);
    expect(topics[0].title).toBe('New Title');
  });

  it('clears topics when load fails', async () => {
    useBcfStore.getState().set([topic('t1', 'A')]);
    const rest = { listBcfTopics: async () => { throw new Error('fail'); } };
    await loadBcfTopics('b', rest as any, () => true);
    expect(useBcfStore.getState().topics).toEqual([]);
  });

  // Fix 1: addComment appends a comment to the matching topic
  it('addComment appends a comment to the matching topic (Fix 1)', () => {
    useBcfStore.getState().set([topic('t1', 'A')]);
    useBcfStore.getState().addComment('t1', comment('c1'));
    const t = useBcfStore.getState().topics[0];
    expect(t.comments).toHaveLength(1);
    expect(t.comments[0].id).toBe('c1');
  });

  // Fix 1: addComment is a no-op when topic not in store
  it('addComment is a no-op when topic not in store (Fix 1)', () => {
    useBcfStore.getState().set([topic('t1', 'A')]);
    useBcfStore.getState().addComment('unknown', comment('c1'));
    expect(useBcfStore.getState().topics[0].comments).toHaveLength(0);
  });
});

describe('useBcf realtime subscription', () => {
  function makeFakeRealtime() {
    const handlers: Record<string, Set<Function>> = {};
    return {
      on: vi.fn((event: string, handler: Function) => {
        if (!handlers[event]) handlers[event] = new Set();
        handlers[event].add(handler);
      }),
      off: vi.fn((event: string, handler: Function) => {
        handlers[event]?.delete(handler);
      }),
      emit(event: string, payload: unknown) {
        handlers[event]?.forEach((h) => h(payload));
      },
    };
  }

  // Fix 4: realtime effect attaches when clients become ready (keyed on buildingId)
  it('attaches realtime listeners when buildingId is set and clients become ready (Fix 4)', () => {
    const rt = makeFakeRealtime();
    // Start with no clients
    vi.spyOn(clientsModule, 'getClients').mockReturnValue(null as any);
    useViewportStore.setState({ activeBuildingPropertyId: null });

    const { rerender } = renderHook(() => useBcf());

    // Simulate clients + buildingId becoming available
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({
      rest: { listBcfTopics: () => new Promise(() => {}) },
      realtime: rt,
    } as any);

    act(() => {
      useViewportStore.setState({ activeBuildingPropertyId: 'b1' });
    });
    rerender();

    expect(rt.on).toHaveBeenCalledWith(WS_EVENTS.BCF_TOPIC_CREATED, expect.any(Function));
    expect(rt.on).toHaveBeenCalledWith(WS_EVENTS.BCF_TOPIC_UPDATED, expect.any(Function));
    expect(rt.on).toHaveBeenCalledWith(WS_EVENTS.BCF_COMMENT_ADDED, expect.any(Function));
  });

  // Fix 1: BCF_COMMENT_ADDED updates matching topic in the store
  it('BCF_COMMENT_ADDED appends comment to matching topic (Fix 1)', () => {
    const rt = makeFakeRealtime();
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({
      rest: { listBcfTopics: () => new Promise(() => {}) },
      realtime: rt,
    } as any);
    useViewportStore.setState({ activeBuildingPropertyId: 'b1' });
    useBcfStore.getState().set([topic('t1', 'A', 'b1')]);

    renderHook(() => useBcf());

    act(() => {
      rt.emit(WS_EVENTS.BCF_COMMENT_ADDED, { topicId: 't1', comment: comment('c99') });
    });

    expect(useBcfStore.getState().topics[0].comments).toHaveLength(1);
    expect(useBcfStore.getState().topics[0].comments[0].id).toBe('c99');
  });

  // Fix 2: an event for a DIFFERENT building is ignored
  it('ignores BCF_TOPIC_CREATED for a different building (Fix 2)', () => {
    const rt = makeFakeRealtime();
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({
      rest: { listBcfTopics: () => new Promise(() => {}) },
      realtime: rt,
    } as any);
    useViewportStore.setState({ activeBuildingPropertyId: 'b1' });

    renderHook(() => useBcf());

    act(() => {
      // topic belongs to building 'b2', not 'b1'
      rt.emit(WS_EVENTS.BCF_TOPIC_CREATED, { topic: topic('t2', 'Other', 'b2') });
    });

    expect(useBcfStore.getState().topics).toHaveLength(0);
  });
});
