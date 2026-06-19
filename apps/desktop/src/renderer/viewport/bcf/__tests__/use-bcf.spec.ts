// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { loadBcfTopics, applyBcfEvent, useBcfStore } from '../use-bcf';

const topic = (id: string, title: string) =>
  ({ id, title, topicStatus: 'Open', comments: [], viewpoints: [], deviceIds: [] }) as any;

beforeEach(() => {
  useBcfStore.setState({ topics: [] });
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
});
