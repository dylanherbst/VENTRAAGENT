import type { NextRequest } from 'next/server';
import { vapiWebhook } from '../../../../../../lib/front-office/vapi-route';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// AI Receptionist, Vapi Server URL (call events) for Ventra's own line (FRONT_OFFICE_VOICE_CHANNEL_ID). See lib/front-office/vapi.ts.
export async function POST(req: NextRequest) { return vapiWebhook(req, null); }
