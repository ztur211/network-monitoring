import type { BuildingModelVersionDto } from '@nodescope/shared';

// Every IFC-SPF (.ifc) file is an ISO-10303-21 (STEP) text file and starts with this magic
// token. We check it client-side before uploading so an obviously-wrong file fails fast with a
// clear message instead of round-tripping to the server. (Same guard scripts/load-sample-model.mjs uses.)
const IFC_MAGIC = 'ISO-10303-21';

/** True if the bytes begin with the ISO-10303-21 STEP header that every .ifc file carries. */
export function looksLikeIfc(bytes: ArrayBuffer): boolean {
  const head = new TextDecoder('latin1').decode(new Uint8Array(bytes.slice(0, IFC_MAGIC.length)));
  return head.startsWith(IFC_MAGIC);
}

// A minimal File-like shape so the orchestration is unit-testable without a DOM File.
export interface ImportableFile {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ImportModelDeps {
  rest: {
    uploadModelVersion(
      propertyId: string,
      fileName: string,
      bytes: ArrayBuffer,
      units?: string,
    ): Promise<BuildingModelVersionDto>;
    activateModelVersion(propertyId: string, versionId: string): Promise<unknown>;
  };
  propertyId: string;
  /** Bumps the viewport reload seam so the loader re-fetches the now-active model. */
  reload: () => void;
}

/**
 * Import a BIM model into the active building: validate → upload as a new version → activate it
 * as the live model → trigger a viewport reload. The activated model's IFC elements keep their
 * native GlobalIds (GUIDs), which is what device network pointers reference (see ifc-guid.ts).
 */
export async function importModel(file: ImportableFile, deps: ImportModelDeps): Promise<void> {
  const bytes = await file.arrayBuffer();
  if (!looksLikeIfc(bytes)) {
    throw new Error(`"${file.name}" is not a valid IFC file (missing ISO-10303-21 header).`);
  }
  const version = await deps.rest.uploadModelVersion(deps.propertyId, file.name, bytes);
  await deps.rest.activateModelVersion(deps.propertyId, version.id);
  deps.reload();
}
