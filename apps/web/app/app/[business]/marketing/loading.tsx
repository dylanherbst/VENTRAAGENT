import { AppIntro, AppLayout, GlassState } from '../../../design-system/aimp-glass';

export default function MarketingLoading() {
  return (
    <AppLayout width="regular">
      <AppIntro title="Marketing">{null}</AppIntro>
      <GlassState kind="loading" title="Loading your marketing plan…" />
    </AppLayout>
  );
}
