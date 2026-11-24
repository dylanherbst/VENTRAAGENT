'use client';
// OnboardingHeader: round glass Back action, a thin progress track with one dot per step, and a small Skip pill.
// Progress is exposed as "Step 2 of 3" and the current dot carries aria-current="step". The dots are not buttons
// because jumping between steps is not supported.
import { GlassButton } from './glass-button';
import { GlassIcon } from './glass-icon';
import { progressLabel, stepDots } from './steps';

export interface OnboardingHeaderProps {
  /** Where Back goes. Give `backHref` for navigation or `onBack` for an in-page step. Leave both out to hide Back. */
  backHref?: string;
  onBack?: () => void;
  backLabel?: string;
  /** 1-based current step. Leave out to hide the progress track. */
  step?: number;
  totalSteps?: number;
  skipHref?: string;
  onSkip?: () => void;
  /** Visible text of the Skip pill. */
  skipText?: string;
  /** Accessible name of the Skip pill when the visible text alone would be unclear. */
  skipLabel?: string;
  className?: string;
}

export function OnboardingHeader({
  backHref, onBack, backLabel = 'Back', step, totalSteps = 3, skipHref, onSkip, skipText = 'Skip', skipLabel, className = '',
}: OnboardingHeaderProps) {
  const hasBack = Boolean(backHref || onBack);
  const hasSkip = Boolean(skipHref || onSkip);
  return (
    <header className={`plg-header ${className}`.trim()}>
      <div className="plg-header-side">
        {hasBack ? (
          <GlassButton variant="icon" href={backHref} onClick={onBack} aria-label={backLabel} icon={<GlassIcon name="back" />} />
        ) : null}
      </div>
      {step !== undefined ? (
        <ol className="plg-steps" aria-label={progressLabel(step, totalSteps)}>
          {stepDots(step, totalSteps).map((dot) => (
            <li key={dot.index} className="plg-step" data-state={dot.state} aria-current={dot.state === 'current' ? 'step' : undefined}>
              <span className="plg-step-dot" aria-hidden="true" />
              <span className="plg-sr">{dot.label}</span>
            </li>
          ))}
        </ol>
      ) : <span className="plg-header-gap" />}
      <div className="plg-header-side" data-end="true">
        {hasSkip ? (
          <GlassButton variant="skip" href={skipHref} onClick={onSkip} aria-label={skipLabel}>{skipText}</GlassButton>
        ) : null}
      </div>
    </header>
  );
}
