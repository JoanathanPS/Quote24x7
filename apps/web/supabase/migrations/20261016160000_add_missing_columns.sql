-- Migration: Add missing columns and tables to synchronize Supabase schema with application runtime

-- 1. email_threads
alter table public.email_threads add column if not exists state text not null default 'idle';
alter table public.email_threads add column if not exists rounds_used integer not null default 0;
alter table public.email_threads add column if not exists nonproductive_streak integer not null default 0;
alter table public.email_threads add column if not exists inbound_count integer not null default 0;
alter table public.email_threads add column if not exists last_inbound_at timestamptz;
alter table public.email_threads add column if not exists subject_canonical text;

-- 2. email_messages
alter table public.email_messages add column if not exists message_id_header text;
alter table public.email_messages add column if not exists in_reply_to text;
alter table public.email_messages add column if not exists "references" text;

-- 3. quotes
alter table public.quotes add column if not exists version integer not null default 1;
alter table public.quotes add column if not exists superseded_by text references public.quotes(id);

-- 4. ai_decisions
alter table public.ai_decisions add column if not exists provider text;
alter table public.ai_decisions add column if not exists decision_source text;
alter table public.ai_decisions add column if not exists fallback_reason text;
alter table public.ai_decisions add column if not exists prompt_tokens integer;
alter table public.ai_decisions add column if not exists completion_tokens integer;

-- 5. webhook_events
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'resend',
  event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  constraint uq_webhook_events_provider_event unique (provider, event_id)
);
alter table public.webhook_events enable row level security;
