-- Notice Content Studio: the send ledger.
--
-- The decks themselves stay on disk in git. This database holds only what the
-- filesystem cannot know: which video went out, when, and what came back.
--
-- Apply with `npm run db:init`. Every statement is idempotent.

create table if not exists video (
  -- The uid stamped in decks/<id>.json. Identity survives a rename or a remake.
  uid         uuid primary key,
  deck_id     text        not null,
  iteration   int         not null,
  tile_count  int         not null,
  -- The flag the whole thing exists for. Null means never successfully sent,
  -- which is exactly the queue. Cleared again if the pull later fails.
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists send (
  id          bigserial primary key,
  video_uid   uuid        not null references video (uid) on delete cascade,
  platform    text        not null default 'tiktok',
  -- TikTok's receipt. Null when the call failed before it issued one.
  publish_id  text,
  -- PROCESSING while TikTok pulls the tiles, then its own terminal status.
  status      text        not null,
  -- Snapshotted, because the deck on disk can change after the send.
  iteration   int         not null,
  tile_count  int,
  caption     text,
  error       text,
  log_id      text,
  created_at  timestamptz not null default now(),
  settled_at  timestamptz
);

create index if not exists send_video_idx on send (video_uid, created_at desc);
create index if not exists send_publish_idx on send (publish_id);
-- Queue order, lifted from the deck's own `createdAt`. Distinct from
-- created_at above, which is when the row first synced: a reset or a re-point
-- stamps that identically for every deck at once and the order is gone.
alter table video add column if not exists made_at timestamptz;
-- The "next 10 unsent" query, which is the one that has to stay fast. deck_id
-- is in the index because it breaks the tie between two decks made the same day.
create index if not exists video_queue_idx on video (made_at, deck_id) where sent_at is null;
-- Superseded: the queue used to order by created_at.
drop index if exists video_unsent_idx;

-- The connected TikTok account, so something other than a browser can publish.
--
-- One row, always id = 1. The tokens are stored sealed with the same AES-GCM
-- key as the session cookie (lib/tiktok.ts seal/unseal, keyed on the client
-- secret), so a dump of this database hands over nothing on its own.
create table if not exists tiktok_session (
  id          int primary key default 1 check (id = 1),
  open_id     text,
  sealed      text        not null,
  updated_at  timestamptz not null default now()
);
