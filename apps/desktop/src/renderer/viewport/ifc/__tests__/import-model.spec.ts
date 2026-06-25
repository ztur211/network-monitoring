import { describe, it, expect, vi } from 'vitest';
import { looksLikeIfc, importModel, type ImportableFile } from '../import-model';

const ifcBytes = () => new TextEncoder().encode('ISO-10303-21;\nHEADER;').buffer;
const fileOf = (name: string, bytes: ArrayBuffer): ImportableFile => ({
  name,
  arrayBuffer: () => Promise.resolve(bytes),
});

describe('looksLikeIfc', () => {
  it('accepts an ISO-10303-21 STEP header', () => {
    expect(looksLikeIfc(ifcBytes())).toBe(true);
  });
  it('rejects bytes without the header', () => {
    expect(looksLikeIfc(new TextEncoder().encode('<glTF>').buffer)).toBe(false);
    expect(looksLikeIfc(new ArrayBuffer(0))).toBe(false);
  });
});

describe('importModel', () => {
  it('uploads, activates the new version, then reloads', async () => {
    const rest = {
      uploadModelVersion: vi.fn().mockResolvedValue({ id: 'ver-9', versionNumber: 3 }),
      activateModelVersion: vi.fn().mockResolvedValue({}),
    };
    const reload = vi.fn();
    const bytes = ifcBytes();

    await importModel(fileOf('house.ifc', bytes), { rest, propertyId: 'prop-1', reload });

    expect(rest.uploadModelVersion).toHaveBeenCalledWith('prop-1', 'house.ifc', bytes);
    expect(rest.activateModelVersion).toHaveBeenCalledWith('prop-1', 'ver-9');
    // activate must run after upload, reload after activate
    expect(rest.activateModelVersion.mock.invocationCallOrder[0]).toBeGreaterThan(
      rest.uploadModelVersion.mock.invocationCallOrder[0],
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-IFC file before any network call', async () => {
    const rest = { uploadModelVersion: vi.fn(), activateModelVersion: vi.fn() };
    const reload = vi.fn();
    await expect(
      importModel(fileOf('notes.txt', new TextEncoder().encode('hi').buffer), {
        rest,
        propertyId: 'prop-1',
        reload,
      }),
    ).rejects.toThrow(/not a valid IFC/i);
    expect(rest.uploadModelVersion).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not activate or reload if the upload fails', async () => {
    const rest = {
      uploadModelVersion: vi.fn().mockRejectedValue(new Error('413 too large')),
      activateModelVersion: vi.fn(),
    };
    const reload = vi.fn();
    await expect(
      importModel(fileOf('house.ifc', ifcBytes()), { rest, propertyId: 'p', reload }),
    ).rejects.toThrow(/too large/);
    expect(rest.activateModelVersion).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
