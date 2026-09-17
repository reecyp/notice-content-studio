import Link from 'next/link';
import { loadAllDecks } from '@/lib/decks';
import { attemptsPage, hasDb, queuePage, retryPending, syncVideos } from '@/lib/db';
import type { AttemptRow, QueueRow } from '@/lib/db';
import { describe, inFlight } from '@/lib/send-state';
import type { Deck } from '@/lib/types';

// The log is a reading of the ledger as it stands. Never prerender it.
export const dynamic = 'force-dynamic';

/**
 * The send log.
 *
 * Two questions, three tabs. What is teed up to go out, what went out, and what
 * broke. The split is not cosmetic: a failed send puts the deck back in the
 * ledger's queue (settleSend clears sent_at), so without a tab of its own a
 * failure would read as a deck that had simply never been tried. Queue is
 * therefore the decks TikTok has never seen, and everything with a failure
 * behind it lives under Failed, counted back into the queue tab's header so
 * nothing goes missing between the two.
 *
 * Each tab loads 50 rows and says how many matched, so a capped list never
 * reads as the whole story. The date filter is a round trip rather than a
 * filter over those 50, or "most recent 50" and "in this range" would quietly
 * mean "the 50 newest, minus the ones outside the range".
 */

const PAGE = 50;

// What `POST /api/queue/send` takes by default (docs/queue-api.md). The queue
// tab draws a line here so the next batch is visible as a batch.
const BATCH = 10;

type Tab = 'queue' | 'sent' | 'failed';
const TABS: { id: Tab; label: string }[] = [
  { id: 'queue', label: 'Queue' },
  { id: 'sent', label: 'Sent' },
  { id: 'failed', label: 'Failed' },
];

type Query = { tab?: string; from?: string; to?: string };

