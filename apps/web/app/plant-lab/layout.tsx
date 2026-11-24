import type { ReactNode } from 'react';
import { MeasureBridge } from './measure-bridge';

export default function PlantLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MeasureBridge />
      {children}
    </>
  );
}
