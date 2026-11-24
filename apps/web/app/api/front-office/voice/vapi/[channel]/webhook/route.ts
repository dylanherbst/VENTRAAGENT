import type { NextRequest } from 'next/server';
import { vapiWebhook } from '../../../../../../../lib/front-office/vapi-route';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// AI Receptionist, Vapi Server URL (call events) for one business's voice channel (id in the path). See lib/front-office/vapi.ts.
export async function POST(req: NextRequest, ctx: { params: Promise<{ channel: string }> }) { return vapiWebhook(req, (await ctx.params).channel); }
