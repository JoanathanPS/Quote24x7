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

-- Access policies are created once, at the end of this file, for every table.
-- See "ACCESS POLICIES" below.

-- ==============================================================================
-- PRICING CATALOGUE
-- ==============================================================================
-- Source of truth for every figure the pricing engine is allowed to use.
--
-- Two hard rules are enforced structurally rather than by convention:
--
--   1. Only published figures are stored. There is deliberately no
--      "annual total" column: plans are published as a monthly rate billed
--      annually, so the x12 happens in the engine and is written into the
--      quote's calculation trace. A derived number can therefore never be
--      mistaken for a published one.
--
--   2. Add-on prices are keyed by (plan, add-on). Zoho charges different
--      amounts for the same pack depending on the base plan -- 500 Basic
--      Monitors is INR 4,61,700/yr on Professional but INR 7,38,720/yr on
--      Enterprise -- so there is no such thing as "the" price of an add-on.
--
-- All money is stored in paise as bigint. Paise represents the store's
-- fractional rupee amounts (e.g. INR 28.50 -> 2850) without floating point.
-- ==============================================================================

-- 8. Catalogue Versions
create table if not exists public.catalogue_versions (
  id text primary key,
  version text not null,
  market text not null,
  currency text not null,
  status text not null check (status in ('draft', 'active', 'superseded')),
  -- How plan prices are turned into a contract value, recorded so a quote can
  -- always explain its own arithmetic.
  quote_basis text not null check (quote_basis in ('annual_from_monthly_x12', 'monthly', 'annual_published')),
  -- Which surface wins when sources disagree on a plan price.
  price_authority text not null check (price_authority in ('site24x7_public', 'zoho_store')),
  content_hash text not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  notes jsonb not null default '[]'::jsonb
);

-- 9. Catalogue Sources (provenance, down to the capture and page)
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
  caveats jsonb not null default '[]'::jsonb
);

-- 10. Billable Units
-- A reference table rather than an enum so a newly captured unit does not
-- require a schema migration.
create table if not exists public.catalogue_units (
  unit text primary key,
  label text not null,
  short_unit text not null,
  -- Whether a buyer requirement maps onto this unit, i.e. whether the
  -- clarification engine must know a count for it before quoting.
  is_demand_unit boolean not null default true
);

-- 11. Plan Families (the four tabs on the public pricing page)
create table if not exists public.catalogue_plan_families (
  id text primary key,
  catalogue_version_id text not null references public.catalogue_versions(id) on delete cascade,
  name text not null,
  tab_label text not null,
  display_order integer not null default 0
);

-- 12. Plans
-- A plan is a SKU, not a tab. The Zoho Store shows exactly one PROFESSIONAL
-- column at INR 3,990 while the public site lists Professional under both
-- Infrastructure and All-in-One, so tab membership is many-to-many (see
-- catalogue_plan_family_members) rather than a column here. Modelling it as a
-- single family would have duplicated one SKU into two plans.
create table if not exists public.catalogue_plans (
  id text primary key,
  catalogue_version_id text not null references public.catalogue_versions(id) on delete cascade,
  name text not null,
  store_name text,
  summary text not null,
  -- Published figures, verbatim. Both may be null for a quote-on-request tier.
  price_monthly_annual_billed bigint check (price_monthly_annual_billed >= 0),
  price_month_to_month bigint check (price_month_to_month >= 0),
  -- "Starts at" / "Request Price Quote" tiers: the engine must route these to a
  -- human instead of inventing a total.
  quote_on_request boolean not null default false,
  price_is_floor boolean not null default false,
  polling_frequency text,
  monitoring_locations integer,
  support_tier text,
  -- The conflicting Zoho Store figure, retained for internal reference only.
  -- Never used for quoting while price_authority = 'site24x7_public'.
  store_price_monthly_annual_billed bigint,
  source_id text not null references public.catalogue_sources(id),
  display_order integer not null default 0,
  -- A plan is either priced or explicitly quote-on-request; it cannot be neither.
  constraint catalogue_plans_priced_or_on_request check (
    quote_on_request or price_monthly_annual_billed is not null
  )
);

-- 13. Plan/Family Membership
-- One row per tab a plan is marketed under. Lite, Professional and Enterprise
-- each appear under both Infrastructure and All-in-One at an identical price.
create table if not exists public.catalogue_plan_family_members (
  plan_id text not null references public.catalogue_plans(id) on delete cascade,
  family_id text not null references public.catalogue_plan_families(id) on delete cascade,
  display_order integer not null default 0,
  primary key (plan_id, family_id)
);

-- 14. Plan Entitlements (what a plan includes before any add-on)
-- Keyed by (plan, unit). Where two tabs describe the same SKU, they must agree
-- on the number; the seed generator fails rather than silently choosing one.
create table if not exists public.catalogue_plan_entitlements (
  plan_id text not null references public.catalogue_plans(id) on delete cascade,
  unit text not null references public.catalogue_units(unit),
  -- null = capability not offered on this plan at all
  --    0 = capability available but nothing included (requires an add-on)
  included bigint check (included >= 0),
  -- Zoho's own wording, so a proposal can quote the source rather than a paraphrase.
  label text not null,
  source_id text not null references public.catalogue_sources(id),
  primary key (plan_id, unit)
);

