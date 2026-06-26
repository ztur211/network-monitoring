import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

// BCF 2.1 file model (the cross-phase contract; Phases B/C/D consume these shapes).
export interface BcfCamera {
  kind: 'perspective' | 'orthographic';
  position: [number, number, number];
  direction: [number, number, number];
  up: [number, number, number];
  fieldOfView?: number;
  viewToWorldScale?: number;
}
export interface BcfComponents {
  selection: string[];
  visibility: { defaultVisibility: boolean; exceptions: string[] };
}
export interface ParsedViewpoint {
  guid: string;
  isPrimary: boolean;
  camera: BcfCamera;
  components: BcfComponents;
  clippingPlanes: unknown[];
  snapshotPng?: Buffer;
}
export interface ParsedComment {
  guid: string;
  comment: string;
  author: string;
  date: string;
  viewpointGuid?: string;
}
export interface ParsedTopic {
  guid: string;
  title: string;
  topicType?: string;
  topicStatus?: string;
  priority?: string;
  labels: string[];
  creationAuthor: string;
  creationDate: string;
  assignedTo?: string;
  description?: string;
  comments: ParsedComment[];
  viewpoints: ParsedViewpoint[];
}
export interface ParsedBcf {
  topics: ParsedTopic[];
}

// XXE-safe: fast-xml-parser does not resolve external entities. Attributes kept with a '@_' prefix.
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const build = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true });

/** Thrown when a `.bcfzip` decompresses (or declares it will) beyond the allowed size. */
export class BcfArchiveTooLargeError extends Error {
  constructor() {
    super('BCF archive decompresses beyond the allowed size');
    this.name = 'BcfArchiveTooLargeError';
  }
}

// The upload is capped at 50 MB *compressed*; DEFLATE reaches ~1000:1 on repetitive XML,
// so that can inflate to many GB and OOM the process (zip bomb). Cap the *decompressed*
// size too. Read at call-time so it can be tuned/overridden per environment (and in tests).
function maxDecompressedBytes(): number {
  const n = parseInt(process.env.BCF_MAX_DECOMPRESSED_BYTES ?? String(200 * 1024 * 1024), 10);
  return Number.isFinite(n) && n > 0 ? n : 200 * 1024 * 1024;
}

