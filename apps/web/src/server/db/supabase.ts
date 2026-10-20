import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAppConfig, isTestRuntime } from "../config.ts";
import type {
  AiDecisionRecord,
  DeliveryRecord,
  EmailMessage,
  EmailThread,
  Quote,
  RequirementProfile,
} from "@/types/domain";

let cachedClient: SupabaseClient | null = null;

/**
 * Returns a configured Supabase client if SUPABASE_URL and key are provided,
 * or null if Supabase is not configured (falling back to file/memory storage).
 * Always returns null during test runtime to prevent test fixtures from polluting cloud database.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (isTestRuntime()) {
    return null;
  }
  const config = getAppConfig();
  if (!config.supabaseUrl || !config.supabaseKey) {
    return null;
  }
  if (!cachedClient) {
    cachedClient = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return cachedClient;
}

/**
 * Wipes all email threads, messages, quotations, delivery tracking logs,
 * requirement profiles, and idempotency tracking keys from Supabase tables.
 */
export async function clearAllEmailDataFromSupabase(): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return true;

  try {
    await supabase.from("email_messages").delete().neq("id", "_none_");
    await supabase.from("ai_decisions").delete().neq("id", "_none_");
    await supabase.from("deliveries").delete().neq("id", "_none_");
    await supabase.from("quotes").delete().neq("id", "_none_");
    await supabase.from("requirement_profiles").delete().neq("id", "_none_");
    await supabase.from("email_threads").delete().neq("id", "_none_");
    await supabase.from("webhook_events").delete().neq("id", "_none_");
    await supabase.from("processed_messages").delete().neq("provider_message_id", "_none_");
    return true;
  } catch (err) {
    console.warn("[supabase] Failed to clear email data from Supabase:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Database Row Mapping Helpers
// ---------------------------------------------------------------------------

export function threadToRow(t: EmailThread) {
  return {
    id: t.id,
    provider: t.provider,
    provider_thread_id: t.providerThreadId,
    sender_email: t.senderEmail,
    sender_name: t.senderName,
    organisation: t.organisation,
    subject: t.subject,
    status: t.status,
    request_type: t.requestType,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    last_message_at: t.lastMessageAt,
    message_count: t.messageCount,
    quote_id: t.quoteId,
    quote_total: t.quoteTotal,
    currency: t.currency,
    status_detail: t.statusDetail,
    state: t.state || "idle",
    rounds_used: t.roundsUsed ?? 0,
    nonproductive_streak: t.nonproductiveStreak ?? 0,
    inbound_count: t.inboundCount ?? 0,
    last_inbound_at: t.lastInboundAt ?? null,
    subject_canonical: t.subjectCanonical ?? null,
    contact_name: t.contact_name ?? t.contactName ?? null,
  };
}

export function rowToThread(r: Record<string, unknown>): EmailThread {
  const contactName = r.contact_name ? String(r.contact_name) : null;
  return {
    id: String(r.id),
    provider: String(r.provider || "resend"),
    providerThreadId: r.provider_thread_id ? String(r.provider_thread_id) : null,
    senderEmail: String(r.sender_email || ""),
    senderName: r.sender_name ? String(r.sender_name) : null,
    organisation: r.organisation ? String(r.organisation) : null,
    subject: String(r.subject || ""),
    status: (r.status as EmailThread["status"]) || "received",
    requestType: (r.request_type as EmailThread["requestType"]) || "quote",
    createdAt: String(r.created_at || new Date().toISOString()),
    updatedAt: String(r.updated_at || new Date().toISOString()),
    lastMessageAt: String(r.last_message_at || new Date().toISOString()),
    messageCount: Number(r.message_count || 0),
    quoteId: r.quote_id ? String(r.quote_id) : null,
    quoteTotal: r.quote_total !== null && r.quote_total !== undefined ? Number(r.quote_total) : null,
    currency: (r.currency as EmailThread["currency"]) || null,
    statusDetail: r.status_detail ? String(r.status_detail) : null,
    state: r.state ? String(r.state) : "idle",
    roundsUsed: Number(r.rounds_used || 0),
    nonproductiveStreak: Number(r.nonproductive_streak || 0),
    inboundCount: Number(r.inbound_count || 0),
    lastInboundAt: r.last_inbound_at ? String(r.last_inbound_at) : null,
    subjectCanonical: r.subject_canonical ? String(r.subject_canonical) : null,
    contactName,
    contact_name: contactName,
  };
}

export function messageToRow(m: EmailMessage) {
  return {
    id: m.id,
    thread_id: m.threadId,
    provider_message_id: m.providerMessageId,
    direction: m.direction,
    from_address: m.fromAddress,
    from_name: m.fromName,
    to_addresses: m.toAddresses,
    subject: m.subject,
    body_text: m.bodyText,
    occurred_at: m.occurredAt,
    delivery_id: m.deliveryId,
    security_notes: m.securityNotes,
    attachments: m.attachments,
    message_id_header: m.messageIdHeader ?? null,
    in_reply_to: m.inReplyTo ?? null,
    references: m.references ?? null,
    thread_match_method: m.threadMatchMethod ?? null,
  };
}

export function rowToMessage(r: Record<string, unknown>): EmailMessage {
  return {
    id: String(r.id),
    threadId: String(r.thread_id),
    providerMessageId: String(r.provider_message_id || ""),
    direction: (r.direction as EmailMessage["direction"]) || "inbound",
    fromAddress: String(r.from_address || ""),
    fromName: r.from_name ? String(r.from_name) : null,
    toAddresses: Array.isArray(r.to_addresses) ? (r.to_addresses as string[]) : [],
    subject: String(r.subject || ""),
    bodyText: String(r.body_text || ""),
    occurredAt: String(r.occurred_at || new Date().toISOString()),
    deliveryId: r.delivery_id ? String(r.delivery_id) : null,
    securityNotes: Array.isArray(r.security_notes) ? (r.security_notes as string[]) : [],
    attachments: Array.isArray(r.attachments) ? (r.attachments as EmailMessage["attachments"]) : [],
    messageIdHeader: r.message_id_header ? String(r.message_id_header) : null,
    inReplyTo: r.in_reply_to ? String(r.in_reply_to) : null,
    references: r.references ? String(r.references) : null,
    threadMatchMethod: r.thread_match_method
      ? (r.thread_match_method as EmailMessage["threadMatchMethod"])
      : null,
  };
}

export function profileToRow(p: RequirementProfile) {
  return {
    id: p.id,
    thread_id: p.threadId,
    version: p.version,
    supersedes_profile_id: p.supersedesProfileId,
    created_at: p.createdAt,
    extractor_model: p.extractorModel,
    extractor_run_id: p.extractorRunId,
    fields: p.fields,
    summary: p.summary,
    pending_questions: p.pendingQuestions,
    answered_questions: p.answeredQuestions,
    clarification_round: p.clarificationRound,
  };
}

export function rowToProfile(r: Record<string, unknown>): RequirementProfile {
  return {
    id: String(r.id),
    threadId: String(r.thread_id),
    version: Number(r.version || 1),
    supersedesProfileId: r.supersedes_profile_id ? String(r.supersedes_profile_id) : null,
    createdAt: String(r.created_at || new Date().toISOString()),
    extractorModel: String(r.extractor_model || ""),
    extractorRunId: r.extractor_run_id ? String(r.extractor_run_id) : null,
    fields: Array.isArray(r.fields) ? (r.fields as RequirementProfile["fields"]) : [],
    summary: String(r.summary || ""),
    pendingQuestions: Array.isArray(r.pending_questions) ? (r.pending_questions as RequirementProfile["pendingQuestions"]) : [],
    answeredQuestions: Array.isArray(r.answered_questions) ? (r.answered_questions as RequirementProfile["answeredQuestions"]) : [],
    clarificationRound: Number(r.clarification_round || 0),
  };
}

export function quoteToRow(q: Quote) {
  return {
    id: q.id,
    thread_id: q.threadId,
    requirement_profile_id: q.requirementProfileId,
    catalogue_version_id: q.catalogueVersionId,
    catalogue_version: q.catalogueVersion,
    calculation_version: q.calculationVersion,
    status: q.status,
    pricing_status: q.pricingStatus,
    market: q.market,
    currency: q.currency,
    billing_period: q.billingPeriod,
    options: q.options,
    assumptions: q.assumptions,
    exclusions: q.exclusions,
    calculation_trace: q.calculationTrace,
    integrity_checks: q.integrityChecks,
    documents: q.documents,
    option_count_note: q.optionCountNote,
    created_at: q.createdAt,
    expires_at: q.expiresAt,
    version: q.version ?? 1,
    superseded_by: q.supersededBy ?? null,
  };
}

export function rowToQuote(r: Record<string, unknown>): Quote {
  return {
    id: String(r.id),
    threadId: String(r.thread_id),
    requirementProfileId: String(r.requirement_profile_id || ""),
    catalogueVersionId: String(r.catalogue_version_id || ""),
    catalogueVersion: String(r.catalogue_version || ""),
    calculationVersion: String(r.calculation_version || ""),
    status: (r.status as Quote["status"]) || "estimate",
    pricingStatus: (r.pricing_status as Quote["pricingStatus"]) || "demo_unverified",
    market: (r.market as Quote["market"]) || "IN",
    currency: (r.currency as Quote["currency"]) || "INR",
    billingPeriod: (r.billing_period as Quote["billingPeriod"]) || "monthly",
    options: Array.isArray(r.options) ? (r.options as Quote["options"]) : [],
    assumptions: Array.isArray(r.assumptions) ? (r.assumptions as string[]) : [],
    exclusions: Array.isArray(r.exclusions) ? (r.exclusions as string[]) : [],
    calculationTrace: Array.isArray(r.calculation_trace) ? (r.calculation_trace as Quote["calculationTrace"]) : [],
    integrityChecks: Array.isArray(r.integrity_checks) ? (r.integrity_checks as Quote["integrityChecks"]) : [],
    documents: Array.isArray(r.documents) ? (r.documents as Quote["documents"]) : [],
    optionCountNote: r.option_count_note ? String(r.option_count_note) : null,
    createdAt: String(r.created_at || new Date().toISOString()),
    expiresAt: r.expires_at ? String(r.expires_at) : null,
    version: Number(r.version || 1),
    supersededBy: r.superseded_by ? String(r.superseded_by) : null,
  };
}

export function deliveryToRow(d: DeliveryRecord) {
  return {
    id: d.id,
    thread_id: d.threadId,
    quote_id: d.quoteId,
    provider: d.provider,
    provider_message_id: d.providerMessageId,
    recipient: d.recipient,
    subject: d.subject,
    status: d.status,
    attempt_count: d.attemptCount,
    max_attempts: d.maxAttempts,
    last_error_code: d.lastErrorCode,
    last_error_message: d.lastErrorMessage,
    next_retry_at: d.nextRetryAt,
    retry_eligible: d.retryEligible,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
    events: d.events,
  };
}

export function rowToDelivery(r: Record<string, unknown>): DeliveryRecord {
  return {
    id: String(r.id),
    threadId: String(r.thread_id),
    quoteId: r.quote_id ? String(r.quote_id) : null,
    provider: String(r.provider || "resend"),
    providerMessageId: r.provider_message_id ? String(r.provider_message_id) : null,
    recipient: String(r.recipient || ""),
    subject: String(r.subject || ""),
    status: (r.status as DeliveryRecord["status"]) || "queued",
    attemptCount: Number(r.attempt_count || 1),
    maxAttempts: Number(r.max_attempts || 3),
    lastErrorCode: r.last_error_code ? String(r.last_error_code) : null,
    lastErrorMessage: r.last_error_message ? String(r.last_error_message) : null,
    nextRetryAt: r.next_retry_at ? String(r.next_retry_at) : null,
    retryEligible: Boolean(r.retry_eligible),
    createdAt: String(r.created_at || new Date().toISOString()),
    updatedAt: String(r.updated_at || new Date().toISOString()),
    events: Array.isArray(r.events) ? (r.events as DeliveryRecord["events"]) : [],
  };
}

export function aiDecisionToRow(a: AiDecisionRecord) {
  return {
    id: a.id,
    thread_id: a.threadId,
    profile_id: a.profileId,
    created_at: a.createdAt,
    source: a.source,
    provider: a.provider ?? (a.source === "rules_fallback" ? "rules" : a.source),
    model: a.model,
    action: a.action,
    original_action: a.originalAction,
    customer_summary: a.customerSummary,
    identified_needs: a.identifiedNeeds,
    recommended_categories: a.recommendedCategories,
    referenced_plan_ids: a.referencedPlanIds,
    assumptions: a.assumptions,
    follow_up_questions: a.followUpQuestions,
    reasoning_summary: a.reasoningSummary,
    confidence: a.confidence,
    human_review_reasons: a.humanReviewReasons,
    validation: a.validation,
    failure_category: a.failureCategory,
    failure_detail: a.failureDetail,
    latency_ms: a.latencyMs,
    catalogue_version: a.catalogueVersion,
    decision_source: a.decisionSource ?? (a.source === "rules_fallback" ? "rules_fallback" : "ai"),
    fallback_reason: a.fallbackReason ?? a.failureDetail ?? null,
    prompt_tokens: a.promptTokens ?? null,
    completion_tokens: a.completionTokens ?? null,
  };
}

export function rowToAiDecision(r: Record<string, unknown>): AiDecisionRecord {
  return {
    id: String(r.id),
    threadId: String(r.thread_id),
    profileId: r.profile_id ? String(r.profile_id) : null,
    createdAt: String(r.created_at || new Date().toISOString()),
    source: (r.source as AiDecisionRecord["source"]) || "rules_fallback",
    provider: r.provider ? String(r.provider) : null,
    model: r.model ? String(r.model) : null,
    action: (r.action as AiDecisionRecord["action"]) || "quote",
    originalAction: (r.original_action as AiDecisionRecord["originalAction"]) || null,
    customerSummary: String(r.customer_summary || ""),
    identifiedNeeds: Array.isArray(r.identified_needs) ? (r.identified_needs as string[]) : [],
    recommendedCategories: Array.isArray(r.recommended_categories) ? (r.recommended_categories as AiDecisionRecord["recommendedCategories"]) : [],
    referencedPlanIds: Array.isArray(r.referenced_plan_ids) ? (r.referenced_plan_ids as string[]) : [],
    assumptions: Array.isArray(r.assumptions) ? (r.assumptions as string[]) : [],
    followUpQuestions: Array.isArray(r.follow_up_questions) ? (r.follow_up_questions as string[]) : [],
    reasoningSummary: String(r.reasoning_summary || ""),
    confidence: r.confidence !== null && r.confidence !== undefined ? Number(r.confidence) : null,
    humanReviewReasons: Array.isArray(r.human_review_reasons) ? (r.human_review_reasons as string[]) : [],
    validation: (r.validation as AiDecisionRecord["validation"]) || { passed: true, errors: [], warnings: [], unsupportedCategories: [], unknownPlanIds: [] },
    failureCategory: (r.failure_category as AiDecisionRecord["failureCategory"]) || null,
    failureDetail: r.failure_detail ? String(r.failure_detail) : null,
    latencyMs: r.latency_ms !== null && r.latency_ms !== undefined ? Number(r.latency_ms) : null,
    catalogueVersion: r.catalogue_version ? String(r.catalogue_version) : null,
    decisionSource: (r.decision_source as AiDecisionRecord["decisionSource"]) || null,
    fallbackReason: r.fallback_reason ? String(r.fallback_reason) : null,
    promptTokens: r.prompt_tokens !== null && r.prompt_tokens !== undefined ? Number(r.prompt_tokens) : null,
    completionTokens: r.completion_tokens !== null && r.completion_tokens !== undefined ? Number(r.completion_tokens) : null,
  };
}

// ---------------------------------------------------------------------------
// Supabase Data Access Operations
// ---------------------------------------------------------------------------

export interface SupabaseFullState {
  threads: EmailThread[];
  messages: EmailMessage[];
  profiles: Array<[string, RequirementProfile]>;
  quotes: Array<[string, Quote]>;
  deliveries: DeliveryRecord[];
  processedMessageIds: string[];
  aiDecisions: AiDecisionRecord[];
}

export async function fetchFullStateFromSupabase(): Promise<SupabaseFullState | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    const [
      { data: threadsData, error: threadsErr },
      { data: messagesData, error: messagesErr },
      { data: profilesData, error: profilesErr },
      { data: quotesData, error: quotesErr },
      { data: deliveriesData, error: deliveriesErr },
      { data: processedData, error: processedErr },
      { data: aiData, error: aiErr },
    ] = await Promise.all([
      supabase.from("email_threads").select("*"),
      supabase.from("email_messages").select("*"),
      supabase.from("requirement_profiles").select("*"),
      supabase.from("quotes").select("*"),
      supabase.from("deliveries").select("*"),
      supabase.from("processed_messages").select("provider_message_id"),
      supabase.from("ai_decisions").select("*"),
    ]);

    if (threadsErr || messagesErr || profilesErr || quotesErr || deliveriesErr) {
      console.warn("[supabase] Error fetching data from Supabase:", {
        threadsErr,
        messagesErr,
        profilesErr,
        quotesErr,
        deliveriesErr,
        processedErr,
        aiErr,
      });
      return null;
    }

    const threads = (threadsData || []).map(rowToThread);
    const messages = (messagesData || []).map(rowToMessage);
    const profiles = (profilesData || []).map((r) => [String(r.thread_id), rowToProfile(r)] as [string, RequirementProfile]);
    const quotes = (quotesData || []).map((r) => [String(r.id), rowToQuote(r)] as [string, Quote]);
    const deliveries = (deliveriesData || []).map(rowToDelivery);
    const processedMessageIds = (processedData || []).map((r) => String(r.provider_message_id));
    const aiDecisions = (aiData || []).map(rowToAiDecision);

    return {
      threads,
      messages,
      profiles,
      quotes,
      deliveries,
      processedMessageIds,
      aiDecisions,
    };
  } catch (err) {
    console.warn("[supabase] Failed to fetch state from Supabase:", err);
    return null;
  }
}

