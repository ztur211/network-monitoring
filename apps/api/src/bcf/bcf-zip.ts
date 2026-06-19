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

const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const xyz = (n: { X: number; Y: number; Z: number }): [number, number, number] => [Number(n.X), Number(n.Y), Number(n.Z)];
const pt = ([x, y, z]: number[]) => ({ X: x, Y: y, Z: z });

/** Parse a BCF 2.1 `.bcfzip` archive into topics (markup + primary viewpoint + snapshot). Pure. */
export async function readBcfZip(buffer: Buffer): Promise<ParsedBcf> {
  const zip = await JSZip.loadAsync(buffer);
  const topics: ParsedTopic[] = [];
  const guids = new Set<string>();
  for (const path of Object.keys(zip.files)) {
    const m = /^([^/]+)\/markup\.bcf$/.exec(path);
    if (m) guids.add(m[1]);
  }
  for (const guid of guids) {
    const markup = xml.parse(await zip.file(`${guid}/markup.bcf`)!.async('string')).Markup;
    const T = markup.Topic;
    const vpFile = zip.file(`${guid}/viewpoint.bcfv`);
    const viewpoints: ParsedViewpoint[] = [];
    if (vpFile) {
      const vi = xml.parse(await vpFile.async('string')).VisualizationInfo;
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
        snapshotPng: snap ? await snap.async('nodebuffer') : undefined,
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
