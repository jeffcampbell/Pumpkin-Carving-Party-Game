-- Applied automatically on server start (idempotent). You can also paste it into
-- the Supabase SQL editor.

create table if not exists pumpkins (
  id              text primary key,
  title           text not null default '',
  mask_png        bytea not null,          -- carving mask: black = skin, grey = etched, white = cut through
  thumb_jpg       bytea not null,          -- front-view snapshot, used for previews and link unfurls
  candle_color    text not null,
  skin_color      text not null,
  edit_token_hash text not null,           -- sha256 of the secret the creator's browser keeps
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Added after launch; harmless to re-run.
alter table pumpkins add column if not exists scene text not null default 'studio';

-- The app talks to Postgres directly with the connection string, so nothing
-- should be readable through Supabase's public REST API. RLS with no policies
-- blocks the anon/authenticated roles entirely.
alter table pumpkins enable row level security;

-- Stats for /stats. Daily counters (visitors, rounds played, votes, ...); totals are sums.
create table if not exists daily_stats (
  day   date   not null,
  name  text   not null,
  value bigint not null default 0,
  primary key (day, name)
);

-- Today's visitors as salted one-way hashes, only so each counts once a day.
-- Rows older than a couple of days are deleted.
create table if not exists visitor_days (
  day     date not null,
  visitor text not null,
  primary key (day, visitor)
);

alter table daily_stats enable row level security;
alter table visitor_days enable row level security;
