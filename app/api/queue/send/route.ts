import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { loadAllDecks } from '@/lib/decks';
import { hasDb, loadSession, saveSession, syncVideos, nextUnsent, unsentCount } from '@/lib/db';
import { publishDeck, unreachable } from '@/lib/publish';
import type { Published } from '@/lib/publish';
import { config, seal, unseal } from '@/lib/tiktok';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Send the next N decks to TikTok, oldest made first.
 *
 * The endpoint an agent calls on a schedule. Everything it needs that a browser
 * would have supplied comes from somewhere else: the account from the
 * `tiktok_session` row rather than a cookie, the authorization from a shared
 * key rather than a person clicking Send.
 *
 * Two rules shape the rest of it, and both came from the ask rather than the
 * code. The batch is all or nothing: a short queue sends nothing and says so,
 * so the posting cadence stays even instead of trailing off. And it paces
 * itself, because TikTok allows six requests a minute per access token and ten
 * decks is ten calls.
 */

// TikTok allows 6 requests per minute per access token. Ten seconds apart is
// exactly that; the extra half second is for a clock that is not ours. The
// override exists because a published rate limit is not a law of nature, and
// because scripts/check-queue.mjs would otherwise spend a minute asleep.
const SPACING_MS = Number(process.env.QUEUE_SPACING_MS ?? 10_500);

// Vercel's ceiling for this function. A batch is mostly spent waiting out the
// rate limit, so the duration is set by SPACING_MS and the batch size.
export const maxDuration = 300;

// 20 decks is ~200s of pacing, which leaves real headroom inside maxDuration
// for 20 round trips to TikTok. Asking for more is rejected rather than
// truncated, because a batch that silently shrinks is a batch that lies.
const MAX_BATCH = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The shared key, compared without leaking its length or its prefix.
 *
 * Both sides are hashed first so timingSafeEqual gets two equal-length buffers:
 * it throws on a length mismatch, and throwing is itself a signal. Only called
 * once the key is known to be set.
 */
