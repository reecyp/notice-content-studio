import { NextResponse } from 'next/server';
import { STATE_COOKIE, TOKEN_COOKIE, TikTokError, config, exchangeCode, seal } from '@/lib/tiktok';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const YEAR = 365 * 24 * 60 * 60;

/**
 * Step two: trade the code for tokens and keep them in one encrypted cookie.
 *
 * The refresh token is good for a year, so this is the only time a browser
 * visit is needed. It also means publishing is possible only from the browser
 * that connected the account, which is the whole of the studio's access model.
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

    const res = back({ tiktok: 'connected' });
    res.cookies.set(TOKEN_COOKIE, seal(session, cfg.clientSecret), {
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
