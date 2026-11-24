// Types for the React Bits Grainient component (components/Grainient.jsx). The project compiles TypeScript with allowJs off, so the
// plain-JavaScript source needs this declaration to be imported from .tsx files.
import type { CSSProperties, FC, HTMLAttributes } from 'react';

export interface GrainientProps extends Omit<HTMLAttributes<HTMLDivElement>, 'color'> {
  colors?: string[];
  type?: 'linear' | 'radial';
  angle?: number;
  bands?: number;
  speed?: number;
  flow?: number;
  scale?: number;
  softness?: number;
  silk?: number;
  grainAmount?: number;
  grainSize?: number;
  grainAnimated?: boolean;
  contrast?: number;
  saturation?: number;
  variation?: number;
  interactive?: boolean;
  stir?: number;
  clickSwirl?: boolean;
  intro?: boolean;
  lightMode?: boolean;
  dpr?: number;
  className?: string;
  style?: CSSProperties;
}

declare const Grainient: FC<GrainientProps>;
export default Grainient;
