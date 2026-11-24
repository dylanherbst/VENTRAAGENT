import { AppIntro, AppLayout, GlassState } from '../../../../design-system/aimp-glass';

export default function CalendarLoading() {
  return (
    <AppLayout width="regular">
      <AppIntro title="Campaign calendar">{null}</AppIntro>
      <GlassState kind="loading" title="Loading your calendar…" />
    </AppLayout>
  );
}
