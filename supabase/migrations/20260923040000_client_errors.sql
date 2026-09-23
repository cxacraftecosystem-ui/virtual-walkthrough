-- Client error reporting (POST /api/errors → src/server/handlers/errors.ts; admin → Errors page).
-- PII-free: no IP / user id is stored. Idempotent. Mirrored for SQLite in src/server/db/sqlite.ts.
create table if not exists client_errors (
  id          bigint generated always as identity primary key,
  fingerprint text not null,
  kind        text not null,
  message     text not null,
  stack       text,
  url         text,
  ua          text,
  tier        text,
  gpu         text,
  release     text,
  created_at  bigint not null                -- server epoch ms
);
create index if not exists client_errors_fp on client_errors(fingerprint, created_at);
create index if not exists client_errors_created on client_errors(created_at);

create table if not exists client_error_groups (
  fingerprint  text primary key,
  kind         text not null,
  message      text not null,
  count        bigint not null default 0,
  first_seen   bigint not null,
  last_seen    bigint not null,
  resolved_at  bigint,                        -- null = open; a new occurrence reopens
  last_stack   text,
  last_url     text,
  last_ua      text,
  last_tier    text,
  last_gpu     text,
  last_release text
);
create index if not exists client_error_groups_last on client_error_groups(last_seen);

alter table client_errors       enable row level security;
alter table client_error_groups enable row level security;
