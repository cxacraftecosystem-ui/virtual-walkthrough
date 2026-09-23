-- Multi-exhibition platform + "Meet the maker" (artisans) + curator analytics (heatmap rollup).
-- Idempotent: safe to apply with `supabase db push` AND `npm run db:migrate`.
-- Mirrored for SQLite in src/server/db/sqlite.ts (migration "exhibitions, artisans, heatmap").

-- ---------------------------------------------------------------- exhibitions
-- The building is shared; every exhibition has its own content set (content_items.exhibition_id),
-- reveal-wall text, reception welcome, optional tour-stop override and a theme (accent colour).
create table if not exists exhibitions (
  id              text primary key,                 -- stable internal id (= slug at creation)
  slug            text not null unique,             -- URL: /gallery/<slug>
  title           text not null,
  subtitle        text not null default '',
  status          text not null default 'draft' check (status in ('draft', 'published')),
  is_default      integer not null default 0,       -- 1 = served at /gallery and by /api/content without ?exhibition
  theme           jsonb not null default '{}'::jsonb, -- { accent?: '#rrggbb' }
  exhibition_text jsonb not null default '{}'::jsonb, -- ExhibitionText { kicker, title, subtitle, intro }
  welcome         jsonb not null default '{"title":"","body":""}'::jsonb,
  tour            jsonb,                            -- TourStop[] override (null = bundled tour)
  sort            integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists exhibitions_one_default on exhibitions(is_default) where is_default = 1;

-- The existing content becomes the default exhibition 'hand-block-printing'.
insert into exhibitions (id, slug, title, subtitle, status, is_default, theme, exhibition_text, welcome, sort)
select 'hand-block-printing', 'hand-block-printing', 'Hand Block Printing',
       'Carved wood, natural dye and cloth', 'published', 1, '{"accent":"#8a5a3b"}'::jsonb,
       coalesce((select value from meta where key = 'exhibition'), '{}')::jsonb,
       coalesce((select value from meta where key = 'welcome'), '{"title":"","body":""}')::jsonb,
       0
where not exists (select 1 from exhibitions);

alter table content_items add column if not exists exhibition_id text not null default 'hand-block-printing';
alter table content_items drop constraint if exists content_items_pkey;
alter table content_items add constraint content_items_pkey primary key (exhibition_id, collection, id);

-- ---------------------------------------------------------------- artisans ("Meet the maker")
create table if not exists artisans (
  id             text primary key,
  name           text not null,
  cluster        text not null default '',          -- cluster / region, free text as supplied by the workshop
  craft          text not null default '',
  bio            text not null default '',
  portrait       text not null default '',          -- image URL (media library or /public)
  contact        text not null default '',          -- free text (as supplied; shown only when present)
  website        text not null default '',          -- "Visit the maker"
  shop_url       text not null default '',          -- "Buy (fair trade)"
  commission_url text not null default '',          -- "Commission"
  verified       integer not null default 0,        -- 1 = profile confirmed by the workshop / curator
  placeholder    integer not null default 0,        -- 1 = stand-in profile until real data is supplied
  sort           integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- analytics
alter table analytics_events add column if not exists exhibition_id text;
update analytics_events set exhibition_id = 'hand-block-printing' where exhibition_id is null;
create index if not exists analytics_exhibition on analytics_events(exhibition_id, t);
create index if not exists analytics_type on analytics_events(type, t);

-- Heatmap rollup: 'pos' samples (every 2 s) are aggregated on insert into 0.5 m cells per
-- exhibition / UTC day / zone. Raw positions are never stored.
create table if not exists analytics_heat (
  exhibition_id text not null,
  day           text not null,                      -- 'YYYY-MM-DD' (UTC)
  zone          text not null default '',
  cx            integer not null,                   -- floor(x / 0.5)
  cz            integer not null,                   -- floor(z / 0.5)
  samples       integer not null default 0,
  primary key (exhibition_id, day, zone, cx, cz)
);

alter table exhibitions    enable row level security;
alter table artisans       enable row level security;
alter table analytics_heat enable row level security;
