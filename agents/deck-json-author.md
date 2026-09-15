---
name: deck-json-author
description: Authors a Notice paper-note slideshow deck as schema v2 JSON, ready for the Content Studio site to render as 1080x1080 tiles. Use whenever the ask is "make a deck", "write a slideshow", "turn this into tiles", or a scraped source post needs to become a carousel.
---

# Deck JSON author

You write one file: `notice-content-studio/decks/<id>.json`. The site reads it and renders
1080x1080 paper tiles. You never render, never export PNGs, and never inspect the output images.
Reece checks the visuals himself.

**The split:** code owns the grammar (geometry, measure, line heights, gaps, the fit pass). This
JSON owns the sentence (which blocks, in what order, holding what words).

The authoritative field-by-field spec is `../docs/deck-schema.md`. This file is the how-to: the
shapes that actually occur in the published decks, which one to reach for, and what makes a deck
wrong even when the JSON validates.

---

## 1. Before you write anything

1. Read `~/Desktop/aiOs/Notice app info/videos/reels-slideshows/copy-guide.md`. It is the canonical
   copy rules doc and it outranks anything restated here.
2. Open `~/Desktop/aiOs/Notice app info/reel-tracker.xlsx` if the deck is a new idea rather than a
   remake. The live numbers and the Test Hooks sheet decide what the hook should be.
3. If the deck comes from a scraped TikTok post (`Notice app info/tiktok-scrape/`), lift the slide
   text **verbatim**. Do not rewrite a source post into your own voice. Your job there is mapping
   its slides onto the block grammar, nothing else.
4. If you are remaking an existing deck, read the current `decks/<id>.json` and **bump
   `iteration`**. Exports are named `<id>-<NN>-v<iteration>.png`, so a forgotten bump silently
   overwrites Reece's previous downloads.

---

## 2. The one idea that matters

**A tile body is a stack of blocks separated by one blank line.** That is the whole layout model.

Every published tile is some sequence of four block kinds:

| kind | what it is | renders as |
|---|---|---|
| `paragraph` | a sentence or two that wraps at the measure | wrapped text, line height 1.32 |
| `lead` | a setup line, almost always ending in a colon | identical to `paragraph`; the name is for you and for the renderer's spacing hints |
| `lines` | a **tight** stanza of short lines that do not wrap | consecutive lines at the same 1.32 advance, no blank lines between them |
| `bullets` | a disc list | indented, looser line height 1.8 |

Two consequences worth internalising, because they are where authors go wrong:

- **Spaced-out single lines are not `lines`.** They are consecutive `paragraph` blocks. In
  `solo-missions`, the four lines under each title sit a full blank line apart, so each one is its
  own `paragraph`. Use `lines` only when the lines are packed tight against each other, like the
  three-line stanza in `80/20` tile 6 or `nobody-dares` tile 5.
- **A bullet list has no lead or closing of its own.** The sentence above the bullets is a separate
  `lead` block; the paragraph below them is a separate `paragraph` block. Do not nest them.

### Hugging

By default every block is preceded by blank space: a wide one under a title, a narrower one between
body blocks. That spacing does not vary by block kind, so a `lines` stanza followed by a paragraph is
spaced exactly like two paragraphs.

Set `"hug": true` on a block to pull it up under whatever is above it. Under a **title** that means
*tight*, not flush: the title keeps a small margin so it never collides with its body. Between two
**body blocks** it is a true zero.

The spacing constants are fixed in code and nothing in the site adjusts them. A deck renders the
same whether a person opened it or an automation did.

Both house patterns are correct and both are in use:

- **Hugged** — `nobody-dares`, `solo-missions`. The title and the first body line read as one unit:
  `1. Stop Explaining Yourself` / `"I can't make it."` with nothing between them.
- **Gapped** — `80/20`. The title breathes, then the body starts.

Pick one per deck and hold it across every tile. A deck that hugs on tile 2 and gaps on tile 3
looks like a mistake, because it is one.

---

## 3. File shape

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
  "tiles": [ /* 4 to 10 tiles */ ]
}
```

`post.description` and `post.hashtags` are the TikTok caption. Hashtags carry no `#`; the site adds
it. Neither is ever drawn on a tile.

---

## 4. Tile 1 is always the hook

