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
  status_detail text,
  state text not null default 'idle',
  rounds_used integer not null default 0,
  nonproductive_streak integer not null default 0,
  inbound_count integer not null default 0,
  last_inbound_at timestamptz,
  subject_canonical text
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
  attachments jsonb not null default '[]'::jsonb,
  message_id_header text,
  in_reply_to text,
  "references" text,
  constraint uq_email_messages_message_id_header unique (message_id_header)
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
  expires_at timestamptz,
  version integer not null default 1,
  superseded_by text references public.quotes(id)
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
  provider text,
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
  catalogue_version text,
  decision_source text check (decision_source in ('ai','rules_fallback')),
  fallback_reason text,
  prompt_tokens integer,
  completion_tokens integer
);

-- 7. Idempotency Message Log
create table if not exists public.processed_messages (
  provider_message_id text primary key,
  processed_at timestamptz not null default now()
);

-- 8. Webhook Events
create table if not exists public.webhook_events (
  id text primary key,
  provider text not null default 'resend',
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint uq_webhook_events_provider_event_id unique (provider, provider_event_id)
);

-- Indexes for mail tables
create index if not exists idx_email_messages_thread_id on public.email_messages(thread_id);
create index if not exists idx_email_messages_provider_id on public.email_messages(provider_message_id);
create index if not exists idx_email_messages_message_id_header on public.email_messages(message_id_header);
create index if not exists idx_requirement_profiles_thread_id on public.requirement_profiles(thread_id);
create index if not exists idx_quotes_thread_id on public.quotes(thread_id);
create index if not exists idx_deliveries_thread_id on public.deliveries(thread_id);
create index if not exists idx_deliveries_provider_message_id on public.deliveries(provider_message_id);
create index if not exists idx_ai_decisions_thread_id on public.ai_decisions(thread_id);
create index if not exists idx_webhook_events_provider_event_id on public.webhook_events(provider, provider_event_id);

-- ==============================================================================
-- PRICING CATALOGUE TABLES
-- ==============================================================================

-- 9. Catalogue Versions
create table if not exists public.catalogue_versions (
  id text primary key,
  version text not null,
  market text not null,
  currency text not null,
  status text not null check (status in ('draft', 'active', 'superseded')),
  quote_basis text not null check (quote_basis in ('annual_from_monthly_x12', 'monthly', 'annual_published')),
  price_authority text not null check (price_authority in ('site24x7_public', 'zoho_store')),
  content_hash text not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  notes jsonb not null default '[]'::jsonb
);

-- 10. Catalogue Sources (file, page, crop reference)
create table if not exists public.catalogue_sources (
  id text primary key,
  catalogue_version_id text not null references public.catalogue_versions(id) on delete cascade,
  title text not null,
  locator text not null,
  url text,
  surface text not null check (surface in ('site24x7_public', 'zoho_store')),
  retrieved_at timestamptz not null,
  verification_status text not null check (verification_status in (
    'company_authorized', 'public_verified', 'screenshot_derived', 'synthetic_test'
  )),
  caveats jsonb not null default '[]'::jsonb,
  file text,
  page integer,
  crop_reference text
);

-- 11. Billable Units
create table if not exists public.catalogue_units (
  unit text primary key,
  label text not null,
  short_unit text not null,
  is_demand_unit boolean not null default true
);

-- 12. Plan Families
create table if not exists public.catalogue_plan_families (
  id text primary key,
  catalogue_version_id text not null references public.catalogue_versions(id) on delete cascade,
  name text not null,
  tab_label text not null,
  display_order integer not null default 0
);

-- 13. Plans
create table if not exists public.catalogue_plans (
  id text primary key,
  catalogue_version_id text not null references public.catalogue_versions(id) on delete cascade,
  name text not null,
  store_name text,
  summary text not null,
  price_monthly_annual_billed bigint check (price_monthly_annual_billed >= 0),
  price_month_to_month bigint check (price_month_to_month >= 0),
  quote_on_request boolean not null default false,
  price_is_floor boolean not null default false,
  polling_frequency text,
  monitoring_locations integer,
  support_tier text,
  store_price_monthly_annual_billed bigint,
  source_id text not null references public.catalogue_sources(id),
  display_order integer not null default 0,
  constraint catalogue_plans_priced_or_on_request check (
    quote_on_request or price_monthly_annual_billed is not null
  )
);

-- 14. Plan/Family Membership
create table if not exists public.catalogue_plan_family_members (
  plan_id text not null references public.catalogue_plans(id) on delete cascade,
  family_id text not null references public.catalogue_plan_families(id) on delete cascade,
  display_order integer not null default 0,
  primary key (plan_id, family_id)
);

-- 15. Plan Entitlements
create table if not exists public.catalogue_plan_entitlements (
  plan_id text not null references public.catalogue_plans(id) on delete cascade,
  unit text not null references public.catalogue_units(unit),
  included bigint check (included >= 0),
  label text not null,
  source_id text not null references public.catalogue_sources(id),
  primary key (plan_id, unit)
);

-- 16. Add-On Packs
create table if not exists public.catalogue_addons (
  id text primary key,
  catalogue_version_id text not null references public.catalogue_versions(id) on delete cascade,
  name text not null,
  billing_period text not null check (billing_period in ('annual', 'monthly', 'per_credit')),
  display_order integer not null default 0
);

-- 17. Add-On Grants
create table if not exists public.catalogue_addon_grants (
  addon_id text not null references public.catalogue_addons(id) on delete cascade,
  unit text not null references public.catalogue_units(unit),
  quantity bigint not null check (quantity > 0),
  primary key (addon_id, unit)
);