-- 15. Add-On Packs (identity only -- deliberately no price column)
create table if not exists public.catalogue_addons (
  id text primary key,
  catalogue_version_id text not null references public.catalogue_versions(id) on delete cascade,
  name text not null,
  billing_period text not null check (billing_period in ('annual', 'monthly', 'per_credit')),
  display_order integer not null default 0
);

-- 16. Add-On Grants
-- One row per unit a pack delivers. Compound packs such as
-- "500K Pageviews & 5 sites" or "50 uptime & 10 transactions" grant two units
-- for a single price, so the price is never apportioned between them.
create table if not exists public.catalogue_addon_grants (
  addon_id text not null references public.catalogue_addons(id) on delete cascade,
  unit text not null references public.catalogue_units(unit),
  quantity bigint not null check (quantity > 0),
  primary key (addon_id, unit)
);

-- 17. Plan/Add-On Prices
-- The table that makes plan-scoped pricing structural. A missing row means the
-- pack is not purchasable on that plan, which the engine treats as a rejection
-- reason rather than falling back to another plan's price.
create table if not exists public.catalogue_plan_addon_prices (
  plan_id text not null references public.catalogue_plans(id) on delete cascade,
  addon_id text not null references public.catalogue_addons(id) on delete cascade,
  price bigint not null check (price >= 0),
  billing_period text not null check (billing_period in ('annual', 'monthly', 'per_credit')),
  source_id text not null references public.catalogue_sources(id),
  primary key (plan_id, addon_id)
);

-- 18. Plan/Add-On Compatibility
-- The store's tick/cross matrix. A pack can be allowed on a plan but have no
-- price in the capture; keeping compatibility separate from price lets the
-- engine say "allowed but unpriced" instead of guessing.
create table if not exists public.catalogue_plan_addon_compat (
  plan_id text not null references public.catalogue_plans(id) on delete cascade,
  addon_id text not null references public.catalogue_addons(id) on delete cascade,
  allowed boolean not null,
  source_id text not null references public.catalogue_sources(id),
  primary key (plan_id, addon_id)
);

-- 19. Feature Matrix (non-billable plan features from the store comparison)
create table if not exists public.catalogue_feature_matrix (
  plan_id text not null references public.catalogue_plans(id) on delete cascade,
  feature_key text not null,
  feature_label text not null,
  -- Verbatim cell text, e.g. "40 / per day / per monitor" or "16 locations".
  value_raw text not null,
  value_kind text not null check (value_kind in ('boolean', 'count', 'text')),
  -- Populated only when value_raw carries an unambiguous number, so the engine
  -- never re-parses display strings.
  value_number bigint,
  source_id text not null references public.catalogue_sources(id),
  display_order integer not null default 0,
  primary key (plan_id, feature_key)
);

-- Catalogue indexes
create index if not exists idx_catalogue_sources_version on public.catalogue_sources(catalogue_version_id);
create index if not exists idx_catalogue_families_version on public.catalogue_plan_families(catalogue_version_id);
create index if not exists idx_catalogue_plans_version on public.catalogue_plans(catalogue_version_id);
create index if not exists idx_catalogue_plan_family_members_family on public.catalogue_plan_family_members(family_id);
create index if not exists idx_catalogue_addons_version on public.catalogue_addons(catalogue_version_id);
create index if not exists idx_catalogue_addon_grants_unit on public.catalogue_addon_grants(unit);
create index if not exists idx_catalogue_plan_addon_prices_addon on public.catalogue_plan_addon_prices(addon_id);
create index if not exists idx_catalogue_plan_entitlements_unit on public.catalogue_plan_entitlements(unit);
-- Exactly one active catalogue per market and currency.
create unique index if not exists idx_catalogue_versions_one_active
  on public.catalogue_versions(market, currency)
  where status = 'active';

-- Catalogue RLS
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

-- ==============================================================================
-- ACCESS POLICIES
-- ==============================================================================
-- Full access for the backend service role and for anon clients holding the
-- API key, matching the original policy set.
--
-- Postgres has no "create policy if not exists", so each policy is dropped
-- first. That makes this whole file safe to re-run against a database that was
-- already seeded with an earlier version of the schema -- which matters, since
-- the catalogue tables above were added after the first seven tables had
-- already been created.
-- ==============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    -- original tables
    'email_threads', 'email_messages', 'requirement_profiles', 'quotes',
    'deliveries', 'ai_decisions', 'processed_messages',
    -- catalogue tables
    'catalogue_versions', 'catalogue_sources', 'catalogue_units',
    'catalogue_plan_families', 'catalogue_plans', 'catalogue_plan_family_members',
    'catalogue_plan_entitlements', 'catalogue_addons', 'catalogue_addon_grants',
    'catalogue_plan_addon_prices', 'catalogue_plan_addon_compat',
    'catalogue_feature_matrix'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'Allow all access to ' || t, t);
    execute format(
      'create policy %I on public.%I for all using (true) with check (true)',
      'Allow all access to ' || t, t
    );
  end loop;
end $$;
