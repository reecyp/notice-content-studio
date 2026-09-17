# The queue API

`POST /api/queue/send` sends the next N decks to TikTok. It is the endpoint a scheduled agent
calls, and it is the only way into the studio that needs neither a browser nor a person.

Everything a browser would have supplied comes from somewhere else. The account comes from the
`tiktok_session` row instead of a cookie. The authorization comes from a shared key instead of
someone clicking Send. What happens in between is the same code path the button uses,
`publishDeck` in `lib/publish.ts`.

## What it needs

| | |
|---|---|
| `QUEUE_API_KEY` | The shared key. Unset means the endpoint returns 503, which is the correct default: no key, no server-initiated posting. `openssl rand -base64 32`. |
| `DATABASE_URL` | Without it nothing records what has been sent, so there is no queue to read. 503. |
| A connected account | Open `/api/tiktok/auth` in a browser once. The refresh token is good for a year. |
| A public https origin | TikTok fetches the tiles itself, so this only works against the deployment. |

## The queue

Oldest `createdAt` first, from `decks/*.json`, skipping anything already sent.

That is the entire ordering rule. `createdAt` lives in the deck file rather than in the database
because the database's own `created_at` records when a row first synced — re-init the database and
every deck gets the same timestamp and the order is gone. Two decks made the same day break their
tie on `deck_id`, so the same call does not send a different pair each time it runs.

Every call re-syncs the decks on disk into the registry first, so a deck authored since the last
page load is in the queue rather than waiting for someone to open the library. A deck whose file
does not parse is skipped and reported in `unparsed`; a row whose file has been deleted is skipped
silently, because rows outlive files on purpose.

## GET — what is waiting

```bash
curl -H "Authorization: Bearer $QUEUE_API_KEY" https://<your-app>/api/queue/send
```

```json
{
  "connected": true,
  "connectedAt": "2026-09-16 14:02:11+00",
  "queued": 14,
  "ready": 14,
  "maxBatch": 20,
  "unparsed": [],
  "nextUp": [{ "deckId": "solo-missions", "madeAt": "2026-09-15 00:00:00+00" }]
}
```

`queued` is every unsent row; `ready` is the subset whose file is still on disk and parses, which
is the number the batch actually draws from. Free of side effects beyond the disk sync.

## POST — send them

```bash
curl -X POST https://<your-app>/api/queue/send \
  -H "Authorization: Bearer $QUEUE_API_KEY" \
  -H "content-type: application/json" \
  -d '{"count": 10}'
```

`count` defaults to 10 and may be 1 to 20.

```json
{
  "sent": 10,
  "requested": 10,
  "remaining": 4,
  "decks": [{ "deckId": "solo-missions", "uid": "2668...", "publishId": "v_pub_...", "tiles": 9 }]
}
```

### It is all or nothing

A batch of ten with four decks in the queue sends nothing:

```json
{ "error": "not enough decks in the queue for a full batch", "requested": 10, "available": 4 }
```

409, and the four stay where they are. The point is an even posting cadence: a short batch would
trail off rather than stop, and the agent would have no clear signal to go and author more.

### It paces itself

TikTok allows 6 requests per minute per access token, so the endpoint sleeps 10.5 seconds between
decks. Ten decks is about 95 seconds of wall clock; `maxDuration` is 300, and 20 is the cap because
that is what fits inside it with room for the round trips.

Nothing to do on the caller's side except allow the time. A client with a 30-second timeout will
hang up on a batch that is still succeeding.

### A failure stops the batch

If deck four fails, decks five through ten are not attempted:

```json
{
  "error": "...",
  "failedOn": "some-deck",
  "requested": 10,
  "sent": 3,
  "decks": [ /* the three that went out */ ]
}
```

502. Whatever broke one send — an expired token, a rate limit, TikTok being down — breaks the rest
the same way, and trying nine more times turns one failure into ten log lines. The three that went
out have left the queue and stay gone, so a retry picks up from deck four.

## Every response code

| Code | Meaning |
|---|---|
| 200 | Every deck in the batch was handed to TikTok. |
| 400 | `count` is not a whole number from 1 to 20. |
| 401 | Missing or wrong `Authorization: Bearer` key. |
| 409 | Not enough decks, no connected account, or an origin TikTok cannot reach. |
| 502 | TikTok rejected a send. `sent` says how many got out first. |
| 503 | `QUEUE_API_KEY` or `DATABASE_URL` is not set. |

A 409 for a short queue carries `available`; a 409 for no account carries `connect`.

## What it does not do

**It does not post to your feed.** The studio sends with `post_mode: MEDIA_UPLOAD`, so each deck
lands as a notification in the account holder's TikTok inbox and waits to be finished by hand. A
scheduled batch of ten is ten notifications to tap, not ten posts. Direct posting needs the
`video.publish` scope and a heavier TikTok audit; `sendToDrafts` in `lib/tiktok.ts` is where that
would change.

**It does not know whether TikTok's pull succeeded.** A `publish_id` is a receipt. The pull happens
afterwards and can fail, which puts the deck back in the queue — see `docs/database.md`. Today only
`/api/tiktok/status` learns that, and it needs a browser; a webhook is the thing that would settle
it unattended.

**It does not retry.** By design: a retry loop inside a rate-limited batch is how one bad token
becomes a hundred failed calls. Retrying is the schedule's job, and the next run picks up exactly
where this one stopped.

## Scheduling it

Anything that can make an HTTP call works. The two things to get right are the timeout, which has
to exceed `count × 10.5s`, and the response handling: a 409 with `available` means author more
decks, not retry.
