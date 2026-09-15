import { loadDeck } from '@/lib/decks';
import { isFormat, renderTile } from '@/lib/tile-image';

// Native canvas bindings rule out the edge runtime, and a tile is rendered
// from whatever the JSON says right now, so nothing here is prerenderable.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One tile, as a PNG, at a URL TikTok can fetch.
 *
 * The Content Posting API only accepts photos by URL — it pulls them from a
 * domain the app has proved it owns — so this is the seam between a deck on
 * disk and a post. The deck JSON stays the only source of truth: there is no
 * store, no upload step and nothing to invalidate, because the bytes are
 * regenerated per request.
 *
 *   /api/tile/80-20-rule/1.png    -> tile 1, one-based, matching exportName()
 *   /api/tile/80-20-rule/1.webp   -> the same tile in a format TikTok accepts
 */

// This route is public, by necessity. Confine it to deck ids that could name a
// real file so no request can walk out of decks/.
const DECK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const fail = (status: number, message: string) =>
  new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ deck: string; file: string }> },
) {
  const { deck: deckId, file } = await params;

  if (!DECK_ID.test(deckId)) return fail(400, 'bad deck id');

  const match = /^(\d+)\.(png|webp|jpe?g)$/.exec(file);
  if (!match) return fail(400, 'expected <n>.png, <n>.webp or <n>.jpg, one-based');
  const index = Number(match[1]) - 1;
  const ext = match[2] === 'jpg' ? 'jpeg' : match[2];
  if (!isFormat(ext)) return fail(400, `unsupported format ${ext}`);

  const loaded = await loadDeck(deckId);
  if (!('deck' in loaded)) return fail(404, loaded.error);

  const { deck } = loaded;
  if (index < 0 || index >= deck.tiles.length) {
    return fail(404, `tile ${index + 1} of ${deck.tiles.length}`);
  }

  const { bytes, mime, layout } = await renderTile(deck.tiles[index], ext);

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': mime,
      // The iteration is the deck's own version counter, so it is the honest
      // validator: bump the deck, and every tile URL is a new entity.
      etag: `"${deck.id}-${index + 1}-v${deck.iteration}-${ext}"`,
      'cache-control': 'public, max-age=0, must-revalidate',
      // Handy when eyeballing a tile straight from the URL.
      'x-tile-scale': layout.scale.toFixed(4),
      'x-tile-overlong': String(layout.overLong),
    },
  });
}
