import { statusLabel } from '../../../lib/site/content';
import type { Status } from '../../../lib/site/content';
export function StatusPill({ status }: { status: Status }) {
  return <span className={`vs-pill vs-pill-${status}`}>{statusLabel[status]}</span>;
}
