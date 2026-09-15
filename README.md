# Notice Content Studio

Renders paper-note slideshow decks to 1080x1080 tiles and exports them as PNGs.

```
npm install
npm run dev      # http://localhost:3210
npm run check    # typecheck + layout grammar assertions
```

## The loop

1. An agent writes `decks/<id>.json` (see `agents/deck-json-author.md`).
2. Reload the browser. Decks are read off disk on every request, so there is no build step.
3. Flip through the tiles, then **Download all** to save the PNGs, or **Send to TikTok** to
   post the deck as a photo carousel (see `docs/tiktok.md`).

## Layout

| File | Owns |
|---|---|
| `docs/deck-schema.md` | the schema, field by field, and the fixed geometry |
| `docs/tiktok.md` | the TikTok setup, and why a tile needs a public URL |
| `docs/source-decks.md` | which published decks are in scope, and why the rest are not |
| `agents/deck-json-author.md` | how to author a deck: tile patterns, copy rules, checklist |
| `lib/types.ts` | the TypeScript mirror of the schema |
| `lib/render.ts` | the layout grammar and the canvas painter |
| `lib/decks.ts` | filesystem loading and validation |
| `lib/tile-image.ts` | the same paint, server-side, for the tile route |
| `lib/tiktok.ts` | OAuth, the session cookie, and the photo post |
| `scripts/check-layout.mjs` | headless assertions on the grammar |
| `scripts/check-fonts.mjs` | the face loads and measures as designed |

Tiles are drawn on a `<canvas>`, not in the DOM. The schema is entirely pixel geometry (80px inset,
bottom anchor at y=904, a binary-searched fit pass down to 0.8), and `measureText` gives that
exactly. Export is `canvas.toBlob()` with no dependencies.

The face is Liberation Serif, committed under `public/fonts` and registered under one private family
name in both runtimes: `@font-face` for the browser, `GlobalFonts` for the tile route. It is
metric-compatible with Times New Roman, so every wrap point and every fit scale is unchanged from
the tiles this was designed against — `npm run check` asserts that against all 574 strings the decks
actually use, and the delta is 0.0000px. Times New Roman itself could not be committed, and does not
exist on a Linux server, which is the whole reason for the swap.

## Validation

A deck that does not parse shows its error on the card in the library and on its own page, naming
the tile and block. v1 files are rejected with a migration hint rather than rendered wrong.
