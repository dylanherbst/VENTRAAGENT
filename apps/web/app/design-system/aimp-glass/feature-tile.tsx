'use client';
// FeatureTile: a compact tile with a title, a supporting line and a dimensional icon.
//  - Static (<FeatureTile>): a fixed marketing highlight. `highlighted` gives the one peach-to-purple tile.
//  - Selectable (<FeatureTileGroup>): a genuine single choice. It is a labelled radio group built on native
//    radio inputs (arrow keys, form submission and screen readers behave as usual); the chosen tile takes the
//    highlight and also shows a check mark, so the choice never depends on colour alone.
import type { ReactNode } from 'react';

export interface FeatureTileProps {
  title: string;
  detail?: string;
  icon?: ReactNode;
  highlighted?: boolean;
  /** `stack` (default): text above the icon. `row`: icon left, text right, for one-column lists. */
  layout?: 'stack' | 'row';
  className?: string;
}

function TileBody({ title, detail, icon }: Pick<FeatureTileProps, 'title' | 'detail' | 'icon'>) {
  return (
    <>
      <span className="plg-tile-text">
        <span className="plg-tile-title">{title}</span>
        {detail ? <span className="plg-tile-detail">{detail}</span> : null}
      </span>
      {icon ? <span className="plg-tile-icon" aria-hidden="true">{icon}</span> : null}
    </>
  );
}

export function FeatureTile({ title, detail, icon, highlighted = false, layout = 'stack', className = '' }: FeatureTileProps) {
  return (
    <div className={`plg-tile ${className}`.trim()} data-highlighted={highlighted ? 'true' : undefined} data-layout={layout}>
      <TileBody title={title} detail={detail} icon={icon} />
    </div>
  );
}

/** Lays static tiles out three across where they fit, then two, then one. Reading order follows visual order. */
export function FeatureTileRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`plg-tiles ${className}`.trim()}>{children}</div>;
}

export interface FeatureTileOption<V extends string = string> {
  value: V;
  title: string;
  detail?: string;
  /** Receives whether this option is selected, so the icon can switch to its pearl tone on the highlight. */
  icon?: (selected: boolean) => ReactNode;
  disabled?: boolean;
}

export interface FeatureTileGroupProps<V extends string = string> {
  /** The group's accessible name (rendered as the fieldset legend). */
  legend: string;
  /** Hide the legend visually when a heading right above already says the same thing. */
  legendHidden?: boolean;
  name: string;
  options: readonly FeatureTileOption<V>[];
  value: V | '';
  onChange: (value: V) => void;
  /** `tiles`: three across where they fit. `list`: one per row (better for longer descriptions). */
  layout?: 'tiles' | 'list';
  'aria-describedby'?: string;
  /** Marks the whole group invalid (for example when nothing was chosen). */
  invalid?: boolean;
  className?: string;
}

export function FeatureTileGroup<V extends string = string>({
  legend, legendHidden = false, name, options, value, onChange, layout = 'tiles', invalid = false, className = '', 'aria-describedby': describedBy,
}: FeatureTileGroupProps<V>) {
  return (
    <fieldset className={`plg-tilegroup ${className}`.trim()} role="radiogroup" aria-describedby={describedBy} aria-invalid={invalid || undefined}>
      <legend className={legendHidden ? 'plg-sr' : 'plg-tilegroup-legend'}>{legend}</legend>
      <div className="plg-tiles" data-layout={layout}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <label key={o.value} className="plg-tile" data-selectable="true" data-highlighted={selected ? 'true' : undefined} data-layout={layout === 'list' ? 'row' : 'stack'} data-disabled={o.disabled ? 'true' : undefined}>
              <input className="plg-tile-input" type="radio" name={name} value={o.value} checked={selected} disabled={o.disabled} onChange={() => onChange(o.value)} />
              <TileBody title={o.title} detail={o.detail} icon={o.icon?.(selected)} />
              <span className="plg-tile-check" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 12.5l4.2 4.2L18.5 7.5" /></svg>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
