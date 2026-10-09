-- Analytics batch markers: a batch the tracker sends again (its reply was lost, not its request) is
-- stored once. POST /api/analytics/events inserts (session_id, batch_id) in the same transaction as the
-- batch's events and heatmap cells, and stores nothing when the row is already there. Rows are deleted
-- 31 days after they arrive, when re-sending the batch could store nothing anyway (BATCH_MARKER_MS in
-- src/server/handlers/curatorAnalytics.ts).
-- Idempotent: safe to apply with `supabase db push` AND `npm run db:migrate`.
-- Mirrored for SQLite in src/server/db/sqlite.ts (migration "analytics batch markers").
create table if not exists analytics_batches (
  session_id  text not null,                   -- the tracker's random session id
  batch_id    text not null,                   -- made in the browser; the same on every attempt
  received_at bigint not null,                 -- server epoch ms of the attempt that stored the batch
  primary key (session_id, batch_id)
);
create index if not exists analytics_batches_received on analytics_batches(received_at);

alter table analytics_batches enable row level security;
