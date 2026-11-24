'use client';
import { useMemo, useState } from 'react';
import { formatSlot, openSlots, pickOffers } from '../../../lib/front-office/calendar/slots';
import type { Availability } from '../../../lib/front-office/calendar/slots';

// Isolated test page for the Setter's slot offers (tracker 1.2, 1.3). It runs the production slot finder against sample
// business hours and one sample busy block. The live path reads free/busy from Google Calendar on the server.
const sample: Availability = {
  timeZone: 'Australia/Perth',
  weekly: { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']], 3: [['09:00', '17:00']], 4: [['09:00', '17:00']], 5: [['09:00', '15:00']] },
  slotMinutes: 30, bufferMinutes: 15, minNoticeMinutes: 120, horizonDays: 7,
};
export default function FrontOfficeBookingTest() {
  const [now] = useState(() => Date.now());
  const [busyHour, setBusyHour] = useState(11);
  const offers = useMemo(() => {
    const d = new Date(now + 86_400_000);
    const busyStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), busyHour - 8); // sample busy block tomorrow, Perth time
    const slots = openSlots(sample, [{ start: busyStart, end: busyStart + 3_600_000 }], now);
    return { all: slots.length, picked: pickOffers(slots, sample.timeZone) };
  }, [now, busyHour]);
  return <main>
    <h1>Setter booking slots test</h1>
    <p><span className="v-status" data-testid="page-mode">DEMO · Sample hours, no calendar read, nothing booked</span> Live offers read Google Calendar free/busy on the server.</p>
    <p>Hours: Mon to Thu 9 am to 5 pm, Fri 9 am to 3 pm, Perth time. 30-minute slots, 15-minute buffer, 2 hours notice.</p>
    <label htmlFor="busy-hour">Sample busy hour tomorrow (Perth)</label>
    <select id="busy-hour" value={busyHour} onChange={e => setBusyHour(Number(e.target.value))}>
      {[9, 10, 11, 12, 13, 14, 15, 16].map(h => <option key={h} value={h}>{h}:00</option>)}
    </select>
    <p>{offers.all} open slots in the next 7 days. The Setter would offer:</p>
    <ol data-testid="offers">{offers.picked.map(o => <li key={o.start}>{formatSlot(o.start, sample.timeZone)}</li>)}</ol>
  </main>;
}
