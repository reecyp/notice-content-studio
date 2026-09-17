import { neon } from '@neondatabase/serverless';
import { TERMINAL } from './send-state';
import type { Deck } from './types';

/**
 * The send ledger.
 *
 * The studio's state is deliberately split. `decks/*.json` is authored intent:
 * it lives in git, it diffs, an agent writes it. This file covers the other
 * half, the facts about the outside world that no file on disk can know, which
 * for now is one question per video: has it gone to TikTok, and what happened.
 *
 * Everything here is optional. With no DATABASE_URL the studio behaves exactly
 * as it did before the database existed, and every call below turns into a
 * no-op, so local rendering and `npm run check` never need a connection.
 *
 * Schema: scripts/schema.sql. Notes: docs/database.md.
 */

let cached: ReturnType<typeof neon> | null | undefined;

function db() {
  if (cached === undefined) {
    const url = process.env.DATABASE_URL;
    cached = url ? neon(url) : null;
  }
  return cached;
}

export const hasDb = () => db() !== null;

/**
 * A send has already happened by the time it is recorded, so a database that is
 * down must never turn a successful post into an error the caller reports. Every
 * write is wrapped: it warns and returns the fallback instead of throwing.
 */
async function safely<T>(what: string, run: () => Promise<T>, fallback: T): Promise<T> {
  if (!db()) return fallback;
  try {
    return await run();
  } catch (e) {
    console.warn(`[db] ${what} failed:`, e instanceof Error ? e.message : e);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * Mirror the decks on disk into `video`.
 *
 * Disk is the source of truth for what a video *is*; the row exists only to
 * hang sends off. Rows are never deleted here: a deck file can be removed long
 * after it was posted, and the log of that post should survive it.
 */
export async function syncVideos(decks: Deck[]): Promise<void> {
  const sql = db();
  if (!sql || !decks.length) return;
  await safely(
    'syncVideos',
    async () => {
      await sql`
        insert into video (uid, deck_id, iteration, tile_count, made_at)
        select * from unnest(
          ${decks.map((d) => d.uid)}::uuid[],
          ${decks.map((d) => d.id)}::text[],
          ${decks.map((d) => d.iteration)}::int[],
          ${decks.map((d) => d.tiles.length)}::int[],
          ${decks.map((d) => d.createdAt)}::timestamptz[]
        )
        on conflict (uid) do update set
          deck_id    = excluded.deck_id,
          iteration  = excluded.iteration,
          tile_count = excluded.tile_count,
          made_at    = excluded.made_at,
          updated_at = now()
      `;
    },
    undefined,
  );
}

export type SendState = {
  uid: string;
  /** Null means never successfully sent. This is the "sent or not" answer. */
  sentAt: string | null;
  lastStatus: string | null;
  lastPublishId: string | null;
  lastSendAt: string | null;
  sendCount: number;
};

/** Send state for every known video, keyed by uid, for the library and the viewer. */
export async function sendStates(): Promise<Map<string, SendState>> {
  const sql = db();
  if (!sql) return new Map();
  return safely(
    'sendStates',
    async () => {
      const rows = (await sql`
        select v.uid,
               v.sent_at,
               s.status     as last_status,
               s.publish_id as last_publish_id,
               s.created_at as last_send_at,
               (select count(*) from send where video_uid = v.uid) as send_count
        from video v
        left join lateral (
          select status, publish_id, created_at
          from send where video_uid = v.uid
          order by created_at desc limit 1
        ) s on true
      `) as Record<string, unknown>[];

      return new Map(
        rows.map((r) => [
          String(r.uid),
          {
            uid: String(r.uid),
            sentAt: r.sent_at ? String(r.sent_at) : null,
            lastStatus: r.last_status ? String(r.last_status) : null,
            lastPublishId: r.last_publish_id ? String(r.last_publish_id) : null,
            lastSendAt: r.last_send_at ? String(r.last_send_at) : null,
            sendCount: Number(r.send_count ?? 0),
          },
        ]),
      );
    },
    new Map(),
  );
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

/**
 * Record a deck handed to TikTok, and mark the video sent.
 *
 * `sent_at` is a coalesce rather than an assignment: it means *first* went out,
 * so a deliberate second send lands in the log without moving the date.
 */
export async function recordSend(
  deck: Deck,
  sent: { publishId: string; platform?: string; caption?: string },
): Promise<void> {
  const sql = db();
  if (!sql) return;
  await safely(
    'recordSend',
    async () => {
      await sql.transaction([
        sql`
          insert into video (uid, deck_id, iteration, tile_count, made_at, sent_at)
          values (${deck.uid}, ${deck.id}, ${deck.iteration}, ${deck.tiles.length}, ${deck.createdAt}, now())
          on conflict (uid) do update set
            deck_id    = excluded.deck_id,
            iteration  = excluded.iteration,
            tile_count = excluded.tile_count,
            made_at    = excluded.made_at,
            sent_at    = coalesce(video.sent_at, now()),
            updated_at = now()
        `,
        sql`
          insert into send (video_uid, platform, publish_id, status, iteration, tile_count, caption)
          values (
            ${deck.uid}, ${sent.platform ?? 'tiktok'}, ${sent.publishId}, 'PROCESSING',
            ${deck.iteration}, ${deck.tiles.length}, ${sent.caption ?? null}
          )
        `,
      ]);
    },
    undefined,
  );
}

/** Record an attempt that never got a publish id. The video stays unsent. */
export async function recordFailedSend(
  deck: Deck,
  failed: { error: string; logId?: string; platform?: string },
): Promise<void> {
  const sql = db();
  if (!sql) return;
  await safely(
    'recordFailedSend',
    async () => {
      await sql.transaction([
        sql`
          insert into video (uid, deck_id, iteration, tile_count, made_at)
          values (${deck.uid}, ${deck.id}, ${deck.iteration}, ${deck.tiles.length}, ${deck.createdAt})
          on conflict (uid) do update set made_at = excluded.made_at, updated_at = now()
        `,
        sql`
          insert into send (video_uid, platform, status, iteration, tile_count, error, log_id, settled_at)
          values (
            ${deck.uid}, ${failed.platform ?? 'tiktok'}, 'FAILED',
            ${deck.iteration}, ${deck.tiles.length}, ${failed.error}, ${failed.logId ?? null}, now()
          )
        `,
      ]);
    },
    undefined,
  );
}

/**
 * Write back what TikTok says became of a publish id.
 *
 * A publish id is a receipt, not a result: TikTok pulls the tiles afterwards and
 * that pull can fail. So a failure here has to put the video back in the queue,
 * unless some earlier send of it did complete.
 */
export async function settleSend(
  publishId: string,
  status: string,
  failReason?: string,
): Promise<void> {
  const sql = db();
  if (!sql) return;
  // SEND_TO_USER_INBOX is where a MEDIA_UPLOAD post comes to rest, so it
  // settles the row. A later PUBLISH_COMPLETE still overwrites the status if
  // the notification is eventually tapped.
  const terminal = TERMINAL.includes(status);
  await safely(
    'settleSend',
    async () => {
      await sql`
        update send set
          status     = ${status},
          error      = ${failReason ?? null},
          settled_at = case when ${terminal} then now() else settled_at end
        where publish_id = ${publishId}
      `;
      if (status === 'FAILED') {
        await sql`
          update video v set sent_at = null, updated_at = now()
          where v.uid = (select video_uid from send where publish_id = ${publishId} limit 1)
            and not exists (
              select 1 from send
              where video_uid = v.uid and status = 'PUBLISH_COMPLETE'
            )
        `;
      }
    },
    undefined,
  );
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export type QueuedVideo = { uid: string; deckId: string; iteration: number; madeAt: string | null };

/**
 * The next videos that have never gone out, oldest made first.
 *
 * This is the whole read side of "send the next 10": ask here, then send each
 * one. It reads the registry rather than the disk, so run syncVideos() first if
 * a deck may have been added since the last page load.
 *
 * Order is the deck's own `createdAt`, mirrored into made_at, because a row's
 * created_at only records when this database first heard of the deck. deck_id
 * breaks the tie between two decks made on the same day, so the queue is stable
 * across calls rather than left to the planner.
 */
export async function nextUnsent(limit = 10): Promise<QueuedVideo[]> {
  const sql = db();
  if (!sql) return [];
  return safely(
    'nextUnsent',
    async () => {
      const rows = (await sql`
        select uid, deck_id, iteration, made_at
        from video
        where sent_at is null
        order by made_at asc nulls last, deck_id asc
        limit ${Math.max(1, Math.min(35, limit))}
      `) as Record<string, unknown>[];
      return rows.map((r) => ({
        uid: String(r.uid),
        deckId: String(r.deck_id),
        iteration: Number(r.iteration),
        madeAt: r.made_at ? String(r.made_at) : null,
      }));
    },
    [],
  );
}

/**
 * How many videos are waiting.
 *
 * The batch send is all or nothing, so it has to know the depth of the queue
 * before it sends anything. Counting is a separate query from nextUnsent
 * because the answer it needs is "are there ten", not "which ten".
 */
export async function unsentCount(): Promise<number> {
  const sql = db();
  if (!sql) return 0;
  return safely(
    'unsentCount',
    async () => {
      const rows = (await sql`select count(*)::int as n from video where sent_at is null`) as Record<
        string,
        unknown
      >[];
      return Number(rows[0]?.n ?? 0);
    },
    0,
  );
}

export type SendLogEntry = {
  id: number;
  uid: string;
  deckId: string;
  platform: string;
  publishId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
  settledAt: string | null;
};

/** The send log, newest first. */
export async function sendLog(limit = 50): Promise<SendLogEntry[]> {
  const sql = db();
  if (!sql) return [];
  return safely(
    'sendLog',
    async () => {
      const rows = (await sql`
        select s.id, s.video_uid, v.deck_id, s.platform, s.publish_id,
               s.status, s.error, s.created_at, s.settled_at
        from send s join video v on v.uid = s.video_uid
        order by s.created_at desc
        limit ${Math.max(1, Math.min(500, limit))}
      `) as Record<string, unknown>[];
      return rows.map((r) => ({
        id: Number(r.id),
        uid: String(r.video_uid),
        deckId: String(r.deck_id),
        platform: String(r.platform),
        publishId: r.publish_id ? String(r.publish_id) : null,
        status: String(r.status),
        error: r.error ? String(r.error) : null,
        createdAt: String(r.created_at),
        settledAt: r.settled_at ? String(r.settled_at) : null,
      }));
    },
    [],
  );
}

// ---------------------------------------------------------------------------
// The log page
// ---------------------------------------------------------------------------

/**
 * A filter on whole days, inclusive at both ends, as `/log` supplies it.
 *
 * Either end may be absent, which means unbounded on that side. The comparison
 * happens in the database's time zone, so a day here is the server's day.
 */
export type DayRange = { from?: string | null; to?: string | null };

/**
 * A slice of the log, and the size of the thing it was cut from.
 *
 * `total` is what makes a truncated page honest: the page shows 50 rows and
 * says how many matched, rather than letting a capped list read as the whole
 * story. It comes back on the rows themselves, so a page is one round trip.
 */
export type LogPage<T> = { rows: T[]; total: number };

const LOG_LIMIT = (n: number) => Math.max(1, Math.min(200, Math.trunc(n)));

/** `count(*) over ()`, which is absent exactly when there are no rows. */
const totalOf = (rows: Record<string, unknown>[]) => Number(rows[0]?.total ?? 0);

export type QueueRow = {
  uid: string;
  deckId: string;
  iteration: number;
  tileCount: number;
  madeAt: string | null;
};

/**
 * The decks waiting to go out, in the order they will go.
 *
 * Deliberately narrower than `nextUnsent`: a deck whose send failed is unsent
 * too, and the batch endpoint will pick it up again, but on the log it belongs
 * under Failed rather than sitting in the queue looking untouched. So this asks
 * for the videos that have never been handed to TikTok at all, and
 * `retryPending` counts the ones held back, for the line that says so.
 *
 * Order matches `nextUnsent` because it has to: this is a picture of that
 * queue, and a picture that sorts differently is a picture of something else.
 */
export async function queuePage(range: DayRange = {}, limit = 50): Promise<LogPage<QueueRow>> {
  const sql = db();
  if (!sql) return { rows: [], total: 0 };
  const { from = null, to = null } = range;
  return safely(
    'queuePage',
    async () => {
      const rows = (await sql`
        select v.uid, v.deck_id, v.iteration, v.tile_count, v.made_at,
               count(*) over () as total
        from video v
        where v.sent_at is null
          and not exists (select 1 from send where video_uid = v.uid)
          and (${from}::date is null or v.made_at >= ${from}::date)
          and (${to}::date is null or v.made_at < ${to}::date + 1)
        order by v.made_at asc nulls last, v.deck_id asc
        limit ${LOG_LIMIT(limit)}
      `) as Record<string, unknown>[];
      return {
        total: totalOf(rows),
        rows: rows.map((r) => ({
          uid: String(r.uid),
          deckId: String(r.deck_id),
          iteration: Number(r.iteration),
          tileCount: Number(r.tile_count ?? 0),
          madeAt: r.made_at ? String(r.made_at) : null,
        })),
      };
    },
    { rows: [], total: 0 },
  );
}

/**
 * Unsent decks that have been tried before.
 *
 * The queue tab leaves these out, so it owes the reader a count of them.
 */
export async function retryPending(): Promise<number> {
  const sql = db();
  if (!sql) return 0;
  return safely(
    'retryPending',
    async () => {
      const rows = (await sql`
        select count(*)::int as n
        from video v
        where v.sent_at is null
          and exists (select 1 from send where video_uid = v.uid)
      `) as Record<string, unknown>[];
      return Number(rows[0]?.n ?? 0);
    },
    0,
  );
}

export type AttemptRow = {
  id: number;
  uid: string;
  deckId: string;
  platform: string;
  publishId: string | null;
  status: string;
  error: string | null;
  /** Snapshotted at send time, so it is what actually went out. */
  iteration: number;
  tileCount: number | null;
  /** When it was handed to TikTok. The date the Sent and Failed tabs filter on. */
  createdAt: string;
  settledAt: string | null;
  madeAt: string | null;
};

/**
 * Send attempts, newest first, split by how they ended.
 *
 * One row per attempt rather than per deck: a deck that failed and then went
 * out is two different events, and collapsing them hides the one worth seeing.
 * `outcome` splits the log in two because the page shows them as two tabs, and
 * FAILED is the only status that is not some stage of success in flight.
 */
export async function attemptsPage(
  outcome: 'sent' | 'failed',
  range: DayRange = {},
  limit = 50,
): Promise<LogPage<AttemptRow>> {
  const sql = db();
  if (!sql) return { rows: [], total: 0 };
  const { from = null, to = null } = range;
  const failed = outcome === 'failed';
  return safely(
    'attemptsPage',
    async () => {
      const rows = (await sql`
        select s.id, s.video_uid, v.deck_id, v.made_at, s.platform, s.publish_id,
               s.status, s.error, s.iteration, s.tile_count, s.created_at, s.settled_at,
               count(*) over () as total
        from send s join video v on v.uid = s.video_uid
        where (s.status = 'FAILED') = ${failed}::boolean
          and (${from}::date is null or s.created_at >= ${from}::date)
          and (${to}::date is null or s.created_at < ${to}::date + 1)
        order by s.created_at desc, s.id desc
        limit ${LOG_LIMIT(limit)}
      `) as Record<string, unknown>[];
      return {
        total: totalOf(rows),
        rows: rows.map((r) => ({
          id: Number(r.id),
          uid: String(r.video_uid),
          deckId: String(r.deck_id),
          platform: String(r.platform),
          publishId: r.publish_id ? String(r.publish_id) : null,
          status: String(r.status),
          error: r.error ? String(r.error) : null,
          iteration: Number(r.iteration),
          tileCount: r.tile_count === null || r.tile_count === undefined ? null : Number(r.tile_count),
          createdAt: String(r.created_at),
          settledAt: r.settled_at ? String(r.settled_at) : null,
          madeAt: r.made_at ? String(r.made_at) : null,
        })),
      };
    },
    { rows: [], total: 0 },
  );
}

// ---------------------------------------------------------------------------
// The connected account
// ---------------------------------------------------------------------------

/**
 * The TikTok session, stored so something other than a browser can publish.
 *
 * The cookie is still the studio's access model for a person clicking Send: it
 * is what makes the site need no login of its own. This row is the same session
 * written down a second time, and it exists for exactly one caller, the batch
 * endpoint, which arrives with no cookie at all.
 *
 * What is stored is the sealed blob, not the tokens. Sealing is lib/tiktok.ts's
 * job and the key is the client secret, so this file never sees an access token
 * and a dump of this database is worth nothing without the server's environment.
 */
export async function saveSession(sealed: string, openId?: string): Promise<boolean> {
  const sql = db();
  if (!sql) return false;
  return safely(
    'saveSession',
    async () => {
      await sql`
        insert into tiktok_session (id, open_id, sealed)
        values (1, ${openId ?? null}, ${sealed})
        on conflict (id) do update set
          open_id    = excluded.open_id,
          sealed     = excluded.sealed,
          updated_at = now()
      `;
      return true;
    },
    false,
  );
}

export type StoredSession = { sealed: string; openId: string | null; updatedAt: string };

/**
 * The stored session, or null.
 *
 * Null covers every way this can be unusable — no database, no row, an
 * unreachable host — and every one of them means the same thing to the caller:
 * nothing server-initiated can publish right now. Failing closed is the only
 * safe read here, which is why it goes through safely() like the rest.
 */
export async function loadSession(): Promise<StoredSession | null> {
  const sql = db();
  if (!sql) return null;
  return safely(
    'loadSession',
    async () => {
      const rows = (await sql`
        select open_id, sealed, updated_at from tiktok_session where id = 1
      `) as Record<string, unknown>[];
      const row = rows[0];
      if (!row?.sealed) return null;
      return {
        sealed: String(row.sealed),
        openId: row.open_id ? String(row.open_id) : null,
        updatedAt: String(row.updated_at),
      };
    },
    null,
  );
}

/** Forget the connected account. The browser cookie is unaffected. */
export async function clearSession(): Promise<void> {
  const sql = db();
  if (!sql) return;
  await safely('clearSession', async () => {
    await sql`delete from tiktok_session where id = 1`;
  }, undefined);
}
