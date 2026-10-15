import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAppConfig } from "../config.ts";
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
 */
export function getSupabaseClient(): SupabaseClient | null {
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
  };
}

export function rowToThread(r: Record<string, unknown>): EmailThread {
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
  };
}

export function rowToAiDecision(r: Record<string, unknown>): AiDecisionRecord {
  return {
    id: String(r.id),
    threadId: String(r.thread_id),
    profileId: r.profile_id ? String(r.profile_id) : null,
    createdAt: String(r.created_at || new Date().toISOString()),
    source: (r.source as AiDecisionRecord["source"]) || "rules",
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
      const rows = state.threads.map(threadToRow);
      await supabase.from("email_threads").upsert(rows);
    }

    if (state.profiles.length > 0) {
      const rows = state.profiles.map(([, p]) => profileToRow(p));
      await supabase.from("requirement_profiles").upsert(rows);
    }

    if (state.quotes.length > 0) {
      const rows = state.quotes.map(([, q]) => quoteToRow(q));
      await supabase.from("quotes").upsert(rows);
    }

    if (state.messages.length > 0) {
      const rows = state.messages.map(messageToRow);
      await supabase.from("email_messages").upsert(rows);
    }

    if (state.deliveries.length > 0) {
      const rows = state.deliveries.map(deliveryToRow);
      await supabase.from("deliveries").upsert(rows);
    }

    if (state.aiDecisions.length > 0) {
      const rows = state.aiDecisions.map(aiDecisionToRow);
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
// Fire-and-forget background mutations for write paths
// ---------------------------------------------------------------------------

export async function upsertThreadToSupabase(thread: EmailThread): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    await supabase.from("email_threads").upsert(threadToRow(thread));
  } catch (err) {
    console.warn(`[supabase] Failed to upsert thread ${thread.id}:`, err);
  }
}

export async function insertMessageToSupabase(message: EmailMessage): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    await supabase.from("email_messages").upsert(messageToRow(message));
  } catch (err) {
    console.warn(`[supabase] Failed to insert message ${message.id}:`, err);
  }
}

export async function upsertProfileToSupabase(profile: RequirementProfile): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    await supabase.from("requirement_profiles").upsert(profileToRow(profile));
  } catch (err) {
    console.warn(`[supabase] Failed to upsert profile ${profile.id}:`, err);
  }
}

export async function upsertQuoteToSupabase(quote: Quote): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    await supabase.from("quotes").upsert(quoteToRow(quote));
  } catch (err) {
    console.warn(`[supabase] Failed to upsert quote ${quote.id}:`, err);
  }
}

export async function upsertDeliveryToSupabase(delivery: DeliveryRecord): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    await supabase.from("deliveries").upsert(deliveryToRow(delivery));
  } catch (err) {
    console.warn(`[supabase] Failed to upsert delivery ${delivery.id}:`, err);
  }
}

export async function insertAiDecisionToSupabase(decision: AiDecisionRecord): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    await supabase.from("ai_decisions").upsert(aiDecisionToRow(decision));
  } catch (err) {
    console.warn(`[supabase] Failed to insert AI decision ${decision.id}:`, err);
  }
}

export async function insertProcessedMessageToSupabase(providerMessageId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    await supabase.from("processed_messages").upsert({ provider_message_id: providerMessageId });
  } catch (err) {
    console.warn(`[supabase] Failed to record processed message ${providerMessageId}:`, err);
  }
}
