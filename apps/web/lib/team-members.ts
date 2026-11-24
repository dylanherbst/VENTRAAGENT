// Read-only team list. The memberships table holds only user id, role and active flag (no emails),
// so people are shown by a short anonymous label. Raw user ids never leave the server.
export type TeamRole = 'owner' | 'staff';
export type MembershipRow = { user_id: string; role: string; active?: boolean };
export type TeamMember = { label: string; role: TeamRole; isYou: boolean };

const roleOrder: Record<TeamRole, number> = { owner: 0, staff: 1 };
export function roleWording(role: TeamRole): string {
  return role === 'owner' ? 'Owner: can save and change work' : 'Staff: can view only';
}
// Pure and total: unknown roles and inactive rows are dropped, malformed rows never throw.
export function shapeMembers(rows: unknown, currentUserId: string): TeamMember[] {
  if (!Array.isArray(rows)) return [];
  const people: { id: string; role: TeamRole }[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const { user_id, role, active } = r as Record<string, unknown>;
    if (typeof user_id !== 'string' || !user_id || active === false) continue;
    if (role !== 'owner' && role !== 'staff') continue;
    people.push({ id: user_id, role });
  }
  people.sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.id.localeCompare(b.id));
  let n = 0;
  return people.map(p => ({ label: p.id === currentUserId ? 'You' : `Team member ${++n}`, role: p.role, isYou: p.id === currentUserId }));
}
// Accepts only the exact shape the API returns, so the UI never renders unvalidated data.
export function parseTeamResponse(body: unknown): TeamMember[] | null {
  const m = body && typeof body === 'object' ? (body as Record<string, unknown>).members : null;
  if (!Array.isArray(m)) return null;
  const out: TeamMember[] = [];
  for (const x of m) {
    if (!x || typeof x !== 'object') return null;
    const { label, role, isYou } = x as Record<string, unknown>;
    if (typeof label !== 'string' || label.length > 40 || (role !== 'owner' && role !== 'staff') || typeof isYou !== 'boolean') return null;
    out.push({ label, role, isYou });
  }
  return out;
}
