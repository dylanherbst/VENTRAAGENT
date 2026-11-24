// Creatomate render webhook. The docs read do not describe a signature, so the body is only a hint: we look the render up by its
// provider id and our own metadata, then fetch its real status from the Creatomate API before changing anything.
import { agentTeam } from '../../../start/_server/agent-team-runtime';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 200_000) return new Response('Too large', { status: 413 });
  let body: unknown; try { body = JSON.parse(raw); } catch { return new Response('Bad body', { status: 400 }); }
  await agentTeam().handleCreatomateHint(body);
  return Response.json({ received: true });
}