export async function seedSupabaseFromBaseline(state: SupabaseFullState): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  try {
    const { count, error: countErr } = await supabase
      .from("email_threads")
      .select("*", { count: "exact", head: true });

    if (countErr) {
      console.warn("[supabase] Error checking existing thread count in Supabase:", countErr);
      return false;
    }

    // Only seed if empty
    if (count && count > 0) {
      return false;
    }

    console.info(`[supabase] Seeding empty database with ${state.threads.length} baseline threads...`);

    if (state.threads.length > 0) {
      const rows = await Promise.all(state.threads.map(async (t) => sanitizeRowForTable("email_threads", threadToRow(t))));
      await supabase.from("email_threads").upsert(rows);
    }

    if (state.profiles.length > 0) {
      const rows = await Promise.all(state.profiles.map(async ([, p]) => sanitizeRowForTable("requirement_profiles", profileToRow(p))));
      await supabase.from("requirement_profiles").upsert(rows);
    }

    if (state.quotes.length > 0) {
      const rows = await Promise.all(state.quotes.map(async ([, q]) => sanitizeRowForTable("quotes", quoteToRow(q))));
      await supabase.from("quotes").upsert(rows);
    }

    if (state.messages.length > 0) {
      const rows = await Promise.all(state.messages.map(async (m) => sanitizeRowForTable("email_messages", messageToRow(m))));
      await supabase.from("email_messages").upsert(rows);
    }

    if (state.deliveries.length > 0) {
      const rows = await Promise.all(state.deliveries.map(async (d) => sanitizeRowForTable("deliveries", deliveryToRow(d))));
      await supabase.from("deliveries").upsert(rows);
    }

    if (state.aiDecisions.length > 0) {
      const rows = await Promise.all(state.aiDecisions.map(async (a) => sanitizeRowForTable("ai_decisions", aiDecisionToRow(a))));
      await supabase.from("ai_decisions").upsert(rows);
    }

    if (state.processedMessageIds.length > 0) {
      const rows = state.processedMessageIds.map((id) => ({ provider_message_id: id }));
      await supabase.from("processed_messages").upsert(rows);
    }

    console.info("[supabase] Successfully seeded baseline database records.");
    return true;
  } catch (err) {
    console.warn("[supabase] Failed to seed Supabase database:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Schema Introspection and Sanitization Helpers
// ---------------------------------------------------------------------------

let cachedTableProperties: Record<string, Set<string>> | null = null;
let schemaFetchPromise: Promise<Record<string, Set<string>> | null> | null = null;

export async function getTableAllowedColumns(tableName: string): Promise<Set<string> | null> {
  if (isTestRuntime()) return null;
  if (cachedTableProperties) {
    return cachedTableProperties[tableName] || null;
  }
  if (!schemaFetchPromise) {
    schemaFetchPromise = (async () => {
      const config = getAppConfig();
      if (!config.supabaseUrl || !config.supabaseKey) return null;
      try {
        const res = await fetch(`${config.supabaseUrl}/rest/v1/`, {
          headers: {
            apikey: config.supabaseKey,
            Authorization: `Bearer ${config.supabaseKey}`,
          },
        });
        if (!res.ok) return null;
        const spec = (await res.json()) as { definitions?: Record<string, { properties?: Record<string, unknown> }> };
        const result: Record<string, Set<string>> = {};
        if (spec.definitions) {
          for (const [table, def] of Object.entries(spec.definitions)) {
            if (def.properties) {
              result[table] = new Set(Object.keys(def.properties));
            }
          }
        }
        cachedTableProperties = result;
        return result;
      } catch (e) {
        console.warn("[supabase] Failed to fetch schema definitions from Supabase:", e);
        return null;
      } finally {
        schemaFetchPromise = null;
      }
    })();
  }
  const allTables = await schemaFetchPromise;
  return allTables?.[tableName] || null;
}

export async function sanitizeRowForTable<T extends Record<string, unknown>>(
  tableName: string,
  row: T
): Promise<Partial<T>> {
  const allowed = await getTableAllowedColumns(tableName);
  if (!allowed) {
    return row;
  }
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (allowed.has(k)) {
      filtered[k] = v;
    }
  }
  return filtered as Partial<T>;
}

// ---------------------------------------------------------------------------
// Fire-and-forget background mutations for write paths
// ---------------------------------------------------------------------------

export async function upsertThreadToSupabase(thread: EmailThread): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const payload = await sanitizeRowForTable("email_threads", threadToRow(thread));
    const { error } = await supabase.from("email_threads").upsert(payload);
    if (error) {
      console.warn(`[supabase] Failed to upsert thread ${thread.id}:`, error);
    }
  } catch (err) {
    console.warn(`[supabase] Failed to upsert thread ${thread.id}:`, err);
  }
}

