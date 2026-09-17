import { NextResponse } from 'next/server';
import { saveSession } from '@/lib/db';
import { STATE_COOKIE, TOKEN_COOKIE, TikTokError, config, exchangeCode, seal } from '@/lib/tiktok';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const YEAR = 365 * 24 * 60 * 60;

/**
 * Step two: trade the code for tokens and keep them in one encrypted cookie.
 *
 * The refresh token is good for a year, so this is the only time a browser
 * visit is needed, and the cookie remains the whole of the studio's access
 * model for a person clicking Send.
 *
 * The same sealed blob is written to the database as well, when there is one.
 * That copy is what `/api/queue/send` reads, and it is the only reason an agent
 * or a cron can post at all: neither carries a cookie. Sealed with the client
 * secret either way, so the row is inert without the server's environment.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (params: Record<string, string>) =>
    NextResponse.redirect(new URL(`/?${new URLSearchParams(params)}`, url.origin));

  const error = url.searchParams.get('error');
  if (error) {
    return back({ tiktok: 'error', message: url.searchParams.get('error_description') || error });
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = req.headers.get('cookie')?.match(new RegExp(`${STATE_COOKIE}=([^;]+)`))?.[1];

  if (!code) return back({ tiktok: 'error', message: 'no code on the callback' });
  if (!state || !expected || state !== expected) {
    return back({ tiktok: 'error', message: 'state did not match, start again' });
  }

  try {
    const cfg = config(url.origin);
    const session = await exchangeCode(cfg, code);

    const sealed = seal(session, cfg.clientSecret);
    const stored = await saveSession(sealed, session.openId);

    const res = back(stored ? { tiktok: 'connected' } : { tiktok: 'connected-browser-only' });
    res.cookies.set(TOKEN_COOKIE, sealed, {
      httpOnly: true,
      sameSite: 'lax',
      secure: url.origin.startsWith('https'),
      path: '/',
      maxAge: YEAR,
    });
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (e) {
    const msg = e instanceof TikTokError ? e.message : String(e);
    return back({ tiktok: 'error', message: msg });
  }
}
