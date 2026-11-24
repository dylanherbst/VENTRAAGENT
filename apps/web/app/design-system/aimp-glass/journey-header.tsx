'use client';
// JourneyHeader: the header for app pages inside a multi-step journey. Round glass Back action, the step name with
// "Step 3 of 7", a thin segmented progress track and room at the end for a status badge. The track is decorative;
// progress is announced through the text.
import type { ReactNode } from 'react';
import { GlassButton } from './glass-button';
import { GlassIcon } from './glass-icon';
import { progressLabel, stepDots } from './steps';

export interface JourneyHeaderProps {
  backHref?: string;
  onBack?: () => void;
  backLabel?: string;
  /** 1-based current step and the total. */
  step: number;
  totalSteps: number;
  /** Short name of the current step, for example "Brand". */
  stepName: string;
  /** End slot: a DEMO/LIVE badge or a small action. */
  end?: ReactNode;
  className?: string;
}

export function JourneyHeader({ backHref, onBack, backLabel = 'Back', step, totalSteps, stepName, end, className = '' }: JourneyHeaderProps) {
  const dots = stepDots(step, totalSteps);
  return (
    <header className={`plg-jh ${className}`.trim()}>
      <div className="plg-jh-row">
        <div className="plg-header-side">
          {backHref || onBack ? <GlassButton variant="icon" href={backHref} onClick={onBack} aria-label={backLabel} icon={<GlassIcon name="back" />} /> : null}
        </div>
        <p className="plg-jh-label"><span className="plg-jh-count">{progressLabel(step, totalSteps)}</span><span className="plg-jh-name">{stepName}</span></p>
        <div className="plg-header-side" data-end="true">{end}</div>
      </div>
      <div className="plg-jh-track" aria-hidden="true">
        {dots.map((d) => <span key={d.index} className="plg-jh-seg" data-state={d.state} />)}
      </div>
    </header>
  );
}
