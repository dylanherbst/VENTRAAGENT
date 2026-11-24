import { AppIntro, AppLayout, GlassState } from '../../../design-system/aimp-glass';

export default function OperatorLoading() {
  return (
    <AppLayout width="regular">
      <AppIntro title="Operator runs">{null}</AppIntro>
      <GlassState kind="loading" title="Loading your runs…" />
    </AppLayout>
  );
}
