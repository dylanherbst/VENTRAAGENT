// What Home and the Overview need from the AI Team: posts waiting, posts coming up, and whether anything has been approved yet. Server only.
import { agentTeam } from '../../../start/_server/agent-team-runtime';
import { availability, checkBusiness } from '../../../start/_server/runtime';

export interface AiTeamSummary {
  pending: number;
  approved: number;
  upcoming: { id: string; date: string; time: string; platform: string; hook: string }[];
  posted: boolean;
}

/** Never throws. Null when the demo tools are off or the business is unknown, so Home simply shows no AI Team lines. */
export function loadAiTeamSummary(business: string): AiTeamSummary | null {
  try {
    if (!availability().available || !checkBusiness(business)) return null;
    const d = agentTeam().dashboard(business);
    return {
      pending: d.pending, approved: d.approved,
      upcoming: d.upcoming.slice(0, 3).map((p) => ({ id: p.id, date: p.slot.date, time: p.slot.time, platform: p.slot.platform, hook: p.hook })),
      posted: d.posts.some((p) => p.state === 'approved' || p.state === 'scheduled' || p.state === 'published'),
    };
  } catch { return null; }
}
