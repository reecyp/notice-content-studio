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
-- The "next 10 unsent" query, which is the one that has to stay fast.
create index if not exists video_unsent_idx on video (created_at) where sent_at is null;
