-- ==============================================================================
-- Quote24x7 Supabase Database Schema
-- Run this script in the Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- ==============================================================================

-- 1. Email Threads
create table if not exists public.email_threads (
  id text primary key,
  provider text not null default 'resend',
  provider_thread_id text,
  sender_email text not null,
  sender_name text,
  organisation text,
  subject text not null,
  status text not null,
  request_type text not null default 'quote',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  message_count integer not null default 0,
  quote_id text,
  quote_total bigint,
  currency text,
  status_detail text
);

-- 2. Email Messages
create table if not exists public.email_messages (
  id text primary key,
  thread_id text not null references public.email_threads(id) on delete cascade,
  provider_message_id text not null,
  direction text not null,
  from_address text not null,
  from_name text,
  to_addresses jsonb not null default '[]'::jsonb,
  subject text not null,
  body_text text not null,
  occurred_at timestamptz not null default now(),
  delivery_id text,
  security_notes jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb
);

-- 3. Requirement Profiles
create table if not exists public.requirement_profiles (
  id text primary key,
  thread_id text not null references public.email_threads(id) on delete cascade,
  version integer not null default 1,
  supersedes_profile_id text,
  created_at timestamptz not null default now(),
  extractor_model text not null,
  extractor_run_id text,
  fields jsonb not null default '[]'::jsonb,
  summary text not null,
  pending_questions jsonb not null default '[]'::jsonb,
  answered_questions jsonb not null default '[]'::jsonb,
  clarification_round integer not null default 0
);

-- 4. Quotes
create table if not exists public.quotes (
  id text primary key,
  thread_id text not null references public.email_threads(id) on delete cascade,
  requirement_profile_id text,
  catalogue_version_id text not null,
  catalogue_version text not null,
  calculation_version text not null,
  status text not null,
  pricing_status text not null,
  market text not null,
  currency text not null,
  billing_period text not null,
  options jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  exclusions jsonb not null default '[]'::jsonb,
  calculation_trace jsonb not null default '[]'::jsonb,
  integrity_checks jsonb not null default '[]'::jsonb,
  documents jsonb not null default '[]'::jsonb,
  option_count_note text,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

-- 5. Delivery Records
create table if not exists public.deliveries (
  id text primary key,
  thread_id text not null references public.email_threads(id) on delete cascade,
  quote_id text,
  provider text not null default 'resend',
  provider_message_id text,
  recipient text not null,
  subject text not null,
  status text not null,
  attempt_count integer not null default 1,
  max_attempts integer not null default 3,
  last_error_code text,
  last_error_message text,
  next_retry_at timestamptz,
  retry_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  events jsonb not null default '[]'::jsonb
);

-- 6. AI Sales Engineer Decisions
create table if not exists public.ai_decisions (
  id text primary key,
  thread_id text not null references public.email_threads(id) on delete cascade,
  profile_id text,
  created_at timestamptz not null default now(),
  source text not null,
  model text,
  action text not null,
  original_action text,
  customer_summary text,
  identified_needs jsonb not null default '[]'::jsonb,
  recommended_categories jsonb not null default '[]'::jsonb,
  referenced_plan_ids jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  follow_up_questions jsonb not null default '[]'::jsonb,
  reasoning_summary text,
  confidence numeric,
  human_review_reasons jsonb not null default '[]'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  failure_category text,
  failure_detail text,
  latency_ms integer,
  catalogue_version text
);

-- 7. Idempotency Message Log
create table if not exists public.processed_messages (
  provider_message_id text primary key,
  processed_at timestamptz not null default now()
);

-- Indexes for performance
create index if not exists idx_email_messages_thread_id on public.email_messages(thread_id);
create index if not exists idx_email_messages_provider_id on public.email_messages(provider_message_id);
create index if not exists idx_requirement_profiles_thread_id on public.requirement_profiles(thread_id);
create index if not exists idx_quotes_thread_id on public.quotes(thread_id);
create index if not exists idx_deliveries_thread_id on public.deliveries(thread_id);
create index if not exists idx_deliveries_provider_message_id on public.deliveries(provider_message_id);
create index if not exists idx_ai_decisions_thread_id on public.ai_decisions(thread_id);

-- Enable Row Level Security (RLS)
alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;
alter table public.requirement_profiles enable row level security;
alter table public.quotes enable row level security;
alter table public.deliveries enable row level security;
alter table public.ai_decisions enable row level security;
alter table public.processed_messages enable row level security;

-- Policies allowing full access to backend service role and anon clients with API key
create policy "Allow all access to email_threads" on public.email_threads for all using (true) with check (true);
create policy "Allow all access to email_messages" on public.email_messages for all using (true) with check (true);
create policy "Allow all access to requirement_profiles" on public.requirement_profiles for all using (true) with check (true);
create policy "Allow all access to quotes" on public.quotes for all using (true) with check (true);
create policy "Allow all access to deliveries" on public.deliveries for all using (true) with check (true);
create policy "Allow all access to ai_decisions" on public.ai_decisions for all using (true) with check (true);
create policy "Allow all access to processed_messages" on public.processed_messages for all using (true) with check (true);
