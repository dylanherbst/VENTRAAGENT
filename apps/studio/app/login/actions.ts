'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createLoginLimiter, SESSION_COOKIE, SESSION_HOURS, signSession, verifyPassword } from '../../../web/lib/aimp/studio/auth';

const limiter = createLoginLimiter();

export async function loginAction(_prev: { error: string }, form: FormData): Promise<{ error: string }> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'local';
  if (limiter.blocked(ip)) return { error: 'Too many tries. Wait 15 minutes.' };
  const hash = process.env.STUDIO_PASSWORD_HASH, secret = process.env.STUDIO_SESSION_SECRET;
  if (!hash || !secret || secret.length < 32) return { error: 'Login is not set up yet. Run "npm run password" in apps/studio and add the two lines it prints.' };
  if (!(await verifyPassword(String(form.get('password') ?? ''), hash))) { limiter.fail(ip); return { error: 'That password is not right.' }; }
  limiter.clear(ip);
  (await cookies()).set(SESSION_COOKIE, signSession(secret), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: SESSION_HOURS * 3600 });
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
