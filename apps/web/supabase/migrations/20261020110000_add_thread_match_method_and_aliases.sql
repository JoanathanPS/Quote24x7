-- Migration: Persist thread_match_method on inbound + durable message_id_aliases.
--
-- Goal: stay on one Gmail thread per buyer conversation across multi-turn email
-- exchanges. The runtime already resolves an inbound to a thread via
-- In-Reply-To/References (header chain), sender+subject (30d), or
-- awaiting_reply (7d), and already records threadMatchMethod on the in-memory
-- EmailMessage. This migration makes both pieces durable so the resolution
-- works across server restarts, multi-region deployments, and Supabase-only
-- mode (no in-process SessionStore).
--
-- Schema changes:
--   1. public.email_messages.thread_match_method  — record the resolution
--      path on every inbound message. Allowed values match the in-memory
--      ThreadMatchMethod type:
--        new | in_reply_to | alias | subject_fallback | awaiting_reply
--      Outbound messages leave it NULL.
--
--   2. public.message_id_aliases — durable map from any Message-ID the buyer
--      (or their mail client) echoes back, to the original outbound's real RFC
--      Message-ID. This is the truth table for alias fallback: when a buyer's
--      client changes headers, the alias still resolves the inbound to the
--      same thread.
--
-- RLS: same policy posture as the rest of the schema — RLS on, no permissive
-- policies. Only the service-role backend reads/writes these rows.

-- 1. email_messages.thread_match_method
alter table public.email_messages
  add column if not exists thread_match_method text
    check (thread_match_method in (
      'new', 'in_reply_to', 'alias', 'subject_fallback', 'awaiting_reply'
    ));

create index if not exists idx_email_messages_thread_match_method
  on public.email_messages(thread_id, occurred_at desc)
  where thread_match_method is not null;

-- 2. message_id_aliases
create table if not exists public.message_id_aliases (
  id uuid primary key default gen_random_uuid(),
  alias_message_id text not null,           -- any id we received (client-echoed or forwarded)
  canonical_message_id text not null,       -- the real RFC id we sent out
  thread_id text not null references public.email_threads(id) on delete cascade,
  source text not null default 'auto'
    check (source in ('auto', 'manual')),
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count integer not null default 1,
  constraint uq_message_id_aliases_alias unique (alias_message_id)
);

-- An alias always points to exactly one canonical id and one thread, so
-- lookup-by-alias and lookup-by-canonical are both O(log n) with their indexes.
create index if not exists idx_message_id_aliases_canonical
  on public.message_id_aliases(canonical_message_id);
create index if not exists idx_message_id_aliases_thread
  on public.message_id_aliases(thread_id);

alter table public.message_id_aliases enable row level security;

-- Idempotency for the migration itself: re-running is safe.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'idx_message_id_aliases_thread'
  ) then
    raise notice 'message_id_aliases indexes are present.';
  end if;
end $$;
