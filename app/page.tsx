import Link from 'next/link';
import { loadAllDecks } from '@/lib/decks';
import { hasDb, sendStates, syncVideos } from '@/lib/db';
import { pill } from '@/lib/send-state';

export const dynamic = 'force-dynamic';

export default async function Library({
  searchParams,
}: {
  searchParams: Promise<{ tiktok?: string; message?: string }>;
}) {
  const [decks, banner] = await Promise.all([loadAllDecks(), searchParams]);

  // Disk is the source of truth for what exists. The library is the one page
  // that sees every deck, so it is where the registry catches up with it.
  const parsed = decks.flatMap((d) => ('deck' in d ? [d.deck] : []));
  await syncVideos(parsed);
  const states = await sendStates();
  const unsent = parsed.filter((d) => !states.get(d.uid)?.sentAt).length;

  return (
    <main className="wrap">
      <div className="masthead">
        <h1>Notice Content Studio</h1>
        <span className="sub">
          {decks.length} deck{decks.length === 1 ? '' : 's'} in /decks
          {hasDb() && ` · ${unsent} unsent`}
        </span>
      </div>

      {banner.tiktok === 'connected' && (
        <div className="note">TikTok account connected. Open a deck to send it.</div>
      )}
      {banner.tiktok === 'connected-browser-only' && (
        <div className="note">
          TikTok account connected for this browser. The session could not be stored, so the batch
          endpoint cannot post: check <code>DATABASE_URL</code> and connect again.
        </div>
      )}
      {banner.tiktok === 'error' && (
        <div className="note bad">TikTok did not connect: {banner.message ?? 'unknown error'}</div>
      )}

      {decks.length === 0 ? (
        <div className="empty">
          No decks yet. Drop a schema v2 JSON file into <code>decks/</code> and reload.
        </div>
      ) : (
        <div className="grid">
          {decks.map((d) =>
            'deck' in d ? (
              <Link className="card" key={d.deck.id} href={`/deck/${d.deck.id}`}>
                <h2>{d.deck.id}</h2>
                <div className="row">
                  <span className="meta">
                    {d.deck.tiles.length} tiles · v{d.deck.iteration}
                  </span>
                  {hasDb() &&
                    (() => {
                      const { tone, label } = pill(states.get(d.deck.uid));
                      return <span className={`pill ${tone}`}>{label}</span>;
                    })()}
                </div>
              </Link>
            ) : (
              <div className="card bad" key={d.id}>
                <h2>{d.id}</h2>
                <div className="meta">{d.error}</div>
              </div>
            ),
          )}
        </div>
      )}

      <div className="sitefoot">
        <Link href="/terms">Terms of Service</Link>
        <Link href="/privacy">Privacy Policy</Link>
      </div>
    </main>
  );
}