// JSZip exposes the central-directory declared size on the private `_data`; reading it lets
// us reject an honest bomb *before* materializing the entry (a post-hoc check would OOM
// first). Falls back to 0 when unavailable, degrading to the decoded-bytes backstop.
function declaredSize(file: JSZip.JSZipObject): number {
  return (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
}

const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const xyz = (n: { X: number; Y: number; Z: number }): [number, number, number] => [Number(n.X), Number(n.Y), Number(n.Z)];
const pt = ([x, y, z]: number[]) => ({ X: x, Y: y, Z: z });

/** Parse a BCF 2.1 `.bcfzip` archive into topics (markup + primary viewpoint + snapshot). Pure. */
export async function readBcfZip(buffer: Buffer): Promise<ParsedBcf> {
  const zip = await JSZip.loadAsync(buffer);
  const cap = maxDecompressedBytes();

  // Pre-flight: reject before decoding anything if the declared decompressed total — or
  // any single entry — already exceeds the cap. Catches the realistic (honestly-declared)
  // zip bomb without ever materializing it.
  let totalDeclared = 0;
  for (const f of Object.values(zip.files)) {
    const s = declaredSize(f);
    if (s > cap) throw new BcfArchiveTooLargeError();
    totalDeclared += s;
    if (totalDeclared > cap) throw new BcfArchiveTooLargeError();
  }

  // Backstop: track bytes actually decoded, in case a header understates its size. A single
  // entry that lies small but inflates huge would still need streaming to fully bound — the
  // per-entry declared check above covers the realistic case.
  let decoded = 0;
  const decodeString = async (f: JSZip.JSZipObject): Promise<string> => {
    const s = await f.async('string');
    decoded += Buffer.byteLength(s);
    if (decoded > cap) throw new BcfArchiveTooLargeError();
    return s;
  };
  const decodeBuffer = async (f: JSZip.JSZipObject): Promise<Buffer> => {
    const b = await f.async('nodebuffer');
    decoded += b.length;
    if (decoded > cap) throw new BcfArchiveTooLargeError();
    return b;
  };

  const topics: ParsedTopic[] = [];
  const guids = new Set<string>();
  for (const path of Object.keys(zip.files)) {
    const m = /^([^/]+)\/markup\.bcf$/.exec(path);
    if (m) guids.add(m[1]);
  }
  for (const guid of guids) {
    const markup = xml.parse(await decodeString(zip.file(`${guid}/markup.bcf`)!)).Markup;
    const T = markup.Topic;
    const vpFile = zip.file(`${guid}/viewpoint.bcfv`);
    const viewpoints: ParsedViewpoint[] = [];
    if (vpFile) {
      const vi = xml.parse(await decodeString(vpFile)).VisualizationInfo;
      const cam = vi.PerspectiveCamera ?? vi.OrthogonalCamera;
      const snap = zip.file(`${guid}/snapshot.png`);
      viewpoints.push({
        guid: vi['@_Guid'] ?? `${guid}-vp`,
        isPrimary: true,
        camera: {
          kind: vi.PerspectiveCamera ? 'perspective' : 'orthographic',
          position: xyz(cam.CameraViewPoint),
          direction: xyz(cam.CameraDirection),
          up: xyz(cam.CameraUpVector),
          fieldOfView: cam.FieldOfView != null ? Number(cam.FieldOfView) : undefined,
          viewToWorldScale: cam.ViewToWorldScale != null ? Number(cam.ViewToWorldScale) : undefined,
        },
        components: {
          selection: arr(vi.Components?.Selection?.Component).map((c: any) => c['@_IfcGuid']),
          visibility: {
            defaultVisibility: vi.Components?.Visibility?.['@_DefaultVisibility'] !== 'false',
            exceptions: arr(vi.Components?.Visibility?.Exceptions?.Component).map((c: any) => c['@_IfcGuid']),
          },
        },
        clippingPlanes: arr(vi.ClippingPlanes?.ClippingPlane),
        snapshotPng: snap ? await decodeBuffer(snap) : undefined,
      });
    }
    topics.push({
      guid,
      title: T.Title,
      topicType: T['@_TopicType'],
      topicStatus: T['@_TopicStatus'],
      priority: T.Priority,
      labels: arr(T.Labels).map((l: unknown) => String(l)),
      creationAuthor: T.CreationAuthor,
      creationDate: T.CreationDate,
      assignedTo: T.AssignedTo,
      description: T.Description,
      comments: arr(markup.Comment).map((c: any) => ({
        guid: c['@_Guid'],
        comment: c.Comment,
        author: c.Author,
        date: c.Date,
        viewpointGuid: c.Viewpoint?.['@_Guid'],
      })),
      viewpoints,
    });
  }
  return { topics };
}

/** Serialize topics into a BCF 2.1 `.bcfzip` buffer (version + per-topic markup/viewpoint/snapshot). Pure. */
export async function writeBcfZip(topics: ParsedTopic[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('bcf.version', build.build({ Version: { '@_VersionId': '2.1', DetailedVersion: '2.1' } }));
  for (const t of topics) {
    const markup = {
      Markup: {
        Topic: {
          '@_Guid': t.guid,
          '@_TopicType': t.topicType,
          '@_TopicStatus': t.topicStatus,
          Title: t.title,
          Priority: t.priority,
          CreationDate: t.creationDate,
          CreationAuthor: t.creationAuthor,
          AssignedTo: t.assignedTo,
          Description: t.description,
          Labels: t.labels,
        },
        Comment: t.comments.map((c) => ({
          '@_Guid': c.guid,
          Date: c.date,
          Author: c.author,
          Comment: c.comment,
          Viewpoint: c.viewpointGuid ? { '@_Guid': c.viewpointGuid } : undefined,
        })),
      },
    };
    zip.file(`${t.guid}/markup.bcf`, build.build(markup));
    const vp = t.viewpoints[0];
    if (vp) {
      const camTag = vp.camera.kind === 'perspective' ? 'PerspectiveCamera' : 'OrthogonalCamera';
      const vi = {
        VisualizationInfo: {
          '@_Guid': vp.guid,
          Components: {
            Selection: { Component: vp.components.selection.map((g) => ({ '@_IfcGuid': g })) },
            Visibility: {
              '@_DefaultVisibility': String(vp.components.visibility.defaultVisibility),
              Exceptions: { Component: vp.components.visibility.exceptions.map((g) => ({ '@_IfcGuid': g })) },
            },
          },
          [camTag]: {
            CameraViewPoint: pt(vp.camera.position),
            CameraDirection: pt(vp.camera.direction),
            CameraUpVector: pt(vp.camera.up),
            ...(vp.camera.fieldOfView != null ? { FieldOfView: vp.camera.fieldOfView } : {}),
            ...(vp.camera.viewToWorldScale != null ? { ViewToWorldScale: vp.camera.viewToWorldScale } : {}),
          },
        },
      };
      zip.file(`${t.guid}/viewpoint.bcfv`, build.build(vi));
      if (vp.snapshotPng) zip.file(`${t.guid}/snapshot.png`, vp.snapshotPng);
    }
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}
