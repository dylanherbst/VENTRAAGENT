'use client';
import { NotificationPrefsEditor } from '../../ui/notification-prefs';
import { ConnectionBadges } from '../../ui/connection-badges';

// Isolated test page: the real preferences editor, the real account sync panel and the notifications list that obeys them.
export default function NotificationPrefsTest() {
  return <main>
    <h1>Notification settings test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real settings in browser storage</span> The account copy needs sign-in, an owner role and migration 18 applied; see the connection state below. Open /tools/notifications to see the effect.</p>
    <ConnectionBadges />
    <NotificationPrefsEditor />
  </main>;
}
