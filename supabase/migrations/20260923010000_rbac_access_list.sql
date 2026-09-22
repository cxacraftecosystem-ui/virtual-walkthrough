-- RBAC (visitor < curator < admin < master) + access list (allowlist) + Google sign-in.
-- Idempotent: safe to apply with `supabase db push` AND `npm run db:migrate`.
-- Mirrored for SQLite in src/server/db/sqlite.ts (migration #2).

-- ---------------------------------------------------------------- users
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('visitor', 'curator', 'admin', 'master'));

-- Role granted by an admin in the Users page (null = none). The effective `role` column is
-- recomputed as max(access-list role, manual_role), or 'master' for MASTER_ADMIN_EMAIL.
alter table users add column if not exists manual_role text;
alter table users drop constraint if exists users_manual_role_check;
alter table users add constraint users_manual_role_check check (manual_role is null or manual_role in ('visitor', 'curator', 'admin'));

-- 1 once the address is proven (Google sign-in with email_verified, or the env-seeded admin).
-- Access-list elevation only applies to verified addresses (self-registration has no email check).
alter table users add column if not exists email_verified integer not null default 0;
alter table users add column if not exists google_sub text;
alter table users add column if not exists last_login_at timestamptz;
create unique index if not exists users_google_sub on users(google_sub) where google_sub is not null;

-- Google-only accounts have no password ('' never verifies).
alter table users alter column password_hash set default '';

-- keep existing administrators
update users set manual_role = 'admin' where role = 'admin' and manual_role is null;

-- ---------------------------------------------------------------- access list
create table if not exists access_list (
  pattern    text primary key,                  -- 'person@example.org' or '@example.org' (whole domain), lower-case
  role       text not null check (role in ('curator', 'admin')),
  note       text not null default '',
  created_by text,                              -- email of the master admin who added it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table access_list enable row level security;
