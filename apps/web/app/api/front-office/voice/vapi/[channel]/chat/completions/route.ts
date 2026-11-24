import type { NextRequest } from 'next/server';
import { vapiChat } from '../../../../../../../../lib/front-office/vapi-route';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// AI Receptionist, Vapi Custom LLM for one business's voice channel (id in the path). See lib/front-office/vapi.ts.
export async function POST(req: NextRequest, ctx: { params: Promise<{ channel: string }> }) { return vapiChat(req, (await ctx.params).channel); }
