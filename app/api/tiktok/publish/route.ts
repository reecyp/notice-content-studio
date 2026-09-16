import { NextResponse } from 'next/server';
import { loadDeck } from '@/lib/decks';
import { recordFailedSend, recordSend } from '@/lib/db';
import {
  TOKEN_COOKIE,
  TikTokError,
  caption,
  config,
  freshen,
  seal,
  sendToDrafts,
  unseal,
} from '@/lib/tiktok';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const YEAR = 365 * 24 * 60 * 60;

/** Send one deck to TikTok as a photo carousel awaiting the user's edit. */
export async function POST(req: Request) {
  const url = new URL(req.url);

  let cfg;
  try {
    cfg = config(url.origin);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // TikTok fetches every tile from its own servers, so a private origin is a
  // guaranteed failure. Say so here rather than letting the post fail later.
  if (!cfg.publicBase.startsWith('https://') || /localhost|127\.0\.0\.1/.test(cfg.publicBase)) {
    return NextResponse.json(
      {
        error:
          `TikTok has to fetch the tiles itself and cannot reach ${cfg.publicBase}. ` +
          'Deploy, or point TIKTOK_PUBLIC_BASE at the deployed origin.',
      },
      { status: 409 },
    );
  }

  const session = unseal(req.headers.get('cookie')?.match(new RegExp(`${TOKEN_COOKIE}=([^;]+)`))?.[1], cfg.clientSecret);
  if (!session) {
    return NextResponse.json({ error: 'not connected to TikTok', connect: '/api/tiktok/auth' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { deckId?: string };
  if (!body.deckId) return NextResponse.json({ error: 'deckId is required' }, { status: 400 });

  const loaded = await loadDeck(body.deckId);
  if (!('deck' in loaded)) return NextResponse.json({ error: loaded.error }, { status: 404 });

  try {
    const { session: live, changed } = await freshen(cfg, session);
    const { publishId, urls } = await sendToDrafts(cfg, live.accessToken, loaded.deck);

    // The post exists now. Logging it must not be able to undo that, so
    // recordSend swallows its own failures rather than throwing into this try.
    await recordSend(loaded.deck, { publishId, caption: caption(loaded.deck) });

    const res = NextResponse.json({ publishId, tiles: urls.length, urls });
    // Refresh tokens rotate; a spent one has to be replaced or the next
    // publish is the one that fails.
    if (changed) {
      res.cookies.set(TOKEN_COOKIE, seal(live, cfg.clientSecret), {
        httpOnly: true,
        sameSite: 'lax',
        secure: url.origin.startsWith('https'),
        path: '/',
        maxAge: YEAR,
      });
    }
    return res;
  } catch (e) {
    const status = e instanceof TikTokError ? 502 : 500;
    await recordFailedSend(loaded.deck, {
      error: e instanceof Error ? e.message : String(e),
      logId: e instanceof TikTokError ? e.logId : undefined,
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), logId: e instanceof TikTokError ? e.logId : undefined },
      { status },
    );
  }
}