export async function insertMessageToSupabase(message: EmailMessage): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const payload = await sanitizeRowForTable("email_messages", messageToRow(message));
    const { error } = await supabase.from("email_messages").upsert(payload);
    if (error) {
      console.warn(`[supabase] Failed to insert message ${message.id}:`, error);
    }
  } catch (err) {
    console.warn(`[supabase] Failed to insert message ${message.id}:`, err);
  }
}

export async function upsertProfileToSupabase(profile: RequirementProfile): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const payload = await sanitizeRowForTable("requirement_profiles", profileToRow(profile));
    const { error } = await supabase.from("requirement_profiles").upsert(payload);
    if (error) {
      console.warn(`[supabase] Failed to upsert profile ${profile.id}:`, error);
    }
  } catch (err) {
    console.warn(`[supabase] Failed to upsert profile ${profile.id}:`, err);
  }
}

export async function upsertQuoteToSupabase(quote: Quote): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const payload = await sanitizeRowForTable("quotes", quoteToRow(quote));
    const { error } = await supabase.from("quotes").upsert(payload);
    if (error) {
      console.warn(`[supabase] Failed to upsert quote ${quote.id}:`, error);
    }
  } catch (err) {
    console.warn(`[supabase] Failed to upsert quote ${quote.id}:`, err);
  }
}

