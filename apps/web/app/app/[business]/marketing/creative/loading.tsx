import { AppIntro, AppLayout, GlassState } from '../../../../design-system/aimp-glass';

export default function CreativeLoading() {
  return (
    <AppLayout width="regular">
      <AppIntro title="Creative Studio">{null}</AppIntro>
      <GlassState kind="loading" title="Loading your drafts…" />
    </AppLayout>
  );
}
