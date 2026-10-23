create table if not exists public.benchmark_runs (
  id text primary key,
  dataset_version text not null check (dataset_version in ('v1', 'v2')),
  provider text not null,
  started_at timestamptz not null,
  cases integer not null,
  repeats integer not null default 1,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.benchmark_runs enable row level security;

create index if not exists benchmark_runs_dataset_started_idx
  on public.benchmark_runs (dataset_version, started_at desc);