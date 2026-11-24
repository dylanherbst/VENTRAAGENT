// Where the Operator and Approvals pages get their automation service: the /start runtime's own (AMP-140), so a /start business reads
// the runs and approvals of its own workspace, not the separate automation demo's fixtures. There is one answer because every business
// these pages can show is a /start business: the loaders check the business against the runtime's own list BEFORE they call the
// source, so an unknown business never reaches the service, and the service scopes every call by workspace and business.
// The separate automation demo (lib/aimp/automation/demo: demoAutomation) is still what the Overview and the Dashboard read their
// approvals from, and what /tools/aimp-automation drives.
// Returning null makes a page say "Not available in the demo yet".
import type { AutomationService } from '../../../../../lib/aimp/automation/service';
import { runtime } from '../../../../start/_server/runtime';

export function automationSource(): (() => AutomationService) | null {
  return () => runtime().automation.automation;
}