function authorized(req: Request): boolean {
  const expected = process.env.QUEUE_API_KEY ?? '';
  const header = req.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Everything both verbs need, or the response that says why they cannot run.
 *
 * The unconfigured cases are answered before the key is checked, on purpose. An
 * operator who forgot an environment variable is the likeliest caller to get
 * turned away here, and "unauthorized" would send them looking for the wrong
 * thing. All it admits to an unauthenticated caller is that the endpoint exists
 * and is switched off.
 */
async function ready(req: Request, url: URL) {
  if (!process.env.QUEUE_API_KEY) {
    return {
      fail: NextResponse.json(
        { error: 'the queue API is not enabled: set QUEUE_API_KEY in the environment' },
        { status: 503 },
      ),
    };
  }
  if (!authorized(req)) {
    return { fail: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  if (!hasDb()) {
    return {
      fail: NextResponse.json(
        { error: 'the queue needs DATABASE_URL: without it nothing records what has been sent' },
        { status: 503 },
      ),
    };
  }

  let cfg;
  try {
    cfg = config(url.origin);
  } catch (e) {
    return { fail: NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }) };
  }

  const stored = await loadSession();
  const session = unseal(stored?.sealed, cfg.clientSecret);
  // A stored row that will not unseal is its own diagnosis, and a different one
  // from having no row at all: the seal key is TIKTOK_CLIENT_SECRET, so it means
  // the secret in this environment is not the one that sealed the session.
  const sessionState = !stored ? 'none' : session ? 'ok' : 'unreadable';
  return { cfg, session, sessionState, connectedAt: stored?.updatedAt ?? null };
}

/**
 * What the queue looks like right now, so a scheduled agent can decide whether
 * to call POST at all. Same key, no side effects beyond the disk-to-registry
 * sync that every page load already does.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = await ready(req, url);
  if ('fail' in state) return state.fail;

  const { onDisk, unparsed } = await registry();
  const queue = (await nextUnsent(35)).filter((q) => onDisk.has(q.uid));

  return NextResponse.json({
    connected: Boolean(state.session),
    session: state.sessionState,
    connectedAt: state.connectedAt,
    queued: await unsentCount(),
    ready: queue.length,
    maxBatch: MAX_BATCH,
    unparsed,
    nextUp: queue.slice(0, 10).map((q) => ({ deckId: q.deckId, madeAt: q.madeAt })),
  });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const state = await ready(req, url);
  if ('fail' in state) return state.fail;
  const { cfg } = state;

  const blocked = unreachable(cfg);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

  if (!state.session) {
    return NextResponse.json(
      {
        error:
          state.sessionState === 'unreadable'
            ? 'a TikTok session is stored but this environment cannot unseal it. The seal key is ' +
              'TIKTOK_CLIENT_SECRET, so it does not match the one that connected the account.'
            : 'no TikTok account is stored on the server. Open /api/tiktok/auth in a browser once ' +
              'to connect it; the studio keeps the refresh token for a year.',
        session: state.sessionState,
        connect: '/api/tiktok/auth',
      },
      { status: 409 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { count?: number };
  const requested = body.count ?? 10;
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_BATCH) {
    return NextResponse.json(
      { error: `count must be a whole number from 1 to ${MAX_BATCH}`, maxBatch: MAX_BATCH },
      { status: 400 },
    );
  }

  const { onDisk, unparsed } = await registry();
  // A row can outlive its file: rows are never deleted, deck files are. Dropping
  // those here keeps a removed deck from aborting a batch with a 404 halfway in.
  const queue = (await nextUnsent(35)).filter((q) => onDisk.has(q.uid));

  if (queue.length < requested) {
    return NextResponse.json(
      {
        error: 'not enough decks in the queue for a full batch',
        requested,
        available: queue.length,
        unparsed,
      },
      { status: 409 },
    );
  }

  const batch = queue.slice(0, requested);
  const sent: Published[] = [];
  let session = state.session;

  for (const [i, queued] of batch.entries()) {
    // Between sends, never before the first and never after the last: the whole
    // point is the gap, and a gap on either end is just latency.
    if (i > 0) await sleep(SPACING_MS);

    const outcome = await publishDeck(cfg, session, queued.deckId);
    if (outcome.changed) {
      session = outcome.session;
      await saveSession(seal(session, cfg.clientSecret), session.openId);
    }

    if (!outcome.result.ok) {
      // Stop rather than carry on. Whatever broke one send — an expired token,
      // a rate limit, TikTok being down — breaks the next nine the same way,
      // and the decks already sent have left the queue and stay gone.
      return NextResponse.json(
        {
          error: outcome.result.error,
          logId: outcome.result.logId,
          failedOn: outcome.result.deckId,
          requested,
          sent: sent.length,
          decks: sent.map(summary),
        },
        { status: 502 },
      );
    }
    sent.push(outcome.result);
  }

  return NextResponse.json({
    sent: sent.length,
    requested,
    remaining: queue.length - sent.length,
    decks: sent.map(summary),
  });
}

const summary = (p: Published) => ({
  deckId: p.deckId,
  uid: p.uid,
  publishId: p.publishId,
  tiles: p.tiles,
});

/**
 * Catch the registry up with the disk, and report what is there.
 *
 * The library page does this on every load, but nothing guarantees a person
 * opened it since the last deck was authored, and a deck that never synced is a
 * deck the queue cannot see.
 */
async function registry() {
  const loads = await loadAllDecks();
  const parsed = loads.flatMap((d) => ('deck' in d ? [d.deck] : []));
  await syncVideos(parsed);
  return {
    onDisk: new Set(parsed.map((d) => d.uid)),
    // Surfaced rather than swallowed: a deck that does not parse is invisible to
    // the queue, and the only place that would otherwise show is the library.
    unparsed: loads.flatMap((d) => ('deck' in d ? [] : [{ id: d.id, error: d.error }])),
  };
}
