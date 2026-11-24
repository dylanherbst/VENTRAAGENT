'use client';
// GlassField: a thin glass input pill with a leading icon, a real <label>, an optional hint and an error message.
// The native <input> is kept (autocomplete, password managers and the right mobile keyboard all keep working).
// Errors set aria-invalid and are linked with aria-describedby.
import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, Ref } from 'react';

export interface GlassFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'children'> {
  label: string;
  /**
   * Hides the label visually (it stays the accessible name) so the placeholder carries the visible prompt, as in the
   * approved mockup. Prefer the visible label wherever there is room.
   */
  labelHidden?: boolean;
  /** Leading 18-20px icon. Decorative. */
  icon?: ReactNode;
  /** Trailing control inside the pill, for example a show-password button. */
  trailing?: ReactNode;
  hint?: ReactNode;
  /** Plain-English error. When set the field is marked invalid and the message is announced. */
  error?: string;
  ref?: Ref<HTMLInputElement>;
  className?: string;
}

export function GlassField({ label, labelHidden = false, icon, trailing, hint, error, id, className = '', ref, 'aria-describedby': describedBy, ...input }: GlassFieldProps) {
  const auto = useId();
  const fieldId = id ?? `plg-field-${auto.replace(/[^a-zA-Z0-9]/g, '')}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const described = [describedBy, hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`plg-field ${className}`.trim()} data-invalid={error ? 'true' : undefined}>
      <label className={labelHidden ? 'plg-sr' : 'plg-field-label'} htmlFor={fieldId}>{label}</label>
      <div className="plg-field-pill">
        {icon ? <span className="plg-field-icon" aria-hidden="true">{icon}</span> : null}
        <input ref={ref} id={fieldId} className="plg-field-input" aria-invalid={error ? true : undefined} aria-describedby={described} {...input} />
        {trailing ? <span className="plg-field-trailing">{trailing}</span> : null}
      </div>
      {hint ? <p className="plg-field-hint" id={hintId}>{hint}</p> : null}
      {error ? <p className="plg-field-error" id={errorId} role="alert">{error}</p> : null}
    </div>
  );
}
