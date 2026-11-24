'use client';
// GlassSegmented: a short row of pill choices backed by a real radio group (arrow keys move the choice, the whole pill
// is the target). The chosen pill is the milky-white primary material with a check, so it does not rely on colour.
import { useId } from 'react';
import type { ReactNode } from 'react';

export interface GlassSegmentedOption<T extends string> { value: T; label: ReactNode; disabled?: boolean }

export interface GlassSegmentedProps<T extends string> {
  legend: string;
  legendHidden?: boolean;
  name?: string;
  value: T | '';
  onChange: (value: T) => void;
  options: readonly GlassSegmentedOption<T>[];
  /** `wrap` lets pills flow onto more lines; `scroll` keeps one line that scrolls sideways inside the control. */
  overflow?: 'wrap' | 'scroll';
  className?: string;
}

export function GlassSegmented<T extends string>({ legend, legendHidden = false, name, value, onChange, options, overflow = 'wrap', className = '' }: GlassSegmentedProps<T>) {
  const auto = useId();
  const group = name ?? `plg-seg-${auto.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <fieldset className={`plg-seg ${className}`.trim()} data-overflow={overflow}>
      <legend className={legendHidden ? 'plg-sr' : 'plg-seg-legend'}>{legend}</legend>
      <div className="plg-seg-row">
        {options.map((o) => (
          <label key={o.value} className="plg-seg-item" data-checked={value === o.value ? 'true' : undefined} data-disabled={o.disabled ? 'true' : undefined}>
            <input className="plg-seg-input" type="radio" name={group} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
            <span className="plg-seg-label">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
