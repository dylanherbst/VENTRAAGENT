import { NextRequest, NextResponse } from 'next/server';
import { sameOrigin } from '../../../../lib/request-security';
import { readBoundedRequestBody, RequestBodyTooLarge } from '../../../../lib/request-body';
import { createSupabaseClient } from '../../../../lib/supabase/client';
import { generateOpenAICourse } from '../../../../lib/openai-course';
import { createRateLimiter } from '../../../../lib/rate-limit';
// Paid provider call: at most 5 generations per user per 10 minutes on this server instance.
const generationLimit = createRateLimiter(5, 10 * 60_000);
import { frozenReply } from '../../../../lib/scope-freeze';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const paused = frozenReply('course-generation'); if (paused) return paused; // scope freeze: docs/agents/SCOPE_FREEZE.md
  const reply = (body: unknown, status: number) => NextResponse.json(body, {status, headers: {'Cache-Control':'no-store'}});
  if (!sameOrigin(req.headers.get('origin'),req.headers.get('host'),req.nextUrl.protocol,process.env.LAUNCHPAD_APP_ORIGIN) || !req.headers.get('content-type')?.startsWith('application/json')) return reply({error:'Use same-origin JSON requests.'},403);
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return reply({error:'AI generation requires approved server AI and Supabase configuration. Manual drafts are unchanged.'},503);
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? req.cookies.get('lp-access')?.value;
  if (!token) return reply({error:'Sign in and supply an authenticated access token.'},401);
  try {
    const {data,error} = await createSupabaseClient().auth.getUser(token);
    if (error || !data.user) return reply({error:'Session expired. Sign in again.'},401);
    const db = createSupabaseClient({fetch:(url,init)=>{const h=new Headers(init?.headers);h.set('Authorization','Bearer '+token);return fetch(url,{...init,headers:h,cache:'no-store'});}});
    const active = await db.rpc('session_active');
    if (active.error) return reply({error:'Account storage is unavailable. Please retry.'},503);
    if (!active.data) return reply({error:'Session revoked. Sign in again.'},401);
    const limited = generationLimit(data.user.id);
    if (!limited.allowed) return NextResponse.json({error:'Too many generations. Try again later.'},{status:429,headers:{'Cache-Control':'no-store','Retry-After':String(limited.retryAfterSeconds)}});
    const input = JSON.parse(await readBoundedRequestBody(req));
    if (typeof input?.brief !== 'string' || !input.brief.trim() || input.brief.length > 4000) return reply({error:'Describe your course in 1–4000 characters.'},400);
    const course = await generateOpenAICourse(input.brief, {signal:req.signal});
    return reply({course},200);
  } catch (error) {
    if (error instanceof RequestBodyTooLarge) return reply({error:'Request too large.'},413);
    if (error instanceof SyntaxError) return reply({error:'Invalid JSON. Check the request or provider response.'},400);
    return reply({error:'Generation failed. Check server configuration, model access and quota; your draft is unchanged.'},502);
  }
}
