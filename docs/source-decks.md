# Source decks: what is in scope and what is not

An audit of `~/Desktop/Notice-media/reel-slideshows/`, done as a quality-control pass on the v2
schema. Recorded so the same ground does not get re-covered.

## In scope: the standard typeset

Wide 920px measure, body at 42/1.32, bullets at 1.8. These are what `lib/render.ts` implements.

| Deck | Tiles | Ported to `decks/` |
|---|---|---|
| `nobody-dares-mess-with` | 5 | yes |
| `solo-missions` | 9 | yes |
| `80:20-rule` | 6 | yes, as `80-20-rule.json` |

All three are ported. There are no standard-typeset decks left unported.

## Out of scope: the large typeset

Narrow measure (text wraps around 600px rather than 920), noticeably larger type, bullets set tight
at roughly 1.2 rather than 1.8. Eight decks use it:

`5-golden-rules`, `achieve-more`, `attract-what-you-want`, `becoming-a-diciplined-person`,
`paper-stay-the-same`, `paper-waste-your-20s`, `rebuild-life`, `reinvent-paper`

**Decision: not supported.** The site renders one typeset. These decks are not ported, because
porting them without the typeset would produce JSON whose copy is right and whose look is wrong,
which is worse than not having them.

Worth knowing if this is revisited: the two looks were in concurrent use, not sequential. File dates
run from 28 July to 7 August with both typesets appearing throughout, so this is not an old style
that got replaced. Supporting it would mean a deck-level `typeset` field plus a second entry in
`TYPE` and a second measure constant.

## Out of scope: continuous numbered lists

`golden-rules` (6 tiles) is a different format again: 50 numbered items running continuously across
five tiles, no titles, no bullets, hanging indents where the wrapped line aligns under the item text
rather than the number, and a stack that fills the whole band instead of sitting bottom-anchored.

Nothing in schema v2 expresses this. It would need a `list` tile role, deck-level numbering that
carries across tiles, and a fill anchor. Deliberately deferred rather than bolted on.

## Not carousels at all

Six folders are 1080x1920 rather than square, so they are vertical reel frames, not paper tiles:
`4-habits-killing-dicipline`, `falling-behind-but-niche`, `mental-health-men-not-soft`,
`morning-journaling-3-tips`, `unspoken-rules-for-men`, `waste-your-20s`.
