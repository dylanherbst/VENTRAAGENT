import type { Metadata } from 'next';
import { GlassButton, GlassIcon, OnboardingLayout } from '../design-system/aimp-glass';
import { site } from '../../lib/aimp/site-config';
import { startRoutes } from './flow';
import { primaryEntry } from '../../lib/aimp/entry';

export const metadata: Metadata = { title: `Welcome · ${site.name}` };

// Growth welcome: for existing businesses. Same layout as before; the startup quiz is parked (lib/aimp/growth/product.ts).
export default function StartWelcome() {
  return (
    <OnboardingLayout
      align="end"
      text="center"
      footer={
        <>
          <GlassButton variant="primary" href={primaryEntry.href} icon={<GlassIcon name="spark" size={22} tone="deep" />}>{primaryEntry.label}</GlassButton>
          <GlassButton variant="secondary" href="/site#ai-team">Meet your AI agents</GlassButton>
          <GlassButton variant="secondary" href={`${startRoutes.account}?mode=login`}>I already have an account</GlassButton>
          <p className="plg-note start-legal">Nothing is posted, sent or charged without your approval. No earnings promises.</p>
        </>
      }
    >
      <div className="plg-stack" data-gap="3">
        <p className="plg-eyebrow">Your business. Powered by an AI growth team.</p>
        <h1 className="plg-title start-welcome-title">Stop doing everything yourself. Hire your own AI growth team.</h1>
        <p className="plg-lede">Three AI agents working together to generate leads, grow your social media and automate your marketing, without the cost of hiring an entire team.</p>
      </div>
    </OnboardingLayout>
  );
}
