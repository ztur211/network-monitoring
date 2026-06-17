import type { ParsedModel } from '../ifc/ifc-types';

// Phase C: just mount the recentered, Y-up root. Phase D extends this to apply
// per-mesh visibility / highlight / clipping.
export function ModelView({ model }: { model: ParsedModel }) {
  return <primitive object={model.root} />;
}
