# Sending a deck to TikTok

The studio hands TikTok a whole deck as a photo carousel. TikTok fetches the
tiles, then notifies the account holder to finish the post in its own editor.

## Why there is no upload step

A photo post cannot carry bytes. `/v2/post/publish/content/init/` accepts
`source: "PULL_FROM_URL"` and nothing else for photos, and it will only pull
from a domain or URL prefix the app has proved it owns. So the tiles are served
from this app at `/api/tile/<deck>/<n>.webp` and TikTok comes and gets them.

That is also why the decks need no database. A tile URL is derived from the
deck id and the tile index, the bytes are rendered per request from the JSON on
disk, and there is nothing stored to go stale.

## One-time setup

1. **Register the app** at developers.tiktok.com and add two products: *Login
   Kit* and *Content Posting API*.
2. **Request the scopes** `user.info.basic` and `video.upload`. `video.upload`
   is the draft scope. `video.publish` posts straight to the feed, needs a
   heavier audit, and is not used here.
3. **Register the redirect URI**: `https://<your-app>/api/tiktok/callback`.
   It must be absolute https with no query string and no fragment, and it has
   to match `TIKTOK_REDIRECT_URI` exactly. `http://localhost` is rejected, so
   the OAuth round trip only works against the deployment.
4. **Verify the URL property** for the same origin, under *Manage apps → URL
   properties*. Without this, every pull fails. On a `*.vercel.app` hostname,
   verify by URL prefix: TikTok gives you a signature file, which goes in
   `public/` so it is served at the prefix. Only production is verified —
   preview deployments get other hostnames and cannot serve the images.
5. **Set the environment** from `.env.local.example`. The client secret is
   server-only and also encrypts the session cookie.

## Testing before the app is audited

Sandbox mode covers draft posting without submitting for review. Add your own
TikTok account as a target user. Note that an unaudited client has its posted
content forced to private, and sandbox does not cover public video posting.

## What the account connection is

`/api/tiktok/auth` → TikTok → `/api/tiktok/callback` stores the tokens in one
encrypted, httpOnly cookie. The refresh token is good for a year, so this is a
once-a-year click. It rotates on use, and `/api/tiktok/publish` writes the
cookie again whenever TikTok hands back a new one.

Keeping the session in a cookie rather than in a store has a useful side
effect: only the browser that connected the account can publish, so the studio
needs no login of its own. `/api/tile` stays open, because TikTok has to reach
it unauthenticated.

## Limits worth knowing

| | |
|---|---|
| Formats | WebP and JPEG only. **Not PNG** — the download bar's format is not TikTok's |
| Images | 35 per post, which is why `parseDeck` rejects a 36-tile deck |
| Size | 20MB per image. A tile is ~320KB as WebP |
| Resolution | 1080p max. Tiles are 1080×1080 |
| Rate | 6 requests per minute per access token |
| Caption | title 90 UTF-16 runes, description 4000 |
| URLs | https, no redirects, must stay reachable for an hour after the pull starts |
