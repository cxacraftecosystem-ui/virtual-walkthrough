-- "Print it yourself" studio: visitor prints submitted for the Visitors' Wall (moderated).
-- Idempotent: safe to apply with `supabase db push` AND `npm run db:migrate`.
-- Mirrored for SQLite in src/server/db/sqlite.ts (migration "visitor prints").

create table if not exists visitor_prints (
  id           text primary key,                  -- UUID
  session_id   text not null,                     -- random anonymous museum session id (no personal data)
  user_id      text references users(id) on delete set null, -- signed-in visitor, if any
  display_name text not null default '',          -- optional, as typed by the visitor ('' = anonymous)
  motif        text not null default '',          -- main block used
  meta         jsonb not null default '{}'::jsonb, -- { blocks, dyes, ground, stamps } — design summary
  storage_key  text not null,                     -- prints/<id>.png in the storage driver
  url          text not null,                     -- public URL (relative /media/… or absolute S3/CDN)
  width        integer not null,
  height       integer not null,
  size         integer not null,                  -- bytes
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  text
);
create index if not exists visitor_prints_status on visitor_prints(status, created_at);
create index if not exists visitor_prints_session on visitor_prints(session_id, created_at);

alter table visitor_prints enable row level security;
