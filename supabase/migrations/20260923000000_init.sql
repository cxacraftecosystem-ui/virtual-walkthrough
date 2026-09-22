-- Hand Block Printing virtual museum — initial schema (PostgreSQL / Supabase).
-- Idempotent: safe to apply with `supabase db push` AND `npm run db:migrate`.
-- The API server connects with the database owner role (bypasses RLS). RLS is enabled with
-- NO policies so Supabase's public PostgREST API (anon / authenticated keys) cannot read or
-- write any of these tables (password hashes, sessions, …).

create table if not exists meta (
  key   text primary key,
  value text not null
);

create table if not exists content_items (
  collection text not null,
  id         text not null,
  json       jsonb not null,
  sort       integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create table if not exists users (
  id            text primary key,
  email         text not null unique,          -- stored lower-case
  display_name  text not null,
  role          text not null default 'visitor' check (role in ('visitor', 'admin')),
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text primary key,                  -- sha256(token); the raw token only lives in the cookie
  user_id    text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at bigint not null                    -- epoch ms
);
create index if not exists sessions_user on sessions(user_id);

create table if not exists favorites (
  user_id    text not null references users(id) on delete cascade,
  item_kind  text not null,
  item_id    text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_kind, item_id)
);

create table if not exists comments (
  id         text primary key,
  user_id    text not null references users(id) on delete cascade,
  item_kind  text not null default '',          -- '' = museum guestbook
  item_id    text not null default '',
  body       text not null,
  hidden     integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists comments_item on comments(item_kind, item_id, created_at);

create table if not exists media (
  id          text primary key,
  folder      text not null,
  stored_name text not null,
  filename    text not null,
  mime        text not null,
  size        bigint not null,
  created_at  timestamptz not null default now()
);

create table if not exists analytics_events (
  id          bigint generated always as identity primary key,
  session_id  text not null,
  t           bigint not null,                  -- client epoch ms
  type        text not null,
  zone        text,
  item_kind   text,
  item_id     text,
  seconds     double precision,
  tier        text,
  meta        jsonb,
  received_at bigint not null
);
create index if not exists analytics_t on analytics_events(t);
create index if not exists analytics_session on analytics_events(session_id, t);

alter table meta             enable row level security;
alter table content_items    enable row level security;
alter table users            enable row level security;
alter table sessions         enable row level security;
alter table favorites        enable row level security;
alter table comments         enable row level security;
alter table media            enable row level security;
alter table analytics_events enable row level security;
