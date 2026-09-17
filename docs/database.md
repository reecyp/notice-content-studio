# The send ledger

The studio has two kinds of state and they live in two different places.

**Authored intent** is `decks/*.json`, on disk, in git. It diffs, it reviews, an agent writes it,
and every request reads it fresh. Nothing about that changes.

**What happened in the outside world** is this database: which video went to TikTok, when, and what
TikTok said afterwards. No file on disk can know that, which is the whole reason it exists. It
holds no copy, no tiles and no deck content.

It is optional. With no `DATABASE_URL` every call in `lib/db.ts` is a no-op, the send-state pills
do not render, and the studio behaves exactly as it did before the database existed. Local
rendering, `npm run dev` and `npm run check` never need a connection.

## Setup

1. Create a Postgres database at [neon.com](https://neon.com). The free tier is ample: this stores
   one row per video and one per send.
2. Put the pooled connection string in `.env.local` as `DATABASE_URL`.
3. `npm run db:init` — applies `scripts/schema.sql`. Safe to run again; every statement is `if not
   exists`.
4. On Vercel, add the same `DATABASE_URL` to the project's environment variables.

The driver is `@neondatabase/serverless`, which talks to Neon over HTTP rather than a Postgres
socket. That matters on Vercel: a serverless function gets no connection pool to hold, and an HTTP
query needs no warm-up.

## The three tables

`video` — one row per deck, keyed by the `uid` stamped in its JSON.

The column that earns the table is `sent_at`. Null means never successfully sent, which makes the
queue a `where sent_at is null` and nothing more. Rows are never deleted: a deck file can be
removed long after it was posted and the record of that post should outlive it.

`made_at` is the deck's own `createdAt`, mirrored in by `syncVideos`, and it is what the queue
orders by. It is not `created_at`: that column records when this database first heard of the deck,
which is a different fact and a fragile one. Drop the database and re-init it and every row syncs
in the same instant, so `created_at` orders nothing while `made_at` comes back intact from the JSON
in git. The tie between two decks made the same day breaks on `deck_id`, so the same batch call
does not send a different pair each time it runs.

`send` — one row per attempt. Publish id, status, the caption as it was at the time, and the error
if there was one. `video` answers "has this gone out", `send` answers "what happened, and when, and
how many times".

The caption and tile count are snapshotted onto the send row on purpose. The deck on disk can be
rewritten after a post, so the only honest record of what was actually sent is the one taken at the
moment of sending.

`tiktok_session` — one row, always `id = 1`: the connected TikTok account.

This is the table that makes a batch send possible at all. The cookie is still the studio's access
model for a person clicking Send, and nothing about that changed; this row is the same session
written down a second time, for the one caller that arrives with no cookie. What it stores is the
sealed blob, not the tokens: `seal()` in `lib/tiktok.ts` encrypts with AES-GCM keyed on the client
secret, so `lib/db.ts` never sees an access token and a dump of this database is inert without the
server's environment. `/api/tiktok/callback` writes it when you connect, and both publish paths
rewrite it whenever TikTok rotates the refresh token.

## Why uid and not id

`id` is the filename and `iteration` is the version. Both are meant to change: a deck gets renamed,
a deck gets remade. `uid` is stamped once by `npm run uid` and never edited, so the send history
survives both. It is the only field in a deck file that the renderer never reads.

## The two rules worth knowing

**`sent_at` is the first send, not the latest.** A deliberate second send lands in the log without
moving the date, so "when did this go out" keeps its answer.

**A successful send ends at SEND_TO_USER_INBOX, not PUBLISH_COMPLETE.** The studio posts with
`post_mode: MEDIA_UPLOAD`, so TikTok pulls the tiles, drops a notification in the account holder's
inbox, and stops there. That is success: the deck is sitting in TikTok waiting to be finished by
hand. `PUBLISH_COMPLETE` only arrives if and when that notification is tapped and the post actually
goes up, which may be days later or never, so the ledger treats both as settled and lets the later
one overwrite the earlier. `lib/send-state.ts` owns that vocabulary.

**A failed pull puts the video back in the queue.** TikTok's `publish_id` is a receipt, not a
result: it fetches the tiles afterwards, and that fetch can fail. When `/api/tiktok/status` learns
a pull failed, `settleSend` clears `sent_at` — unless some earlier send of the same video did
complete, in which case it is genuinely posted and stays that way. Without this, a video that never
landed would look sent forever and a batch job would skip it.

This is also why the status route writes back on every check. The tab that started a send is
usually closed by the time TikTok finishes pulling, and the ledger is the only thing left that can
learn the outcome. The deck page polls every five seconds for two minutes after a send, then stops:
TikTok allows only 6 requests a minute per token, and the next page load will settle it anyway.

A webhook would replace that polling entirely, and is the only thing that can settle a row with no
browser open at all. TikTok delivers `post.publish.complete` and `post.publish.failed` to a URL
registered in the developer portal, carrying the `publish_id` these rows are keyed by. It is not
built: it needs a route, signature verification, and config in the TikTok dashboard.

## A database error can never fail a send

Every function in `lib/db.ts` runs inside `safely()`, which warns and returns a fallback rather
than throwing. By the time a send is recorded the post already exists on TikTok, so an unreachable
database must not turn that success into an error the user sees. The cost is that a broken query
degrades quietly instead of loudly, which is what `npm run check:db` is for.

## Sending a batch

`nextUnsent(limit)` is the whole read side of "send the next 10":

```ts
const queue = await nextUnsent(10);   // [{ uid, deckId, iteration, madeAt }, ...]
```

`POST /api/queue/send` is the write side, and `docs/queue-api.md` is its reference. Both of the
things that used to gate it are answered here:

- **The access token no longer has to be in a cookie.** `tiktok_session` holds the same sealed
  session, so a cron, an agent or a plain `curl` can publish with a shared key instead of a
  browser. Connecting the account is still a once-a-year browser visit.
- **TikTok allows 6 requests per minute per access token.** Ten decks is ten init calls, so the
  endpoint sleeps 10.5 seconds between them rather than firing in parallel.

## Checking it

`npm run check:db` runs `lib/db.ts` against a real Postgres — PGlite, in process — by standing in
for Neon's HTTP endpoint. It exercises the actual SQL, transactions included, with no cloud
database and no connection string, and it asserts the rules above rather than a mock of them. It is
part of `npm run check`.