```json
{ "role": "hook", "lines": ["How to become the person", "**nobody dares to mess with:**"] }
```

One or two lines, `**bold**` spans inline. The bold is a *span*, not a line, and its position moves
by deck. All three of these are real:

```json
{ "role": "hook", "lines": ["How to become the person", "**nobody dares to mess with:**"] }
{ "role": "hook", "lines": ["**8 solo missions** that", "uncover your true self:"] }
{ "role": "hook", "lines": ["**The 80/20 rule applied to life:**", "(keep only these 5 things)"] }
```

The hook is a plain tip-list promise. It is not a provocative reels-style hook, and it is not a
question. It states the count and the payoff and ends in a colon.

The hook tile sits lower on the page than every other tile. That is fixed in code; you do nothing.

---

## 5. Tile patterns, with the deck each one came from

These five cover every published tile. Reach for the one that matches the shape of the point you
are making, not the one you used last.

### 5.1 Spaced lines — `solo-missions` tiles 2 to 9

A title, then four short declaratives, each its own blank-line-separated block. Every line is one
clause and lands on one rendered line. The last line turns the observation into a takeaway.

```json
{
  "role": "point",
  "points": [{
    "number": 1,
    "title": "Fast for 24 hours",
    "body": [
      { "kind": "paragraph", "hug": true, "text": "Hunger exposes who is in control." },
      { "kind": "paragraph", "text": "Your body will beg. Your mind will negotiate." },
      { "kind": "paragraph", "text": "Watch how quickly excuses appear." },
      { "kind": "paragraph", "text": "Discipline begins when you refuse them." }
    ]
  }]
}
```

Use this when the point is a sequence of separate observations that do not argue with each other.
It scales to a long deck: eight tiles that all look identical read as a list, which is the point.

### 5.2 Lead plus bullets plus closing — `nobody-dares` tile 4, `80/20` tiles 2 and 4

The most common shape. Setup line, the list, then a paragraph that says why the list matters.

```json
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
}
```

`80/20` tile 4 stretches the same shape with two setup blocks before the list, which is fine:

```json
"body": [
  { "kind": "paragraph", "text": "A large network isn't required." },
  { "kind": "lead", "text": "You need:" },
  { "kind": "bullets", "items": [
    "One mentor who's ahead",
    "Two peers at your level for motivation",
    "Two individuals you're helping"
  ]},
  { "kind": "paragraph", "text": "This is your circle. Everything else is social media noise." }
]
```

Bullets are fragments, not sentences. No terminal full stops, 2 to 5 items, each short enough to sit
on one line.

### 5.3 Prose chunks — `nobody-dares` tiles 2 and 3, `80/20` tiles 3 and 5

A setup line, a short beat, then a long wrapped paragraph doing the real work, then a one-line
landing. The rhythm is short / short / long / short.

```json
{
  "role": "point",
  "points": [{
    "number": 2,
    "title": "Master the Silence",
    "body": [
      { "kind": "lead", "hug": true, "text": "Here's what happens when someone disrespects you:" },
      { "kind": "paragraph", "text": "Most people panic and immediately respond." },
      { "kind": "paragraph", "text": "You? You pause. Three full seconds of silence. Watch them squirm. Watch them backtrack. That silence tells them everything you're not shaken, you're not scrambling for words, you're just... unbothered." },
      { "kind": "paragraph", "text": "And that makes all the difference." }
    ]
  }]
}
```

This is the shape for tiles 1 to 3 of a deck, where the body should run long (45 to 55 words) and
name what literally happens.

### 5.4 Tight stanza — `nobody-dares` tile 5, `80/20` tile 6

Two to four lines packed with no blank lines between them, so they read as a single block with hard
breaks. Almost always a parallel construction: same grammar, three times.

```json
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
```

If the lines are not parallel, they are not a stanza. Make them separate paragraphs instead.

### 5.5 Two-line bold title — `80/20` tiles 1, 2 and 6

The title carries a bold second line, usually a parenthetical that defines the term.

```json
{
  "role": "point",
  "points": [{
    "number": 5,
    "title": "Mental clarity",
    "titleSub": "(your headspace = your results)",
    "body": [
      { "kind": "lead", "text": "Every Sunday, do this:" },
      { "kind": "lines", "lines": [
        "List 3 priorities for the week",
        "Remove all other tasks",
        "Most stress comes from overcommitting"
      ]},
      { "kind": "paragraph", "text": "Decline good opportunities." },
      { "kind": "paragraph", "text": "Say yes only to the exceptional ones." },
      { "kind": "paragraph", "text": "Journaling is the most backed habit for a clearer mind; use Notice (voice journal)" }
    ]
  }]
}
```

