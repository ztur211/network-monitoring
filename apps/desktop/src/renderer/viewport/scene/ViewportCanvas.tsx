import { useRef, type RefObject } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { ParsedModel } from '../ifc/ifc-types';
import { Lighting } from './Lighting';
import { ModelView } from './ModelView';
import { CameraRig } from './CameraRig';

function InvalidateOnControls({ controls }: { controls: RefObject<OrbitControlsImpl | null> }) {
  const { invalidate } = useThree();
  return <OrbitControls ref={controls} makeDefault onChange={() => invalidate()} />;
}

/** The scene contents (no <Canvas>) — rendered headless by @react-three/test-renderer. */
export function Scene({ model }: { model: ParsedModel }) {
  const controls = useRef<OrbitControlsImpl>(null);
  return (
    <>
      <color attach="background" args={[0x1c1f24]} />
      <Lighting />
      <InvalidateOnControls controls={controls} />
      <ModelView model={model} />
      <CameraRig box={model.bbox} controls={controls} />
    </>
  );
}

export function ViewportCanvas({ model }: { model: ParsedModel }) {
  return (
    <Canvas
      frameloop="demand"
      camera={{ fov: 50, near: 0.05, far: 5000, position: [10, 8, 10] }}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Scene model={model} />
    </Canvas>
  );
}
