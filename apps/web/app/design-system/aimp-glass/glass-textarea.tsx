'use client';
// GlassTextArea and GlassSelect: the multi-line and pick-one companions to GlassField. Same label, hint and error
// wiring (aria-invalid + aria-describedby); native controls are kept so keyboards, autofill and pickers work.
import { useId } from 'react';
import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

interface Shared { label: string; labelHidden?: boolean; hint?: ReactNode; error?: string; className?: string }
const ids = (auto: string, id: string | undefined, hint: unknown, error: unknown, describedBy?: string) => {
  const fieldId = id ?? `plg-field-${auto.replace(/[^a-zA-Z0-9]/g, '')}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  return { fieldId, hintId, errorId, described: [describedBy, hintId, errorId].filter(Boolean).join(' ') || undefined };
};

export interface GlassTextAreaProps extends Shared, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'children'> {
  /** Shows "12 / 160" under the box when a maxLength is set. */
  showCount?: boolean;
}

export function GlassTextArea({ label, labelHidden = false, hint, error, className = '', id, rows = 3, showCount = false, 'aria-describedby': describedBy, ...area }: GlassTextAreaProps) {
  const x = ids(useId(), id, hint, error, describedBy);
  const length = typeof area.value === 'string' ? area.value.length : null;
  return (
    <div className={`plg-field ${className}`.trim()} data-invalid={error ? 'true' : undefined}>
      <label className={labelHidden ? 'plg-sr' : 'plg-field-label'} htmlFor={x.fieldId}>{label}</label>
      <textarea id={x.fieldId} className="plg-field-area" rows={rows} aria-invalid={error ? true : undefined} aria-describedby={x.described} {...area} />
      {showCount && area.maxLength && length !== null ? <p className="plg-field-count" aria-hidden="true">{length} / {area.maxLength}</p> : null}
      {hint ? <p className="plg-field-hint" id={x.hintId}>{hint}</p> : null}
      {error ? <p className="plg-field-error" id={x.errorId} role="alert">{error}</p> : null}
    </div>
  );
}

export interface GlassSelectProps extends Shared, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  icon?: ReactNode;
}

export function GlassSelect({ label, labelHidden = false, hint, error, className = '', id, icon, children, 'aria-describedby': describedBy, ...select }: GlassSelectProps) {
  const x = ids(useId(), id, hint, error, describedBy);
  return (
    <div className={`plg-field ${className}`.trim()} data-invalid={error ? 'true' : undefined}>
      <label className={labelHidden ? 'plg-sr' : 'plg-field-label'} htmlFor={x.fieldId}>{label}</label>
      <div className="plg-field-pill" data-select="true">
        {icon ? <span className="plg-field-icon" aria-hidden="true">{icon}</span> : null}
        <select id={x.fieldId} className="plg-field-input plg-field-select" aria-invalid={error ? true : undefined} aria-describedby={x.described} {...select}>{children}</select>
        <span className="plg-field-caret" aria-hidden="true" />
      </div>
      {hint ? <p className="plg-field-hint" id={x.hintId}>{hint}</p> : null}
      {error ? <p className="plg-field-error" id={x.errorId} role="alert">{error}</p> : null}
    </div>
  );
}
