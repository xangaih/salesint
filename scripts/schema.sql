create table if not exists rfq_lines (
  solicitation   text not null,
  pr             text not null,
  nsn            text not null,
  is_nsn         boolean not null,
  fsc            text,
  item           text,
  qty            integer,
  uom            text,
  return_by      date not null,
  prev_return_by date,
  set_aside      text,
  item_type      text,
  buy_letter     text,
  buy_type       text,
  first_posted   date not null,
  last_posted    date not null,
  primary key (solicitation, pr, nsn)
);
create index if not exists rfq_lines_return_by on rfq_lines (return_by);
create index if not exists rfq_lines_fsc on rfq_lines (fsc);
create index if not exists rfq_lines_nsn on rfq_lines (nsn);

create table if not exists approved_sources (
  nsn         text not null,
  cage        text not null,
  part_number text not null default '',
  primary key (nsn, cage, part_number)
);
create index if not exists approved_sources_cage on approved_sources (cage);

create table if not exists profile (
  id             integer primary key default 1,
  name           text not null,
  description    text not null default '',
  fscs           text[] not null default '{}',
  cages          text[] not null default '{}',
  nsns           text[] not null default '{}',
  small_business boolean not null default true,
  set_asides     text[] not null default '{}'
);

create table if not exists ingest_runs (
  id          bigserial primary key,
  file_name   text not null,
  post_date   date not null,
  lines_read  integer not null,
  rows_loaded integer not null,
  skipped     integer not null,
  skip_notes  jsonb,
  loaded_at   timestamptz not null default now()
);

-- Supabase exposes the public schema through its REST API. With row level security on
-- and no policies, the browser-facing keys can read nothing; the app's own server-side
-- Postgres connection (table owner) is not affected.
alter table rfq_lines        enable row level security;
alter table approved_sources enable row level security;
alter table profile          enable row level security;
alter table ingest_runs      enable row level security;