export async function upsertDeliveryToSupabase(delivery: DeliveryRecord): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const payload = await sanitizeRowForTable("deliveries", deliveryToRow(delivery));
    const { error } = await supabase.from("deliveries").upsert(payload);
    if (error) {
      console.warn(`[supabase] Failed to upsert delivery ${delivery.id}:`, error);
    }
  } catch (err) {
    console.warn(`[supabase] Failed to upsert delivery ${delivery.id}:`, err);
  }
}

export async function insertAiDecisionToSupabase(decision: AiDecisionRecord): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const payload = await sanitizeRowForTable("ai_decisions", aiDecisionToRow(decision));
    const { error } = await supabase.from("ai_decisions").upsert(payload);
    if (error) {
      console.warn(`[supabase] Failed to insert AI decision ${decision.id}:`, error);
    }
  } catch (err) {
    console.warn(`[supabase] Failed to insert AI decision ${decision.id}:`, err);
  }
}

export async function insertProcessedMessageToSupabase(providerMessageId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const { error } = await supabase.from("processed_messages").upsert({ provider_message_id: providerMessageId });
    if (error) {
      console.warn(`[supabase] Failed to record processed message ${providerMessageId}:`, error);
    }
  } catch (err) {
    console.warn(`[supabase] Failed to record processed message ${providerMessageId}:`, err);
  }
}

