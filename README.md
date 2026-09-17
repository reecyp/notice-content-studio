# Notice Content Studio

Renders paper-note slideshow decks to 1080x1080 tiles and exports them as PNGs.

```
npm install
npm run dev      # http://localhost:3210
npm run check    # typecheck + uid + fonts + layout grammar + ledger + queue assertions
npm run uid      # stamp a uid on any deck missing one
npm run db:init  # apply the ledger schema to DATABASE_URL (optional)
```

## The loop

1. An agent writes `decks/<id>.json` (see `agents/deck-json-author.md`), uid and all.
2. Reload the browser. Decks are read off disk on every request, so there is no build step.
3. Flip through the tiles, then **Download all** to save the PNGs, or **Send to TikTok** to
   post the deck as a photo carousel (see `docs/tiktok.md`).
4. With a `DATABASE_URL` set, the send is logged and the library shows which decks have gone out
   and which have not (see `docs/database.md`). Without one, nothing changes.
5. Or let a schedule do step 3: `POST /api/queue/send` sends the next N unsent decks, oldest
   `createdAt` first, on a shared key rather than a browser session (see `docs/queue-api.md`).

## Layout

| File | Owns |
|---|---|
| `docs/deck-schema.md` | the schema, field by field, and the fixed geometry |
| `docs/tiktok.md` | the TikTok setup, and why a tile needs a public URL |
| `docs/database.md` | the send ledger: what it stores, why uid, and why the queue reads made_at |
| `docs/queue-api.md` | the batch endpoint an agent calls: auth, ordering, pacing, every response code |
| `docs/source-decks.md` | which published decks are in scope, and why the rest are not |
| `agents/deck-json-author.md` | how to author a deck: tile patterns, copy rules, checklist |
| `lib/types.ts` | the TypeScript mirror of the schema |
| `lib/render.ts` | the layout grammar and the canvas painter |
| `lib/decks.ts` | filesystem loading and validation |
| `lib/tile-image.ts` | the same paint, server-side, for the tile route |
| `lib/tiktok.ts` | OAuth, the session cookie, and the photo post |
| `lib/publish.ts` | sending one deck, shared by the button and the batch endpoint |
| `lib/db.ts` | the send ledger, and a no-op when there is no `DATABASE_URL` |
| `scripts/schema.sql` | the three tables: `video`, `send` and `tiktok_session` |
| `scripts/check-layout.mjs` | headless assertions on the grammar |
| `scripts/check-fonts.mjs` | the face loads and measures as designed |
| `scripts/check-ledger.mjs` | the ledger SQL, run against a real Postgres in process |
| `scripts/check-queue.mjs` | the batch endpoint's rules, run against that Postgres and a fake TikTok |

Tiles are drawn on a `<canvas>`, not in the DOM. The schema is entirely pixel geometry (80px inset,
bottom anchor at y=904, a binary-searched fit pass down to 0.8), and `measureText` gives that
exactly. Export is `canvas.toBlob()` with no dependencies.

The face is Liberation Serif, committed under `public/fonts` and registered under one private family
name in both runtimes: `@font-face` for the browser, `GlobalFonts` for the tile route. It is
metric-compatible with Times New Roman, so every wrap point and every fit scale is unchanged from
the tiles this was designed against — `npm run check` asserts that against all 574 strings the decks
actually use, and the delta is 0.0000px. Times New Roman itself could not be committed, and does not
exist on a Linux server, which is the whole reason for the swap.

## State

Decks live on disk in git: they are authored intent, and they diff. The database holds only what
disk cannot know — that a video went to TikTok, when, and what came back, plus the one session row
that lets something other than a browser post. It is optional, and the studio runs unchanged
without it. `docs/database.md` covers the split and the three tables.

The one place that boundary bends is queue order, and deliberately. `createdAt` is authored in the
deck file rather than taken from the row's own `created_at`, because a row only knows when the
database first heard of the deck: re-init it and every deck syncs in the same instant. The date in
git survives that.

## Validation

A deck that does not parse shows its error on the card in the library and on its own page, naming
the tile and block. v1 files are rejected with a migration hint rather than rendered wrong, and a
deck with no `uid` names `npm run uid` as the fix.
