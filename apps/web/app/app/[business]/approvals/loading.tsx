import { AppIntro, AppLayout, GlassState } from '../../../design-system/aimp-glass';

export default function ApprovalsLoading() {
  return (
    <AppLayout width="regular">
      <AppIntro title="Approvals and activity">{null}</AppIntro>
      <GlassState kind="loading" title="Loading your approvals…" />
    </AppLayout>
  );
}
