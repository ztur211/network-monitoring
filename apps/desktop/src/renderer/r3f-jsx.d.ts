// r3f v9's rolled-up main types entry drops the JSX intrinsic-element augmentation. Re-register r3f's
// ThreeElements on every JSX namespace the React 19 / react-jsx pipeline might resolve, so
// <mesh>/<color>/<hemisphereLight>/<primitive>/… type-check.
import type { ThreeElements } from '@react-three/fiber/dist/declarations/src/three-types';

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
declare module 'react/jsx-dev-runtime' {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
