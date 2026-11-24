import { AppIntro, AppLayout, GlassState } from '../../../design-system/aimp-glass';

export default function WebsiteLoading() {
  return (
    <AppLayout width="regular">
      <AppIntro title="Website">{null}</AppIntro>
      <GlassState kind="loading" title="Loading your website…" />
    </AppLayout>
  );
}
