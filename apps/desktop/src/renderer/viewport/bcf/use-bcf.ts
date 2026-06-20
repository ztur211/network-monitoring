import { create } from 'zustand';
import { useEffect } from 'react';
import { WS_EVENTS } from '@nodescope/shared';
import type { BcfTopicDto, BcfCommentDto } from '@nodescope/shared';
import { useViewportStore } from '../../stores/viewport-store';
import { getClients } from '../../data/clients';

export const useBcfStore = create<{
  topics: BcfTopicDto[];
  set: (t: BcfTopicDto[]) => void;
  upsert: (t: BcfTopicDto) => void;
  addComment: (topicId: string, comment: BcfCommentDto) => void;
}>((s) => ({
  topics: [],
  set: (topics) => s({ topics }),
  upsert: (t) =>
    s((st) => ({
      topics: st.topics.some((x) => x.id === t.id)
        ? st.topics.map((x) => (x.id === t.id ? t : x))
        : [...st.topics, t],
    })),
  addComment: (topicId, comment) =>
    s((st) => ({
      topics: st.topics.map((x) =>
        x.id === topicId
          ? { ...x, comments: [...(x.comments ?? []), comment] }
          : x,
      ),
    })),
}));

export async function loadBcfTopics(
  buildingId: string,
  rest: { listBcfTopics(id: string): Promise<BcfTopicDto[]> },
  isCurrent: () => boolean,
): Promise<void> {
  try {
    const t = await rest.listBcfTopics(buildingId);
    if (isCurrent()) useBcfStore.getState().set(t);
  } catch {
    if (isCurrent()) useBcfStore.getState().set([]);
  }
}

export function applyBcfEvent(_kind: 'created' | 'updated', topic: BcfTopicDto): void {
  useBcfStore.getState().upsert(topic);
}

export function useBcf(): void {
  const buildingId = useViewportStore((s) => s.activeBuildingPropertyId);

  useEffect(() => {
    const rest = getClients()?.rest as any;
    if (!buildingId || !rest) {
      useBcfStore.getState().set([]);
      return;
    }
    let active = true;
    loadBcfTopics(buildingId, rest, () => active && useViewportStore.getState().activeBuildingPropertyId === buildingId);
    return () => {
      active = false;
    };
  }, [buildingId]);

  useEffect(() => {
    // Fix 4: key on buildingId so the effect re-runs once clients/building become ready.
    const rt = getClients()?.realtime;
    if (!rt || !buildingId) return;

    // Fix 2: only apply events that belong to the currently-active building.
    const isMine = (p: { propertyId?: string }) => p?.propertyId === buildingId;

    // Server emits { topic } — unwrap it; guard with isMine (Fix 2).
    // Handlers take `unknown` to match the realtime client's on/off signature
    // (payload: unknown) and narrow internally, as in use-device-load.ts.
    const onCreated = (p: unknown) => {
      const { topic } = p as { topic: BcfTopicDto };
      if (isMine(topic)) applyBcfEvent('created', topic);
    };
    const onUpdated = (p: unknown) => {
      const { topic } = p as { topic: BcfTopicDto };
      if (isMine(topic)) applyBcfEvent('updated', topic);
    };

    // Fix 1: handle live comment additions; guard: topic must already be in the store
    // (the store is building-scoped from the initial load).
    const onCommentAdded = (p: unknown) => {
      const { topicId, comment } = p as { topicId: string; comment: BcfCommentDto };
      const inStore = useBcfStore.getState().topics.some((t) => t.id === topicId);
      if (inStore) useBcfStore.getState().addComment(topicId, comment);
    };

    rt.on(WS_EVENTS.BCF_TOPIC_CREATED, onCreated);
    rt.on(WS_EVENTS.BCF_TOPIC_UPDATED, onUpdated);
    rt.on(WS_EVENTS.BCF_COMMENT_ADDED, onCommentAdded);
    return () => {
      rt.off?.(WS_EVENTS.BCF_TOPIC_CREATED, onCreated);
      rt.off?.(WS_EVENTS.BCF_TOPIC_UPDATED, onUpdated);
      rt.off?.(WS_EVENTS.BCF_COMMENT_ADDED, onCommentAdded);
    };
  }, [buildingId]);
}
