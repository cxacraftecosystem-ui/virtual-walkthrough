-- Two apps share this database: site 'hand-block' (virtual-walkthrough) and 'clay' (virtual-walkthrough-clay).
-- This file is byte-identical in both repos (the migration runner refuses a file whose sha256 differs from
-- the one recorded when it was applied).
--
-- Additive only, so the code already deployed in either app keeps working while the other deploys:
--  - every new column has a constant default; rows written before this file, and inserts from code written
--    before it, land in 'hand-block';
--  - no constraint that an ON CONFLICT clause names changes. The favorites primary key does change: its only
--    insert uses a bare ON CONFLICT DO NOTHING, which needs no named target.
-- Users, sessions, the access list, analytics_batches and _museum_migrations stay shared.
-- Idempotent: safe to apply with `supabase db push` AND `npm run db:migrate`.
-- Mirrored for SQLite in src/server/db/sqlite.ts (migration "sites, revisions, audit log").

-- ---------------------------------------------------------------- per-site rows
alter table exhibitions add column if not exists site text not null default 'hand-block';
-- one default exhibition per site (was: one in the whole database)
drop index if exists exhibitions_one_default;
create unique index if not exists exhibitions_one_default_per_site on exhibitions(site) where is_default = 1;
create index if not exists exhibitions_site on exhibitions(site, status, sort);
-- Slugs stay unique across both sites for now (exhibitions_slug_key): the app answers 409 when the other
-- site already uses one.

alter table artisans            add column if not exists site text not null default 'hand-block';
alter table media               add column if not exists site text not null default 'hand-block';
alter table visitor_prints      add column if not exists site text not null default 'hand-block';
alter table comments            add column if not exists site text not null default 'hand-block';
alter table analytics_events    add column if not exists site text not null default 'hand-block';
-- not in the primary key: exhibition ids are global, the column is for site-scoped cleanup
alter table analytics_heat      add column if not exists site text not null default 'hand-block';
alter table client_errors       add column if not exists site text not null default 'hand-block';
-- the primary key stays (fingerprint): the fingerprint hash includes the site
alter table client_error_groups add column if not exists site text not null default 'hand-block';

alter table favorites add column if not exists site text not null default 'hand-block';
alter table favorites drop constraint if exists favorites_pkey;
alter table favorites add constraint favorites_pkey primary key (user_id, site, item_kind, item_id);

create index if not exists artisans_site            on artisans(site, sort);
create index if not exists media_site               on media(site, created_at);
create index if not exists visitor_prints_site      on visitor_prints(site, status, created_at);
create index if not exists comments_site_item       on comments(site, item_kind, item_id, created_at);
create index if not exists analytics_site_t         on analytics_events(site, t);
create index if not exists analytics_heat_site_day  on analytics_heat(site, day);
create index if not exists client_errors_site       on client_errors(site, created_at);
create index if not exists client_error_groups_site on client_error_groups(site, last_seen);

-- ---------------------------------------------------------------- who saved an item last
-- (email of the curator; null for seeded rows and for saves by code from before this file)
alter table content_items add column if not exists updated_by text;

-- ---------------------------------------------------------------- content revisions
-- One row per save, delete or restore of a content item: the item as it was after the change (for a delete,
-- as it was just before). Drives the history panel, restore and the trash.
create table if not exists content_revisions (
  id            bigint generated always as identity primary key,
  site          text not null default 'hand-block',
  exhibition_id text not null,
  collection    text not null,
  item_id       text not null,
  op            text not null check (op in ('create', 'update', 'delete', 'restore')),
  json          jsonb,
  actor_id      text,                               -- users.id (no foreign key: history outlives accounts)
  actor_email   text,
  created_at    timestamptz not null default now()
);
create index if not exists content_revisions_item on content_revisions(exhibition_id, collection, item_id, id);
create index if not exists content_revisions_op   on content_revisions(site, exhibition_id, op, id);

-- ---------------------------------------------------------------- audit log
-- Every change made through the admin: who, what, when, in one line a person can read.
create table if not exists audit_log (
  id            bigint generated always as identity primary key,
  site          text not null default 'hand-block',
  at            timestamptz not null default now(),
  actor_id      text,                               -- null: a scheduled job or the system
  actor_email   text,
  actor_role    text,
  action        text not null,                      -- e.g. 'content.update', 'prints.bulk'
  target_kind   text not null default '',
  target_id     text not null default '',
  exhibition_id text,
  summary       text not null default '',
  detail        jsonb
);
create index if not exists audit_log_site   on audit_log(site, id);
create index if not exists audit_log_target on audit_log(site, target_kind, target_id, id);

alter table content_revisions enable row level security;
alter table audit_log         enable row level security;