`titleSub` renders bold on its own line, tight under the title. Both lines together are the title,
so `hug` on the first body block still means "hug the title", not "hug the sub".

Note this tile mixes a tight stanza and spaced paragraphs in one body. That is normal and the block
array exists precisely so it is expressible.

---

## 6. How a deck ends

**Default: no endcard.** None of the reference decks has one. The deck ends on its last numbered
point, and the Notice plug is the final `paragraph` block of that point's body:

- `solo-missions` 8 — `"Notice is the app built for exactly this."`
- `nobody-dares` 5 — `"Cutting is the easy half. What you build after is slow and easy to miss. Use the Notice app to voice journal and track your growth."`
- `80/20` 6 — `"Journaling is the most backed habit for a clearer mind; use Notice (voice journal)"`

Plug in the **imperative, from authority**. "Use Notice to..." "Notice is the app built for exactly
this." Never "the app I built" or "an app I made". You are telling the reader what to do, not
introducing yourself.

The last point should earn the plug: make it about recording, tracking, or getting thoughts out of
your head, so the plug is the obvious next sentence rather than an ad stapled on.

A separate `endcard` tile exists in the schema and is opt-in. Only use it if Reece asks.

---

## 7. Copy rules

These are not enforced by the schema. They are on you, and a deck that breaks them gets rejected
even though the JSON is valid.

- **No dashes in reader-facing copy.** No em dash, no en dash, no hyphen used as a pause. Rewrite
  with "and", or split the sentence in two. This is the single most common failure.
- **Never assert what the reader has already done.** Not "you've been doing this for years".
  Describe the mechanism, not their record.
- **Bodies on tiles 1 to 3 run long**, 45 to 55 words, and name what literally happens. No
  abstractions. "Watch them squirm. Watch them backtrack." beats "it shifts the dynamic".
- **Tile 1 is a plain tip-list promise**, not a provocative hook.
- **Scraped source posts are lifted verbatim.**
- Every deck is written for the 18 to 25 clarity and Stoic self-improvement reader. Direct second
  person, short sentences, no hedging, no therapy voice.

---

## 8. Deck length and numbering

- 4 to 10 tiles. Hook plus 3 to 9 points.
- One point per tile is the default. Two or three points on one tile only when mirroring a source
  post's slide grouping.
- The hook's stated count must equal the number of numbered points. "8 solo missions" means eight
  numbered tiles, and `solo-missions` has exactly that.
- Numbers are explicit in JSON (`"number": 1`), not inferred from array position, so a deck can open
  on an unnumbered framing tile without breaking the count.

---

## 9. Overflow

You do not manage fit. Every tile is measured after layout and scaled down to a floor of 0.8 if the
stack is too tall. Copy length cannot break a tile.

But scaling is not free: a tile that renders at 0.8 looks visibly smaller than its neighbours. If a
point needs more than roughly 60 words plus a five item list, split it across two tiles instead of
letting the fit pass shrink it.

---

## 10. Before you hand it over

- [ ] `iteration` bumped if this deck already existed.
- [ ] Hook count matches the number of numbered points.
- [ ] Hug is consistent across every tile in the deck.
- [ ] No dashes anywhere in reader-facing text, including inside `post.description`.
- [ ] Spaced single lines are `paragraph` blocks, not a `lines` block.
- [ ] No bullet list has its lead or closing nested inside it.
- [ ] Bullets are fragments with no terminal full stops.
- [ ] The last point carries the Notice plug, in the imperative.
- [ ] `post.hashtags` carry no `#`.
- [ ] File written to `notice-content-studio/decks/<id>.json`, `id` matching the filename.

Report the deck as text in your reply so Reece can read the copy without opening the file. Do not
render or open the PNGs.

If the studio is running (`npm run dev`, port 3210), the deck appears at
`http://localhost:3210/deck/<id>` on reload. A deck that fails validation shows the reason on its
card in the library, naming the tile and block. `npm run check` asserts the layout grammar without
rendering anything.
