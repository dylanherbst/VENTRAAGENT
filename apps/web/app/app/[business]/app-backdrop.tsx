'use client';
// Full-screen animated background for the owner workspace (React Bits Grainient, components/Grainient.jsx).
import Grainient from '../../../components/Grainient';

import { useTheme } from './theme-toggle';

const LIGHT = ['#9529fa', '#c990ff', '#f8f6fa', '#ffffff', '#ffffff'];
const DARK = ['#3b0f7a', '#6d28d9', '#150d26', '#0a0712', '#0a0712'];

export function AppBackdrop() {
  const dark = useTheme() === 'dark';
  return (
    <div className="aimp-backdrop" aria-hidden="true">
      <Grainient colors={dark ? DARK : LIGHT} angle={55} flow={0.8} silk={0.35} grainAmount={0.08} speed={1.45} />
    </div>
  );
}
