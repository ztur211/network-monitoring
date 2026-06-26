import { readBcfZip, writeBcfZip, BcfArchiveTooLargeError, ParsedTopic } from '../bcf-zip';

const topic: ParsedTopic = {
  guid: 'c2c0e1a0-0000-0000-0000-000000000001',
  title: 'Clash at riser',
  topicType: 'Clash',
  topicStatus: 'Open',
  priority: 'High',
  labels: ['MEP'],
  creationAuthor: 'arch@x.com',
  creationDate: '2026-06-12T00:00:00Z',
  assignedTo: 'net@x.com',
  description: 'Switch overlaps duct',
  comments: [
    { guid: 'cmt0', comment: 'Please move', author: 'arch@x.com', date: '2026-06-12T01:00:00Z', viewpointGuid: 'vp0' },
  ],
  viewpoints: [
    {
      guid: 'vp0',
      isPrimary: true,
      camera: { kind: 'perspective', position: [1, 2, 3], direction: [0, 0, -1], up: [0, 1, 0], fieldOfView: 60 },
      components: { selection: ['1aBcD$0000000000000000'], visibility: { defaultVisibility: true, exceptions: [] } },
      clippingPlanes: [],
    },
  ],
};

describe('bcf-zip', () => {
  it('writes a .bcfzip and reads it back losslessly', async () => {
    const buf = await writeBcfZip([topic]);
    const parsed = await readBcfZip(buf);
    expect(parsed.topics).toHaveLength(1);
    const t = parsed.topics[0];
    expect(t).toMatchObject({ guid: topic.guid, title: 'Clash at riser', topicStatus: 'Open', priority: 'High' });
    expect(t.comments[0].comment).toBe('Please move');
    expect(t.comments[0].viewpointGuid).toBe('vp0');
    expect(t.viewpoints[0].camera.position).toEqual([1, 2, 3]);
    expect(t.viewpoints[0].camera.kind).toBe('perspective');
    expect(t.viewpoints[0].components.selection).toEqual(['1aBcD$0000000000000000']);
    expect(t.viewpoints[0].components.visibility.defaultVisibility).toBe(true);
  });

  it('round-trips an orthographic camera + a visibility exception', async () => {
    const ortho: ParsedTopic = {
      ...topic,
      guid: 'c2c0e1a0-0000-0000-0000-000000000002',
      comments: [],
      viewpoints: [
        {
          guid: 'vp1',
          isPrimary: true,
          camera: { kind: 'orthographic', position: [0, 0, 10], direction: [0, 0, -1], up: [0, 1, 0], viewToWorldScale: 5 },
          components: { selection: [], visibility: { defaultVisibility: false, exceptions: ['2efGh$0000000000000000'] } },
          clippingPlanes: [],
        },
      ],
    };
    const parsed = await readBcfZip(await writeBcfZip([ortho]));
    const vp = parsed.topics[0].viewpoints[0];
    expect(vp.camera.kind).toBe('orthographic');
    expect(vp.camera.viewToWorldScale).toBe(5);
    expect(vp.components.visibility.defaultVisibility).toBe(false);
    expect(vp.components.visibility.exceptions).toEqual(['2efGh$0000000000000000']);
  });

  it('writes a discoverable bcf.version and one markup per topic', async () => {
    const buf = await writeBcfZip([topic]);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file('bcf.version')).not.toBeNull();
    expect(zip.file(`${topic.guid}/markup.bcf`)).not.toBeNull();
    expect(zip.file(`${topic.guid}/viewpoint.bcfv`)).not.toBeNull();
  });

  describe('zip-bomb guard', () => {
    const KEY = 'BCF_MAX_DECOMPRESSED_BYTES';
    const original = process.env[KEY];
    afterEach(() => {
      if (original === undefined) delete process.env[KEY];
      else process.env[KEY] = original;
    });

    it('rejects an archive whose declared decompressed size exceeds the cap', async () => {
      process.env[KEY] = '10000'; // 10 KB cap
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      // 50 KB of highly-compressible XML — declares uncompressedSize ~50 KB but the
      // compressed archive is tiny (the zip-bomb shape). Must be rejected before decode.
      zip.file('topic-1/markup.bcf', 'A'.repeat(50_000));
      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

      await expect(readBcfZip(buf)).rejects.toBeInstanceOf(BcfArchiveTooLargeError);
    });

    it('does not trip the guard for a normal archive under the cap', async () => {
      process.env[KEY] = String(1024 * 1024); // 1 MB — comfortably above a 1-topic archive
      const parsed = await readBcfZip(await writeBcfZip([topic]));
      expect(parsed.topics).toHaveLength(1);
    });
  });
});
