-- Several master admins (MASTER_ADMIN_EMAILS): the access list mirrors them as role 'master'
-- rows, maintained by the server from the env var on every start (not editable in the UI).
-- Idempotent. Mirrored for SQLite in src/server/db/sqlite.ts (migration #3).
alter table access_list drop constraint if exists access_list_role_check;
alter table access_list add constraint access_list_role_check check (role in ('curator', 'admin', 'master'));
