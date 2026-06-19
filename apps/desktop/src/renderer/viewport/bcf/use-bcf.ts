import { create } from 'zustand';
import { useEffect } from 'react';
import { WS_EVENTS } from '@nodescope/shared';
import type { BcfTopicDto } from '@nodescope/shared';
import { useViewportStore } from '../../stores/viewport-store';
import { getClients } from '../../data/clients';

export const useBcfStore = create<{
  topics: BcfTopicDto[];
  set: (t: BcfTopicDto[]) => void;
  upsert: (t: BcfTopicDto) => void;
}>((s) => ({
  topics: [],
  set: (topics) => s({ topics }),
  upsert: (t) =>
    s((st) => ({
      topics: st.topics.some((x) => x.id === t.id)
        ? st.topics.map((x) => (x.id === t.id ? t : x))
        : [...st.topics, t],
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
    const rt = getClients()?.realtime;
    if (!rt) return;

    // Server emits { topic } — unwrap it
    const onCreated = (payload: { topic: BcfTopicDto }) =>
      applyBcfEvent('created', payload.topic);
    const onUpdated = (payload: { topic: BcfTopicDto }) =>
      applyBcfEvent('updated', payload.topic);

    rt.on(WS_EVENTS.BCF_TOPIC_CREATED, onCreated);
    rt.on(WS_EVENTS.BCF_TOPIC_UPDATED, onUpdated);
    return () => {
      rt.off?.(WS_EVENTS.BCF_TOPIC_CREATED, onCreated);
      rt.off?.(WS_EVENTS.BCF_TOPIC_UPDATED, onUpdated);
    };
  }, []);
}
