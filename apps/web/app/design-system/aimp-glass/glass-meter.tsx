// GlassMeter: a score or progress bar with its number written out. Uses the native <meter> semantics through ARIA
// (role="meter"), so assistive technology reads "72 out of 100". The fill is plum; it is not a second highlight.
import { clampMeter } from './steps';

export interface GlassMeterProps {
  label: string;
  value: number;
  max?: number;
  /** Text shown beside the label, for example "72 / 100". Defaults to "value / max". */
  valueText?: string;
  /** Hide the label and number visually (they stay available to assistive technology). */
  compact?: boolean;
  /** `progress` marks a task that is under way (role="progressbar") rather than a measurement. */
  kind?: 'meter' | 'progress';
  className?: string;
}

export function GlassMeter({ label, value, max = 100, valueText, compact = false, kind = 'meter', className = '' }: GlassMeterProps) {
  const m = clampMeter(value, max);
  const text = valueText ?? `${m.value} / ${m.max}`;
  return (
    <div className={`plg-meter ${className}`.trim()} data-compact={compact ? 'true' : undefined}>
      <div className={compact ? 'plg-sr' : 'plg-meter-head'}>
        <span className="plg-meter-label">{label}</span>
        <span className="plg-meter-value">{text}</span>
      </div>
      <div className="plg-meter-track" role={kind === 'progress' ? 'progressbar' : 'meter'} aria-label={label} aria-valuemin={0} aria-valuemax={m.max} aria-valuenow={m.value} aria-valuetext={text}>
        <span className="plg-meter-fill" style={{ inlineSize: `${m.percent}%` }} />
      </div>
    </div>
  );
}
