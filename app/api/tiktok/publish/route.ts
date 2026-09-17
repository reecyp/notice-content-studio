import { NextResponse } from 'next/server';
import { saveSession } from '@/lib/db';
import { publishDeck, unreachable } from '@/lib/publish';
import { TOKEN_COOKIE, config, seal, unseal } from '@/lib/tiktok';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const YEAR = 365 * 24 * 60 * 60;

/**
 * Send one deck to TikTok as a photo carousel awaiting the user's edit.
 *
 * This is the browser's door in: it reads the cookie, and the person clicking
 * Send is the authorization. `/api/queue/send` is the other door, for an agent
 * with no cookie; both go through publishDeck.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);

  let cfg;
  try {
    cfg = config(url.origin);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const blocked = unreachable(cfg);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

  const session = unseal(
    req.headers.get('cookie')?.match(new RegExp(`${TOKEN_COOKIE}=([^;]+)`))?.[1],
    cfg.clientSecret,
  );
  if (!session) {
    return NextResponse.json({ error: 'not connected to TikTok', connect: '/api/tiktok/auth' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { deckId?: string };
  if (!body.deckId) return NextResponse.json({ error: 'deckId is required' }, { status: 400 });

  const { result, session: live, changed } = await publishDeck(cfg, session, body.deckId);

  const res = result.ok
    ? NextResponse.json({ publishId: result.publishId, tiles: result.tiles, urls: result.urls })
    : NextResponse.json({ error: result.error, logId: result.logId }, { status: result.status });

  // Refresh tokens rotate; a spent one has to be replaced or the next publish
  // is the one that fails. The stored copy is rewritten too, or the batch
  // endpoint would be left holding the token this call just spent.
  if (changed) {
    res.cookies.set(TOKEN_COOKIE, seal(live, cfg.clientSecret), {
      httpOnly: true,
      sameSite: 'lax',
      secure: url.origin.startsWith('https'),
      path: '/',
      maxAge: YEAR,
    });
    await saveSession(seal(live, cfg.clientSecret), live.openId);
  }
  return res;
}
