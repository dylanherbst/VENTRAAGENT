import type { Metadata } from 'next';
import { GlassButton, GlassIcon, OnboardingLayout } from '../design-system/aimp-glass';
import { site } from '../../lib/aimp/site-config';
import { DemoFastForwardHeader } from './demo-fast-forward';
import { startRoutes } from './flow';
import { primaryEntry } from '../../lib/aimp/entry';

export const metadata: Metadata = { title: `Welcome · ${site.name}` };

// Welcome: open wave area above, centred heading and intro, then the two actions and a short reassurance.
export default function StartWelcome() {
  return (
    <OnboardingLayout
      align="end"
      text="center"
      header={<DemoFastForwardHeader />}
      footer={
        <>
          <GlassButton variant="primary" href={startRoutes.account} icon={<GlassIcon name="spark" size={22} tone="deep" />}>{primaryEntry.label}</GlassButton>
          <GlassButton variant="secondary" href="/start/existing">I already have a business</GlassButton>
          <GlassButton variant="secondary" href={`${startRoutes.account}?mode=login`}>I already have an account</GlassButton>
          <p className="plg-note start-legal">Free to start, no card needed. Nothing is published or charged without your approval.</p>
        </>
      }
    >
      <div className="plg-stack" data-gap="3">
        <h1 className="plg-title start-welcome-title">Welcome to {site.name}</h1>
        <p className="plg-lede">Find a small online business that fits your budget and your time, then build it step by step.</p>
      </div>
    </OnboardingLayout>
  );
}