-- 18. Plan/Add-On Prices
create table if not exists public.catalogue_plan_addon_prices (
  plan_id text not null references public.catalogue_plans(id) on delete cascade,
  addon_id text not null references public.catalogue_addons(id) on delete cascade,
  price bigint not null check (price >= 0),
  billing_period text not null check (billing_period in ('annual', 'monthly', 'per_credit')),
  basis text not null default 'year' check (basis in ('year', 'month_billed_annually', 'month_list')),
  source_id text not null references public.catalogue_sources(id),
  primary key (plan_id, addon_id)
);

-- 19. Plan/Add-On Compatibility
create table if not exists public.catalogue_plan_addon_compat (
  plan_id text not null references public.catalogue_plans(id) on delete cascade,
  addon_id text not null references public.catalogue_addons(id) on delete cascade,
  allowed boolean not null,
  source_id text not null references public.catalogue_sources(id),
  primary key (plan_id, addon_id)
);

-- 20. Feature Matrix
create table if not exists public.catalogue_feature_matrix (
  plan_id text not null references public.catalogue_plans(id) on delete cascade,
  feature_key text not null,
  feature_label text not null,
  value_raw text not null,
  value_kind text not null check (value_kind in ('boolean', 'count', 'text')),
  value_number bigint,
  source_id text not null references public.catalogue_sources(id),
  display_order integer not null default 0,
  primary key (plan_id, feature_key)
);

-- 21. Licence Rules
create table if not exists public.catalogue_licence_rules (
  id text primary key,
  catalogue_version_id text not null references public.catalogue_versions(id) on delete cascade,
  rule_code text not null,
  description text not null,
  plan_id text references public.catalogue_plans(id) on delete cascade,
  addon_id text references public.catalogue_addons(id) on delete cascade,
  rule_type text not null,
  parameters jsonb not null default '{}'::jsonb,
  source_id text references public.catalogue_sources(id),
  created_at timestamptz not null default now()
);

-- 22. Catalogue Notes (conflicts and needs_confirmation items)
create table if not exists public.catalogue_notes (
  id text primary key,
  catalogue_version_id text not null references public.catalogue_versions(id) on delete cascade,
  category text not null check (category in ('conflict', 'needs_confirmation', 'unexplained_difference', 'observation')),
  item_type text not null,
  item_id text,
  field_name text,
  store_value text,
  public_value text,
  note text not null,
  source_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- 23. Knowledge Snippets
create table if not exists public.knowledge_snippets (
  id text primary key,
  topic text not null,
  text text not null,
  keywords text[] not null default '{}',
  source_url text not null,
  captured_on timestamptz not null,
  created_at timestamptz not null default now(),
  search_tsv tsvector generated always as (
    to_tsvector('english', coalesce(topic, '') || ' ' || coalesce(text, '') || ' ' || array_to_string(keywords, ' '))
  ) stored
);

-- Indexes for catalogue and knowledge
create index if not exists idx_catalogue_sources_version on public.catalogue_sources(catalogue_version_id);
create index if not exists idx_catalogue_families_version on public.catalogue_plan_families(catalogue_version_id);
create index if not exists idx_catalogue_plans_version on public.catalogue_plans(catalogue_version_id);
create index if not exists idx_catalogue_plan_family_members_family on public.catalogue_plan_family_members(family_id);
create index if not exists idx_catalogue_addons_version on public.catalogue_addons(catalogue_version_id);
create index if not exists idx_catalogue_addon_grants_unit on public.catalogue_addon_grants(unit);
create index if not exists idx_catalogue_plan_addon_prices_addon on public.catalogue_plan_addon_prices(addon_id);
create index if not exists idx_catalogue_plan_entitlements_unit on public.catalogue_plan_entitlements(unit);
create index if not exists idx_knowledge_snippets_tsv on public.knowledge_snippets using gin(search_tsv);

create unique index if not exists idx_catalogue_versions_one_active
  on public.catalogue_versions(market, currency)
  where status = 'active';


alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;
alter table public.requirement_profiles enable row level security;
alter table public.quotes enable row level security;
alter table public.deliveries enable row level security;
alter table public.ai_decisions enable row level security;
alter table public.processed_messages enable row level security;
alter table public.webhook_events enable row level security;
alter table public.catalogue_versions enable row level security;
alter table public.catalogue_sources enable row level security;
alter table public.catalogue_units enable row level security;
alter table public.catalogue_plan_families enable row level security;
alter table public.catalogue_plans enable row level security;
alter table public.catalogue_plan_family_members enable row level security;
alter table public.catalogue_plan_entitlements enable row level security;
alter table public.catalogue_addons enable row level security;
alter table public.catalogue_addon_grants enable row level security;
alter table public.catalogue_plan_addon_prices enable row level security;
alter table public.catalogue_plan_addon_compat enable row level security;
alter table public.catalogue_feature_matrix enable row level security;
alter table public.catalogue_licence_rules enable row level security;
alter table public.catalogue_notes enable row level security;
alter table public.knowledge_snippets enable row level security;

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
-- Drop legacy permissive "Allow all access" policies if present
do $$
declare
  t text;
begin
  foreach t in array array[
    'email_threads', 'email_messages', 'requirement_profiles', 'quotes',
    'deliveries', 'ai_decisions', 'processed_messages', 'webhook_events',
    'catalogue_versions', 'catalogue_sources', 'catalogue_units',
    'catalogue_plan_families', 'catalogue_plans', 'catalogue_plan_family_members',
    'catalogue_plan_entitlements', 'catalogue_addons', 'catalogue_addon_grants',
    'catalogue_plan_addon_prices', 'catalogue_plan_addon_compat',
    'catalogue_feature_matrix', 'catalogue_licence_rules', 'catalogue_notes',
    'knowledge_snippets'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'Allow all access to ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'Allow anon read ' || t, t);
  end loop;
end $$;
