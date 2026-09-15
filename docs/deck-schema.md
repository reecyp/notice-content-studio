# Deck JSON schema (v2) — paper-note format

One file = one slideshow. The agent authors this file directly. The site reads it and renders
1080x1080 paper tiles. No prose-to-JSON conversion step exists, so there is nothing to parse
wrong.

**The split:** code owns the grammar (geometry, spacing, measured fit, anchoring). The JSON owns
the sentence (which blocks, in what order, what words, optional taste overrides).

**What changed in v2.1.** The single blank-line gap split into three constants: `SPACING.title`,
`SPACING.titleHug` and `SPACING.block`. A title now always carries a margin below it, so `hug` on
the first body block means tight rather than flush. See "Block gaps" below. No JSON changes.

**What changed from v1.** v1 gave each point a single `body` object of one kind. The published
decks do not work that way: a tile stacks several blocks, blank-line separated, mixing wrapped
paragraphs, tight stanzas and bullet lists freely. v2 makes `body` an ordered array of blocks. The
`bullets` kind loses its nested `lead` and `closing`, because those are just neighbouring blocks.
Line height for `lines` is corrected from 1.0 to 1.32, and titles gain an optional bold second
line. Derived by measuring the published tiles in `Notice-media/reel-slideshows/`.

---

## 1. File shape

```json
{
  "schemaVersion": 2,
  "id": "solo-missions",
  "iteration": 1,
  "format": "paper-note",
  "post": {
    "description": "Five things nobody tells you about doing it alone.",
    "hashtags": ["stoicism", "discipline", "selfimprovement"]
  },
  "tiles": [ /* see section 3 */ ]
}
```