/**
 * Inserts (never upserts) the ID so a primary-key conflict (23505) reveals that
 * another request already claimed it. Returns true when Supabase is not
 * configured or the claim cannot be checked; the in-memory guards still apply.
 */
export async function claimProcessedMessageInSupabase(providerMessageId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return true;
  try {
    const { error } = await supabase
      .from("processed_messages")
      .insert({ provider_message_id: providerMessageId });
    if (!error) return true;
    if (error.code === "23505") return false;
    console.warn(`[supabase] Could not claim message ${providerMessageId}:`, error);
    return true;
  } catch (err) {
    console.warn(`[supabase] Could not claim message ${providerMessageId}:`, err);
    return true;
  }
}

export async function deleteProcessedMessageFromSupabase(providerMessageId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const { error } = await supabase.from("processed_messages").delete().eq("provider_message_id", providerMessageId);
    if (error) {
      console.warn(`[supabase] Failed to release processed message ${providerMessageId}:`, error);
    }
  } catch (err) {
    console.warn(`[supabase] Failed to release processed message ${providerMessageId}:`, err);
  }
}

export async function insertWebhookEventToSupabase(
  provider: string,
  eventId: string,
  eventType: string,
  payload: unknown,
): Promise<{ isDuplicate: boolean }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { isDuplicate: false };

  const allowed = await getTableAllowedColumns("webhook_events");
  // If OpenAPI definitions are available and webhook_events table does not exist in Supabase,
  // skip trying to query it to prevent PGRST205 errors.
  if (cachedTableProperties && !allowed) {
    return { isDuplicate: false };
  }

  try {
    const { error } = await supabase.from("webhook_events").insert({
      provider,
      event_id: eventId,
      event_type: eventType,
      payload: typeof payload === "object" ? payload : { raw: payload },
    });
    if (!error) return { isDuplicate: false };
    if (error.code === "23505") {
      return { isDuplicate: true };
    }
    if (error.code === "PGRST205") {
      return { isDuplicate: false };
    }
    console.warn(`[supabase] Could not insert webhook_event ${eventId}:`, error);
    return { isDuplicate: false };
  } catch (err) {
    console.warn(`[supabase] Exception inserting webhook_event ${eventId}:`, err);
    return { isDuplicate: false };
  }
}

