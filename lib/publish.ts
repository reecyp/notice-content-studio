import { loadDeck } from './decks';
import { recordFailedSend, recordSend } from './db';
import { TikTokError, caption, freshen, sendToDrafts } from './tiktok';
import type { Config, Session } from './tiktok';

/**
 * Sending one deck, with the ledger written and the session kept fresh.
 *
 * Two callers reach this from opposite directions. `/api/tiktok/publish` has a
 * person and a cookie; `/api/queue/send` has an API key and a database row.
 * What happens in between is identical, and it used to live only in the route
 * the browser called, which is why the batch endpoint could not exist.
 *
 * Nothing here throws. A send is one leg of a batch, and the batch has to be
 * able to record a failure and report what did go out, so the failure comes
 * back as a value.
 */

/**
 * TikTok fetches every tile from its own servers, so a private origin is a
 * guaranteed failure rather than a possible one. Worth saying before the post
 * rather than after.
 */
export function unreachable(cfg: Config): string | null {
  if (!cfg.publicBase.startsWith('https://') || /localhost|127\.0\.0\.1/.test(cfg.publicBase)) {
    return (
      `TikTok has to fetch the tiles itself and cannot reach ${cfg.publicBase}. ` +
      'Deploy, or point TIKTOK_PUBLIC_BASE at the deployed origin.'
    );
  }
  return null;
}

export type Published = {
  ok: true;
  deckId: string;
  uid: string;
  publishId: string;
  tiles: number;
  urls: string[];
};

export type NotPublished = {
  ok: false;
  deckId: string;
  status: number;
  error: string;
  logId?: string;
};

/**
 * The session as it stands after the call, and whether it moved.
 *
 * Refresh tokens rotate: TikTok can hand back a different one and the old one
 * is then spent. Every caller has somewhere to write that — a cookie, a row —
 * and a caller that ignores `changed` breaks its own next send, not this one.
 */
export type SendOutcome = { result: Published | NotPublished; session: Session; changed: boolean };

export async function publishDeck(
  cfg: Config,
  session: Session,
  deckId: string,
): Promise<SendOutcome> {
  const loaded = await loadDeck(deckId);
  if (!('deck' in loaded)) {
    return { result: { ok: false, deckId, status: 404, error: loaded.error }, session, changed: false };
  }
  const deck = loaded.deck;

  let live = session;
  let changed = false;
  try {
    ({ session: live, changed } = await freshen(cfg, session));
  } catch (e) {
    // A refresh that fails is the end of the batch, not of this deck: every
    // send after it would fail the same way. It is logged as an attempt all the
    // same, because the video did not go out.
    const error = e instanceof Error ? e.message : String(e);
    await recordFailedSend(deck, { error, logId: e instanceof TikTokError ? e.logId : undefined });
    return {
      result: { ok: false, deckId, status: 401, error: `TikTok session could not be refreshed: ${error}` },
      session,
      changed: false,
    };
  }

  try {
    const { publishId, urls } = await sendToDrafts(cfg, live.accessToken, deck);
    // The post exists now. Logging it must not be able to undo that, so
    // recordSend swallows its own failures rather than throwing into this try.
    await recordSend(deck, { publishId, caption: caption(deck) });
    return {
      result: { ok: true, deckId, uid: deck.uid, publishId, tiles: urls.length, urls },
      session: live,
      changed,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const logId = e instanceof TikTokError ? e.logId : undefined;
    await recordFailedSend(deck, { error, logId });
    return {
      result: { ok: false, deckId, status: e instanceof TikTokError ? 502 : 500, error, logId },
      session: live,
      changed,
    };
  }
}