| Field | Required | Notes |
|---|---|---|
| `schemaVersion` | yes | `2`. Lets the site refuse a file it does not understand. |
| `id` | yes | kebab-case, matches the filename. Drives export filenames and the library list. |
| `iteration` | yes | Integer, starts at `1`. Bump on every remake so a redo's downloads never overwrite the previous cut. Filename: `<id>-<NN>-v<iteration>.png`. |
| `format` | yes | `"paper-note"`. Only value for now; present so a second format is additive. |
| `post.description` | no | TikTok caption. Plain text, no hashtags inside it. |
| `post.hashtags` | no | Array of tags **without** the `#`. The site renders and copies them with `#`. |
| `tiles` | yes | 1–35 tiles (TikTok's photo cap). In practice 4–10. |

The site shows `post.description` and `post.hashtags` beside the deck with a copy button, and
they are the fields the future TikTok call reads. They are never drawn on a tile.

---

## 2. Fixed geometry (code owns this, JSON never sets it)

One typeset. The wide measure used by `nobody-dares`, `solo-missions` and `80/20` is the house
look; `reinvent-paper`'s larger type and narrow measure was a one-off and is not supported.

- Canvas **1080 x 1080**, textured paper background.
- Ink `#111111`, Times New Roman throughout.
- Text inset **80px** left and right → text width **920**.
- Text block is **anchored bottom-left**, not centred. The stack's bottom edge lands at
  **y = 904** (176px above the tile bottom).
- Usable band: y 80 → 904 = **824px of stack**.
- Bullets indent further: disc marker at x = **110**, item text at x = **150**, wrapping at width
  **850** so the right edge still lands on the 80px inset.

### Type scale

| Part | Size | Weight | Line height |
|---|---|---|---|
| Hook | 50 | `**spans**` bold, rest plain | 1.15 |
| Point number + title | 42 | bold | 1.2 |
| Title sub line | 42 | bold | 1.2, tight under the title |
| Body — `paragraph` and `lead` | 42 | normal | 1.32 |
| Body — `lines` | 42 | normal | 1.32 |
| Bullets | 42 | normal | 1.8 |

`lines` shares the paragraph line height on purpose. Its whole job is *not wrapping*, so its lines
sit at the same rhythm as wrapped prose and read as one packed stanza.

### Block gaps

Two constants, both measured in body lines (one body line = 42 x 1.32 = 55.44px), and both scaled
by the fit pass along with everything else. They live in `SPACING` in `lib/render.ts`.

| Constant | Multiple | Blank space | Applies to |
|---|---|---|---|
| `SPACING.title` | 1.4 | 77.6px | under a title when the body below does not hug |
| `SPACING.titleHug` | 0.45 | 24.9px | under a title when the body below hugs |
| `SPACING.block` | 0.75 | 41.6px | between any two body blocks |

**A title always gets a margin.** `"hug": true` on the first body block means *tight*, not *flush*,
so a hugged title keeps 24.9px under it. Only a `titleSub` sits genuinely flush against its title.
Between two body blocks, `hug` is still a true zero.

These are fixed. Nothing in the site adjusts them, because a deck must render identically whether a
person opened it or an automation did.

The gap between two lines is that blank space **plus the line advance of the block above**, which is
where the observed variation comes from:

| Between | Advance above | Blank | Baseline to baseline |
|---|---|---|---|
| title → hugged first body block | 50.4 | 24.9 | **75.3** |
| title → gapped first body block | 50.4 | 77.6 | **128.0** |
| paragraph → paragraph | 55.4 | 41.6 | **97.0** |
| `lines` stanza → paragraph | 55.4 | 41.6 | **97.0** |
| lead → bullets | 55.4 | 41.6 | **97.0** |
| last bullet → closing paragraph | 75.6 | 41.6 | **117.2** |

Note what this does and does not vary by. The blank space depends only on whether a title sits
above; it does **not** vary by the kind of block on either side. A `lines` block followed by a
paragraph gets exactly the same gap as two paragraphs. Bullets end up further from what follows them
only because bullets are set at line height 1.8, so the advance above the gap is larger.

A `titleSub` always sits flush under its title regardless of anything else.

### The hook is the one exception

The hook tile sits lower than the others: line 1 at y = **765**, line 2 at **822**. It is not
bottom-anchored to 904 like the rest; it is its own fixed placement, because it is the reference
tile the whole look is built around.

### Measured fit

Every tile is measured after layout. If the stack exceeds 824px, the renderer binary-searches a
scale factor down to a floor of **0.8** (so 42 bottoms out at ~34) until it fits. Below the floor
it still renders but flags the tile in the viewer as **over-long**, so you see it before you post
rather than after.

This means **copy length can never break a tile**. Authors are still told to split rather than lean
on the fit pass, because a shrunk tile reads as smaller than its neighbours.

---

## 3. Tile roles

Four roles. Every tile object has a `role` and, optionally, a `layout` override.

### 3.1 `hook` — tile 1

```json
{ "role": "hook", "lines": ["How to become the person", "**nobody dares to mess with:**"] }
```

| Field | Required | Notes |
|---|---|---|
| `lines` | yes | One or two strings, one per rendered line. `**...**` marks a bold span. |

Bold is a span, not a line. All three placements occur in the published decks: bold on line 2
(`nobody-dares`), bold opening the sentence and running into plain text (`solo-missions`), bold on
line 1 with a plain parenthetical on line 2 (`80/20`).

v1's `lead` / `punch` pair is gone. It could not express a mid-sentence bold span such as
`How to **reinvent** yourself`.

### 3.2 `point` — the numbered body tiles

Carries one to three numbered points. One point per tile is the default; two or three is for a
deck mirroring a source post's slide grouping.

```json
{
  "role": "point",
  "points": [
    {
      "number": 1,
      "title": "Morning routine",
      "titleSub": "(first 60 minutes = entire day)",
      "body": [
        { "kind": "lead", "text": "Here's what helps:" },
        { "kind": "bullets", "items": ["Wake up at 5:30 AM", "Drink water immediately"] },
        { "kind": "paragraph", "text": "Master your morning or it masters you." }
      ]
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `number` | no | Integer. Omit it and the tile renders the title with no number. |
| `title` | no | Bold. Omit for a body-only tile. |
| `titleSub` | no | A second bold line, tight under the title. Usually a parenthetical. Requires `title`. |
| `body` | yes | Ordered array of 1–8 blocks — see section 4. |

Points within one tile are separated by one blank line, same as blocks.

### 3.3 `closer` — the prose ending

Unnumbered. Same band and anchor as a point tile.

```json
{
  "role": "closer",
  "title": "None of this is complicated",
  "body": [{ "kind": "paragraph", "text": "It is just unglamorous." }]
}
```

`title` and `titleSub` are optional. If the closer is meant to read as the final numbered point
instead, use a `point` tile with the next number — that is a copy decision, not a schema one.

### 3.4 `endcard` — the CTA / sign-off, opt-in

```json
{
  "role": "endcard",
  "headline": "Notice",
  "body": "Write one line a day. Out loud.",
  "handle": "@notice_app"
}
```

All three fields optional. `handle` renders smaller, at the bottom of the stack.

**No published deck uses this.** The house pattern is to end on the last numbered point with the
Notice plug as its final `paragraph` block. Use `endcard` only when asked for explicitly.

---

## 4. Body blocks

`body` is an ordered array. Four kinds. Each carries an optional `"hug": true`.

### 4.1 `paragraph`

A sentence or two that wraps at the measure. Also the correct kind for a **single line that stands
alone with blank lines around it** — spaced-out lines are consecutive paragraphs, not a `lines`
block.

```json
{ "kind": "paragraph", "text": "The work does not feel like work while you are doing it." }
```

### 4.2 `lead`

A setup line, almost always ending in a colon, introducing the block below it. Renders identically
to `paragraph`; the distinct kind exists so the renderer can keep the pair tight and so authors
stop nesting it inside `bullets`.

```json
{ "kind": "lead", "hug": true, "text": "Stop doing these 4 things:" }
```

### 4.3 `lines`

A **tight** stanza: 2–4 short lines with no blank line between them, each on its own rendered line,
none expected to wrap. Line height 1.32, same as prose.

```json
{
  "kind": "lines",
  "lines": [
    "Toxic workplace? You quit.",
    "Shitty relationship? You leave.",
    "Friends who disrespect you? Gone."
  ]
}
```

Use it for parallel constructions. If the lines are not parallel, or if they want air between them,
they are separate `paragraph` blocks.

### 4.4 `bullets`

A disc list. 2–6 items, fragments rather than sentences, no terminal full stops.

```json
{
  "kind": "bullets",
  "items": [
    "One mentor who's ahead",
    "Two peers at your level for motivation",
    "Two individuals you're helping"
  ]
}
```

v1's `lead` and `closing` sub-fields are gone. The sentence above a list is a `lead` block and the
paragraph below it is a `paragraph` block, both siblings in the same `body` array.

---

## 5. Optional layout overrides

Taste knobs on top of the guardrails. Every one is optional and every tile is still measured
afterwards, so an override can change how a tile looks but cannot make it overflow.

```json
"layout": {
  "scale": 0.92,
  "lineHeight": 1.15,
  "bottom": 904,
  "emphasis": "title"
}
```

| Key | Effect |
|---|---|
| `scale` | Multiplies every size on the tile. Clamped to 0.7–1.15. The fit pass can shrink further but never grows past this. |
| `lineHeight` | Overrides the body's line height for this tile only. |
| `bottom` | Moves the anchor baseline off 904 for this tile only. |
| `emphasis` | `"title"` (default), `"body"`, or `"none"` — which part carries the bold. |

---

## 6. Copy rules that live outside this file

The schema does not enforce these; they are still on the author. `agents/deck-json-author.md`
carries the full version.

- No dashes in reader-facing copy. Use "and", or split the sentence.
- Never assert what the reader has already done. Describe the mechanism, not their record.
- Tile 1 is a plain tip-list promise, not a provocative reels-style hook.
- Bodies on tiles 1–3 run long (45–55 words) and name what literally happens, never abstractions.
- When a deck comes from a scraped source post, lift its slide text verbatim.
- Hug consistently: pick hugged or gapped for a deck and hold it across every tile.
- Plug Notice in the imperative, from authority. Never "the app I built".

---

## 7. Rendering

`lib/render.ts` is the implementation of everything in section 2, and is the tiebreaker if this
document and the code disagree. `scripts/check-layout.mjs` asserts the rules above against a stubbed
text measurer, so a change to the grammar shows up as a failing check rather than as a deck that
looks subtly wrong. Run both with `npm run check`.

---

## 8. Full example

```json
{
  "schemaVersion": 2,
  "id": "nobody-dares-mess-with",
  "iteration": 1,
  "format": "paper-note",
  "post": {
    "description": "How to become the person nobody dares to mess with.",
    "hashtags": ["stoicism", "discipline", "selfimprovement", "mindset"]
  },
  "tiles": [
    { "role": "hook", "lines": ["How to become the person", "**nobody dares to mess with:**"] },
    {
      "role": "point",
      "points": [{
        "number": 1,
        "title": "Stop Explaining Yourself",
        "body": [
          { "kind": "paragraph", "hug": true, "text": "“I can't make it.”" },
          { "kind": "paragraph", "text": "That's it. That's the whole sentence." },
          { "kind": "paragraph", "text": "You don't owe anyone an explanation on why you're unavailable. The second you start over justifying your decisions, you're basically handing people the rope to argue with you." },
          { "kind": "paragraph", "text": "Confident people say what they mean and keep it moving." }
        ]
      }]
    },
    {
      "role": "point",
      "points": [{
        "number": 3,
        "title": "Guard Your Privacy",
        "body": [
          { "kind": "lead", "hug": true, "text": "Stop doing these 4 things:" },
          { "kind": "bullets", "items": [
            "Announcing your plans to everyone",
            "Oversharing your struggles with randoms",
            "Broadcasting your every move online",
            "Telling people more than they need to know"
          ]},
          { "kind": "paragraph", "text": "The more people know about what you're building, the more they can sabotage it. Move in silence. Let your results make the noise." }
        ]
      }]
    },
    {
      "role": "point",
      "points": [{
        "number": 4,
        "title": "Build Undeniable Results",
        "body": [
          { "kind": "lines", "lines": [
            "Toxic workplace? You quit.",
            "Shitty relationship? You leave.",
            "Friends who disrespect you? Gone."
          ]},
          { "kind": "paragraph", "text": "Once people see you're not bluffing, they either change or they're gone." },
          { "kind": "paragraph", "text": "Cutting is the easy half. What you build after is slow and easy to miss. Use the Notice app to voice journal and track your growth." }
        ]
      }]
    }
  ]
}
```