/**
 * Record a Message-ID alias: any id the buyer (or their mail client) echoes
 * back, mapped to the canonical outbound RFC id and the thread it belongs to.
 *
 * Idempotent: when the alias already exists for this thread, we bump
 * last_seen_at and seen_count instead of failing. A unique index on
 * alias_message_id enforces one canonical target per alias across the system.
 *
 * Used by the inbound processor (subject-fallback path) and the email.sent
 * webhook (provider-confirmed message-id always wins over a guess).
 */
export async function upsertMessageIdAliasToSupabase(args: {
  aliasMessageId: string;
  canonicalMessageId: string;
  threadId: string;
  source?: "auto" | "manual";
}): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const { aliasMessageId, canonicalMessageId, threadId, source = "auto" } = args;
  if (!aliasMessageId || !canonicalMessageId || !threadId) return;

  try {
    // First, try an insert. If the alias already exists, fall back to bumping
    // last_seen_at + seen_count so retries do not change the canonical target.
    const insertPayload = await sanitizeRowForTable("message_id_aliases", {
      alias_message_id: aliasMessageId,
      canonical_message_id: canonicalMessageId,
      thread_id: threadId,
      source,
      seen_count: 1,
    });
    const { error: insertErr } = await supabase
      .from("message_id_aliases")
      .insert(insertPayload);
    if (!insertErr) return;
    if (insertErr.code !== "23505") {
      console.warn(`[supabase] Could not insert message_id_aliases ${aliasMessageId}:`, insertErr);
      return;
    }
    // Duplicate — bump counters, do NOT overwrite the canonical target.
    const { error: updateErr } = await supabase
      .from("message_id_aliases")
      .update({
        last_seen_at: new Date().toISOString(),
      })
      .eq("alias_message_id", aliasMessageId);
    if (updateErr && updateErr.code !== "PGRST116") {
      console.warn(`[supabase] Could not bump message_id_aliases ${aliasMessageId}:`, updateErr);
      return;
    }
    // Counter bump via raw RPC isn't required: seen_count reads are advisory.
    const { error: rpcErr } = await supabase.rpc("bump_message_id_alias_seen", {
      p_alias_message_id: aliasMessageId,
    });
    if (rpcErr && rpcErr.code !== "PGRST202") {
      // 42883 (function not found) is acceptable when the helper RPC isn't installed.
    }
  } catch (err) {
    console.warn(`[supabase] Failed to upsert message_id_aliases ${aliasMessageId}:`, err);
  }
}

