/**
 * BCF Spec 6 Phase E — IssuesPanel
 *
 * Right-dock panel listing BCF topics for the active building. Mirrors the
 * Spec 4 NodePanel pattern (aside, section, list). Clicking a topic with a
 * primary viewpoint navigates the viewport to that viewpoint. The "New issue
 * from view" button is shown only to OWNER/ADMIN (canConfigure gate).
 */

import { useState } from 'react';
import { useBcf, useBcfStore } from '../use-bcf';
import { useViewportStore } from '../../../stores/viewport-store';
import { applyViewpoint } from '../apply-viewpoint';
import { navigateToViewpoint } from '../navigate-viewpoint';
import { captureViewpoint } from '../capture-viewpoint';
import { canConfigure } from '../../nodes/can-configure';
import { getClients } from '../../../data/clients';
import { toIfcGuid } from '@nodescope/shared';
import type { BcfTopicDto } from '@nodescope/shared';

const STATUS_COLORS: Record<string, string> = {
  Open: '#4a9eff',
  Closed: '#888',
  'In Progress': '#f0a030',
};

export function IssuesPanel() {
  useBcf();
  const topics = useBcfStore((s) => s.topics);
  const { model, devices, access, selection, activeBuildingPropertyId, cameraSnapshot } =
    useViewportStore();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const navigate = (t: BcfTopicDto) => {
    const vp = t.viewpoints?.[0];
    if (!vp || !model) return;
    const deviceGuidMap = new Map(devices.map((d) => [toIfcGuid(d.id), d.id]));
    navigateToViewpoint(applyViewpoint(vp, model.frame, model.guidIndex, deviceGuidMap));
  };

  const handleCreateFromView = async () => {
    if (!model || !activeBuildingPropertyId) return;
    const clients = getClients();
    if (!clients) return;

    // Use the stored camera snapshot; fall back to a default if not yet populated.
    const cam = cameraSnapshot ?? {
      position: { x: 0, y: 5, z: 10 } as any,
      target: { x: 0, y: 0, z: 0 } as any,
      up: { x: 0, y: 1, z: 0 } as any,
      fov: 50,
    };

    // Resolve selected device id from store selection (device kind only)
    const selectedDeviceId =
      selection?.kind === 'device' ? selection.deviceId : undefined;

    const captured = captureViewpoint(cam, model.frame, selectedDeviceId);

    // Capture snapshot from canvas (if available in browser context)
    let snapshotPngBase64: string | undefined;
    try {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas');
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        snapshotPngBase64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      }
    } catch {
      // snapshot is optional — proceed without it
    }

    const title = `Issue from view – ${new Date().toLocaleString()}`;
    setCreating(true);
    setCreateError(null);
    try {
      await clients.rest.createBcfTopic(activeBuildingPropertyId, {
        title,
        viewpoints: [
          {
            camera: captured.camera,
            components: captured.components,
            isPrimary: true,
            ...(snapshotPngBase64 ? { snapshotPngBase64 } : {}),
          },
        ],
      });
      // Realtime upsert will add the topic; no manual refetch needed.
    } catch (e: any) {
      setCreateError(e?.message ?? 'Failed to create issue');
    } finally {
      setCreating(false);
    }
  };

  const filteredTopics = statusFilter
    ? topics.filter((t) => t.topicStatus === statusFilter)
    : topics;

  const allStatuses = [...new Set(topics.map((t) => t.topicStatus ?? 'Unknown').filter(Boolean))];

  return (
    <section aria-label="issues" style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Issues</span>
        {allStatuses.length > 0 && (
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ flex: 1 }}
          >
            <option value="">All statuses</option>
            {allStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>
      {canConfigure(access) && (
        <button
          onClick={() => void handleCreateFromView()}
          disabled={creating || !model}
          style={{ fontSize: 12 }}
        >
          {creating ? 'Creating…' : 'New issue from view'}
        </button>
      )}
      {createError && (
        <span style={{ color: '#f66', fontSize: 11 }}>{createError}</span>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, overflow: 'auto' }}>
        {filteredTopics.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => navigate(t)}
              style={{ display: 'flex', gap: 6, width: '100%', textAlign: 'left', alignItems: 'center' }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: STATUS_COLORS[t.topicStatus ?? ''] ?? '#888',
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.title}
              </span>
              {t.topicStatus && (
                <span style={{ fontSize: 10, opacity: 0.7 }}>{t.topicStatus}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {filteredTopics.length === 0 && (
        <span style={{ fontSize: 12, opacity: 0.5 }}>No issues</span>
      )}
    </section>
  );
}
