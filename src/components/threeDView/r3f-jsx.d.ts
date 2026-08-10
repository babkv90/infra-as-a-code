import type { ThreeElements } from '@react-three/fiber';

// @react-three/fiber augments the classic global `JSX.IntrinsicElements` namespace, but this
// project's @types/react version resolves JSX through `react`'s own JSX namespace instead — without
// this, every three.js primitive (<mesh>, <group>, <boxGeometry>, ...) fails to type-check even
// though it renders correctly at runtime.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