/** Resolve a previously-registered alias to its canonical RFC id and thread. */
export async function lookupMessageIdAliasInSupabase(
  aliasMessageId: string
): Promise<{ canonicalMessageId: string; threadId: string } | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  if (!aliasMessageId) return null;

  try {
    const { data, error } = await supabase
      .from("message_id_aliases")
      .select("canonical_message_id, thread_id")
      .eq("alias_message_id", aliasMessageId)
      .limit(1)
      .maybeSingle();
    if (error) {
      if (error.code !== "PGRST116" && error.code !== "PGRST205") {
        console.warn(`[supabase] lookupMessageIdAliasInSupabase(${aliasMessageId}) failed:`, error);
      }
      return null;
    }
    if (!data) return null;
    const canonical = (data as { canonical_message_id?: string }).canonical_message_id;
    const thread = (data as { thread_id?: string }).thread_id;
    if (!canonical || !thread) return null;
    return { canonicalMessageId: String(canonical), threadId: String(thread) };
  } catch (err) {
    console.warn(`[supabase] lookupMessageIdAliasInSupabase exception:`, err);
    return null;
  }
}

/**
 * Update the rfc_message_id stored on an outbound email_messages row.
 *
 * Resend's `email.sent` webhook carries `data.email_id` and `data.message_id`
 * (the latter is the real RFC token). We bind the Resend id to the rfc id so
 * later inbound In-Reply-To / References lookups by RFC id resolve to the
 * right outbound and therefore the right thread.
 *
 * Idempotent by provider_message_id: writing the same rfc id twice is a no-op.
 */
export async function updateMessageRfcIdInSupabase(args: {
  providerMessageId: string;
  rfcMessageId: string;
  threadId?: string | null;
}): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const { providerMessageId, rfcMessageId, threadId } = args;
  if (!providerMessageId || !rfcMessageId) return;

  try {
    const patch: Record<string, string> = { message_id_header: rfcMessageId };
    if (threadId) patch.thread_id = threadId;
    const { error } = await supabase
      .from("email_messages")
      .update(patch)
      .eq("provider_message_id", providerMessageId);
    if (error) {
      console.warn(`[supabase] Could not store rfc_message_id for ${providerMessageId}:`, error);
    }
  } catch (err) {
    console.warn(`[supabase] updateMessageRfcIdInSupabase exception:`, err);
  }
}