/** A day the filter can actually use, or nothing. Anything else is dropped. */
const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export default async function Log({ searchParams }: { searchParams: Promise<Query> }) {
  const q = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === q.tab) ? (q.tab as Tab) : 'queue';
  const range = { from: day(q.from), to: day(q.to) };

  if (!hasDb()) {
    return (
      <Frame tab={tab} range={range} counts={null}>
        <div className="empty">
          There is no ledger. Set <code>DATABASE_URL</code> and run <code>npm run db:init</code>,
          and this page fills in.
        </div>
      </Frame>
    );
  }

  // Disk is the source of truth for what exists, and someone can land here
  // without passing the library, so the registry catches up here too.
  const loaded = await loadAllDecks();
  const decks = new Map(loaded.flatMap((d) => ('deck' in d ? [[d.deck.uid, d.deck] as const] : [])));
  await syncVideos([...decks.values()]);

  const [queue, sent, failed, retries] = await Promise.all([
    queuePage(range, PAGE),
    attemptsPage('sent', range, PAGE),
    attemptsPage('failed', range, PAGE),
    retryPending(),
  ]);
  const counts = { queue: queue.total, sent: sent.total, failed: failed.total };

  return (
    <Frame tab={tab} range={range} counts={counts}>
      {tab === 'queue' ? (
        <Queue page={queue} decks={decks} retries={retries} filtered={Boolean(range.from || range.to)} />
      ) : (
        <Attempts
          page={tab === 'sent' ? sent : failed}
          tab={tab}
          decks={decks}
          filtered={Boolean(range.from || range.to)}
        />
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function Frame({
  tab,
  range,
  counts,
  children,
}: {
  tab: Tab;
  range: { from?: string; to?: string };
  counts: Record<Tab, number> | null;
  children: React.ReactNode;
}) {
  const href = (t: Tab) => {
    const p = new URLSearchParams({ tab: t });
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    return `/log?${p}`;
  };

  return (
    <main className="wrap">
      <div className="masthead">
        <Link className="back" href="/">
          ← Library
        </Link>
        <h1>Log</h1>
      </div>

      <nav className="tabs">
        {TABS.map((t) => (
          <Link key={t.id} className={`tab${t.id === tab ? ' on' : ''}`} href={href(t.id)}>
            {t.label}
            {counts && <span className="n">{counts[t.id]}</span>}
          </Link>
        ))}
      </nav>

      {/*
        A plain GET form: the filter is part of the URL, so a filtered view is
        a link someone can keep, and the page needs no client JavaScript.
      */}
      <form className="filter" method="get" action="/log">
        <input type="hidden" name="tab" value={tab} />
        <label>
          {tab === 'queue' ? 'Made' : 'Sent'} from
          <input type="date" name="from" defaultValue={range.from ?? ''} />
        </label>
        <label>
          to
          <input type="date" name="to" defaultValue={range.to ?? ''} />
        </label>
        <button type="submit">Apply</button>
        {(range.from || range.to) && (
          <Link className="clear" href={`/log?tab=${tab}`}>
            Clear
          </Link>
        )}
      </form>

      {children}
    </main>
  );
}

// ---------------------------------------------------------------------------
// The tabs
// ---------------------------------------------------------------------------

function Queue({
  page,
  decks,
  retries,
  filtered,
}: {
  page: { rows: QueueRow[]; total: number };
  decks: Map<string, Deck>;
  retries: number;
  filtered: boolean;
}) {
  if (!page.rows.length) {
    return (
      <div className="empty">
        {filtered ? 'No decks were made in that range.' : 'Nothing is waiting. Every deck has gone out.'}
      </div>
    );
  }

  // The batch endpoint only sends what is still on disk, so a row whose file
  // has been deleted is in the ledger's queue but not in the real one.
  return (
    <>
      <Shown n={page.rows.length} total={page.total} noun={['deck waiting', 'decks waiting']} />
      {retries > 0 && (
        <p className="hint">
          {retries} more {retries === 1 ? 'deck is' : 'decks are'} unsent after a failed send. They
          are under <Link href="/log?tab=failed">Failed</Link>, and the batch endpoint will retry
          them ahead of these.
        </p>
      )}
      <table className="table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Deck</th>
            <th>Made</th>
            <th className="num">Tiles</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((r, i) => (
            <tr key={r.uid} className={i === BATCH ? 'rule' : undefined}>
              <td className="num muted">{i + 1}</td>
              <td>
                <Deckname id={r.deckId} deck={decks.get(r.uid)} />
              </td>
              <td className="when">{stamp(r.madeAt, 'day')}</td>
              <td className="num">{r.tileCount || decks.get(r.uid)?.tiles.length || '—'}</td>
              <td>
                {!decks.get(r.uid) ? (
                  <span className="pill failed">file gone</span>
                ) : i < BATCH ? (
                  <span className="pill pending">next batch</span>
                ) : (
                  <span className="pill">waiting</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Attempts({
  page,
  tab,
  decks,
  filtered,
}: {
  page: { rows: AttemptRow[]; total: number };
  tab: Tab;
  decks: Map<string, Deck>;
  filtered: boolean;
}) {
  if (!page.rows.length) {
    // An empty range is not an empty log, and saying so would send someone
    // looking for a bug in the ledger instead of at the dates they picked.
    return (
      <div className="empty">
        {filtered
          ? `Nothing ${tab === 'sent' ? 'went out' : 'failed'} in that range.`
          : tab === 'sent'
            ? 'Nothing has been sent yet.'
            : 'No failed sends.'}
      </div>
    );
  }

  return (
    <>
      <Shown
        n={page.rows.length}
        total={page.total}
        noun={tab === 'sent' ? ['send', 'sends'] : ['failure', 'failures']}
      />
      <table className="table">
        <thead>
          <tr>
            <th>Sent</th>
            <th>Deck</th>
            <th>{tab === 'sent' ? 'Status' : 'What went wrong'}</th>
            <th>{tab === 'sent' ? 'Settled' : 'Publish id'}</th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((r) => (
            <tr key={r.id}>
              <td className="when">{stamp(r.createdAt, 'minute')}</td>
              <td>
                <Deckname id={r.deckId} deck={decks.get(r.uid)} />
                <span className="meta">
                  v{r.iteration}
                  {r.tileCount ? ` · ${r.tileCount} tiles` : ''}
                  {r.platform !== 'tiktok' ? ` · ${r.platform}` : ''}
                </span>
              </td>
              {tab === 'sent' ? (
                <td>
                  <span className={`pill ${tone(r.status)}`}>{r.status.toLowerCase().replace(/_/g, ' ')}</span>
                  <span className="meta">{describe(r.status)}</span>
                </td>
              ) : (
                <td className="why">{r.error ?? 'No reason was recorded.'}</td>
              )}
              <td className="when">
                {tab === 'sent' ? (
                  r.settledAt ? (
                    stamp(r.settledAt, 'minute')
                  ) : (
                    <span className="muted">{inFlight(r.status) ? 'in flight' : 'not recorded'}</span>
                  )
                ) : (
                  <code className="id">{r.publishId ?? 'never issued'}</code>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

/** Says how much of the match is on screen, so a capped page does not mislead. */
function Shown({ n, total, noun }: { n: number; total: number; noun: [string, string] }) {
  const word = (count: number) => noun[count === 1 ? 0 : 1];
  return (
    <p className="hint">
      {n < total ? `${n} of ${total} ${word(total)}, newest first` : `${total} ${word(total)}`}
    </p>
  );
}

/**
 * A deck by its id, with its opening line when the file is still on disk.
 *
 * Ledger rows outlive the files they describe, so the id has to carry the row
 * on its own and the link only appears when there is something to open.
 */
function Deckname({ id, deck }: { id: string; deck: Deck | undefined }) {
  const opener = hook(deck);
  return (
    <>
      {deck ? (
        <Link className="deck" href={`/deck/${id}`}>
          {id}
        </Link>
      ) : (
        <span className="deck gone">{id}</span>
      )}
      {opener && <span className="meta">{opener}</span>}
    </>
  );
}

/** The first tile's words, which is how a person actually recognises a deck. */
function hook(deck: Deck | undefined): string | null {
  const first = deck?.tiles[0];
  if (first?.role !== 'hook') return null;
  const text = first.lines.join(' ').replace(/\*\*/g, '').trim();
  return text.length > 72 ? `${text.slice(0, 71)}…` : text;
}

const tone = (status: string) =>
  status === 'PUBLISH_COMPLETE' || status === 'SEND_TO_USER_INBOX' ? 'sent' : 'pending';

/**
 * Timestamps in the server's zone, fixed to en-GB so the same row does not read
 * one way in a render and another after hydration.
 */
function stamp(iso: string | null, to: 'day' | 'minute'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (to === 'day') return date;
  return `${date}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
