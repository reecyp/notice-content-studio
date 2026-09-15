import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { STATE_COOKIE, TikTokError, authorizeUrl, config } from '@/lib/tiktok';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Step one: bounce the browser to TikTok to authorize the draft scope. */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;

  let cfg;
  try {
    cfg = config(origin);
  } catch (e) {
    const msg = e instanceof TikTokError ? e.message : String(e);
    return new NextResponse(msg, { status: 500 });
  }

  const state = randomBytes(16).toString('hex');
  const res = NextResponse.redirect(authorizeUrl(cfg, state));

  // Read back in the callback to prove the round trip is ours.
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: origin.startsWith('https'),
    path: '/',
    maxAge: 600,
  });
  return res;
}
