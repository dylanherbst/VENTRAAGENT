import type { Metadata } from 'next';
import { FeatureRow, FeatureTile, FeatureTileRow, GlassButton, GlassIcon, OnboardingHeader, OnboardingLayout } from '../../design-system/aimp-glass';
import { site } from '../../../lib/aimp/site-config';
import { flowStepNumber, flowTotal, startRoutes } from '../flow';

export const metadata: Metadata = { title: 'How it works' };

// Feature overview: left-aligned intro, three compact tiles (one highlighted), two wide rows, bottom action.
// The tiles are a fixed highlight, not a choice, so they are static cards. Copy only describes what exists or is
// labelled as in pilot; no earnings claims.
export default function StartTour() {
  return (
    <OnboardingLayout
      align="start"
      header={
        <OnboardingHeader
          backHref={startRoutes.account}
          step={flowStepNumber('tour')}
          totalSteps={flowTotal}
          skipHref={startRoutes.goals}
          skipLabel="Skip the overview"
        />
      }
      footer={<GlassButton variant="primary" href={startRoutes.goals} icon={<GlassIcon name="spark" size={22} tone="deep" />}>Continue</GlassButton>}
    >
      <div className="plg-stack" data-gap="3">
        <h1 className="plg-title" data-weight="light">Welcome to <strong>{site.name}</strong></h1>
        <p className="plg-lede">Research an idea, build it with guidance, and stay in charge of every step.</p>
      </div>
      <FeatureTileRow>
        <FeatureTile title="Find ideas" detail="Matched to you" icon={<GlassIcon name="search" />} />
        <FeatureTile highlighted title="You approve" detail="Every step" icon={<GlassIcon name="approve" tone="pearl" />} />
        <FeatureTile title="Guided launch" detail="In pilot" icon={<GlassIcon name="store" />} />
      </FeatureTileRow>
      <div className="plg-stack" data-gap="3">
        <FeatureRow
          title="Ideas that fit you"
          detail="Answer five short questions. We score business ideas against your budget, time and interests."
          icon={<GlassIcon name="leaf" size={48} />}
        />
        <FeatureRow
          title="Honest numbers"
          detail="No earnings promises. Results depend on your niche and your work, and you see real figures as they come in."
          icon={<GlassIcon name="bars" size={48} />}
        />
      </div>
    </OnboardingLayout>
  );
}
