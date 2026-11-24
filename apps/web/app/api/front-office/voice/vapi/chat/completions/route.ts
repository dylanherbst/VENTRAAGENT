import type { NextRequest } from 'next/server';
import { vapiChat } from '../../../../../../../lib/front-office/vapi-route';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// AI Receptionist, Vapi Custom LLM for Ventra's own line (FRONT_OFFICE_VOICE_CHANNEL_ID). See lib/front-office/vapi.ts.
export async function POST(req: NextRequest) { return vapiChat(req, null); }
