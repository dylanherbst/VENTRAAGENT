import type { AgentTeam } from '../../../../lib/aimp/agents/team';

type Dash = ReturnType<AgentTeam['dashboard']>;
export type TeamView = Omit<Dash, 'assets'> & { assets: (Dash['assets'][number] & { src: string | null })[]; message: string | null; errors: string[] };
