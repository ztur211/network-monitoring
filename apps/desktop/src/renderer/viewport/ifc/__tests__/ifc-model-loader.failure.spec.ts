// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  api: {
    SetWasmPath: vi.fn(),
    Init: vi.fn().mockResolvedValue(undefined),
    OpenModel: vi.fn().mockReturnValue(42),
    CloseModel: vi.fn(),
    Dispose: vi.fn(),
  },
  extractElements: vi.fn(),
  assembleModel: vi.fn(),
}));

vi.mock('web-ifc', () => ({
  IfcAPI: class {
    SetWasmPath(...args: unknown[]) { return fakes.api.SetWasmPath(...args); }
    Init(...args: unknown[]) { return fakes.api.Init(...args); }
    OpenModel(...args: unknown[]) { return fakes.api.OpenModel(...args); }
    CloseModel(...args: unknown[]) { return fakes.api.CloseModel(...args); }
    Dispose(...args: unknown[]) { return fakes.api.Dispose(...args); }
  },
}));
vi.mock('../extract-elements', () => ({ extractElements: fakes.extractElements }));
vi.mock('../scene-assembly', () => ({ assembleModel: fakes.assembleModel }));

import { createIfcModelLoader } from '../ifc-model-loader';

describe('IfcModelLoader failure ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.api.Init.mockResolvedValue(undefined);
    fakes.api.OpenModel.mockReturnValue(42);
  });

  it('closes an opened model when extraction throws', async () => {
    fakes.extractElements.mockImplementation(() => { throw new Error('extract failed'); });
    const loader = createIfcModelLoader();

    await expect(loader.loadModel(new ArrayBuffer(8))).rejects.toThrow('extract failed');

    expect(fakes.api.CloseModel).toHaveBeenCalledTimes(1);
    expect(fakes.api.CloseModel).toHaveBeenCalledWith(42);
  });

  it('closes an opened model when scene assembly throws', async () => {
    fakes.extractElements.mockReturnValue([]);
    fakes.assembleModel.mockImplementation(() => { throw new Error('assembly failed'); });
    const loader = createIfcModelLoader();

    await expect(loader.loadModel(new ArrayBuffer(8))).rejects.toThrow('assembly failed');

    expect(fakes.api.CloseModel).toHaveBeenCalledTimes(1);
    expect(fakes.api.CloseModel).toHaveBeenCalledWith(42);
  });
});
