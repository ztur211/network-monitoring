import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { ParsedModel } from '../ifc/ifc-types';
import { useViewportStore } from '../../stores/viewport-store';
import { applyModelState } from './apply-model-state';

export function ModelView({ model }: { model: ParsedModel }) {
  const { invalidate } = useThree();
  const selection = useViewportStore((s) => s.selection);
  const hiddenCategories = useViewportStore((s) => s.hiddenCategories);
  const hiddenElements = useViewportStore((s) => s.hiddenElements);
  const isolated = useViewportStore((s) => s.isolated);
  const section = useViewportStore((s) => s.section);
  useEffect(() => {
    applyModelState(model, { selection, hiddenCategories, hiddenElements, isolated, section });
    invalidate();
  }, [model, selection, hiddenCategories, hiddenElements, isolated, section, invalidate]);
  return <primitive object={model.root} />;
}
