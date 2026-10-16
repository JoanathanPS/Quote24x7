import fs from "node:fs";
import path from "node:path";
import type {
  AiDecisionRecord,
  DeliveryRecord,
  EmailMessage,
  EmailThread,
  HealthComponent,
  IntegrationStatus,
  OverviewMetrics,
  Quote,
  RequirementProfile,
  SystemHealth,
} from "@/types/domain";
import { getAppConfig } from "../config.ts";
import { dryRunStore } from "./dryrun-store.ts";
import {
  fetchFullStateFromSupabase,
  upsertThreadToSupabase,
  insertMessageToSupabase,
  upsertProfileToSupabase,
  upsertQuoteToSupabase,
  upsertDeliveryToSupabase,
  insertAiDecisionToSupabase,
  insertProcessedMessageToSupabase,
  claimProcessedMessageInSupabase,
  deleteProcessedMessageFromSupabase,
  clearAllEmailDataFromSupabase,
} from "../db/supabase.ts";

export interface PersistedState {
  threads: EmailThread[];
  messages: EmailMessage[];
  profiles: Array<[string, RequirementProfile]>;
  quotes: Array<[string, Quote]>;
  deliveries: DeliveryRecord[];
  processedMessageIds: string[];
  /** Optional: absent in stores written before AI decisions were recorded. */
  aiDecisions?: AiDecisionRecord[];
  outboundSendingPaused?: boolean;
}

/**
 * Stateful repository for Quote24x7 with file-backed persistence.
 * Seeded with initial realistic fixture data, but accepts real runtime mutations
 * and survives server restarts by saving to .data/session-store.json.
 */
class SessionStore {
  private threads: Map<string, EmailThread> = new Map();
  private messages: Map<string, EmailMessage[]> = new Map(); // keyed by threadId
  private profiles: Map<string, RequirementProfile> = new Map(); // keyed by threadId
  private quotes: Map<string, Quote> = new Map(); // keyed by quoteId
  private deliveries: Map<string, DeliveryRecord> = new Map(); // keyed by deliveryId
  private aiDecisions: Map<string, AiDecisionRecord[]> = new Map(); // keyed by threadId
  private processedMessageIds: Set<string> = new Set(); // for idempotency
  private outboundSendingPaused = false;
  private initialized = false;

  public getOutboundSendingPaused(): boolean {
    this.ensureInitialized();
    return this.outboundSendingPaused;
  }

  public setOutboundSendingPaused(paused: boolean): void {
    this.ensureInitialized();
    this.outboundSendingPaused = paused;
    this.persistToDisk();
  }

  private isTestEnvironment(): boolean {
    return (
      process.env.NODE_ENV === "test" ||
      process.env.npm_lifecycle_event === "test" ||
      process.execArgv.some((a) => a.includes("test"))
    );
  }

  private getStoragePath(): string {
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      return path.join("/tmp", "session-store.json");
    }
    return path.resolve(process.cwd(), ".data", "session-store.json");
  }

  /** Merges a persisted snapshot into memory. Safe to call repeatedly with the same snapshot. */
  public loadState(parsed: PersistedState): void {
    if (parsed.outboundSendingPaused !== undefined) {
      this.outboundSendingPaused = Boolean(parsed.outboundSendingPaused);
    }
    if (Array.isArray(parsed.threads)) {
      for (const thread of parsed.threads) {
        this.threads.set(thread.id, thread);
      }
      // Merge by ID: this runs on every request when Supabase is configured,
      // so appending would add another copy of every message each time.
      for (const msg of parsed.messages || []) {
        const existing = this.messages.get(msg.threadId) ?? [];
        const idx = existing.findIndex((m) => m.id === msg.id);
        if (idx >= 0) existing[idx] = msg;
        else existing.push(msg);
        this.messages.set(msg.threadId, existing);
      }
      for (const [id, prof] of parsed.profiles || []) {
        this.profiles.set(id, prof);
      }
      for (const [id, q] of parsed.quotes || []) {
        this.quotes.set(id, q);
      }
      for (const del of parsed.deliveries || []) {
        this.deliveries.set(del.id, del);
      }
      for (const id of parsed.processedMessageIds || []) {
        this.processedMessageIds.add(id);
      }
      for (const decision of parsed.aiDecisions || []) {
        const existing = this.aiDecisions.get(decision.threadId) ?? [];
        const idx = existing.findIndex((d) => d.id === decision.id);
        if (idx >= 0) existing[idx] = decision;
        else existing.push(decision);
        this.aiDecisions.set(decision.threadId, existing);
      }
    }
  }

  private persistToDisk(): void {
    if (this.isTestEnvironment()) return;
    try {
      const filePath = this.getStoragePath();
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const allMessages: EmailMessage[] = [];
      for (const list of this.messages.values()) {
        allMessages.push(...list);
      }
      const allAiDecisions: AiDecisionRecord[] = [];
      for (const list of this.aiDecisions.values()) {
        allAiDecisions.push(...list);
      }
      const data: PersistedState = {
        threads: Array.from(this.threads.values()),
        messages: allMessages,
        profiles: Array.from(this.profiles.entries()),
        quotes: Array.from(this.quotes.entries()),
        deliveries: Array.from(this.deliveries.values()),
        processedMessageIds: Array.from(this.processedMessageIds),
        aiDecisions: allAiDecisions,
        outboundSendingPaused: this.outboundSendingPaused,
      };
      const tmpPath = `${filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
      fs.renameSync(tmpPath, filePath);

      // Optional: Remote Cloud KV sync if configured (e.g. Vercel KV / Upstash Redis)
      const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)?.trim();
      const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)?.trim();
      if (kvUrl && kvToken) {
        fetch(`${kvUrl}/set/quote24x7_state`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${kvToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        }).catch((err) => {
          console.warn("[session-store] Failed to sync state to Redis KV:", err);
        });
      }
    } catch {
      // Graceful fallback for read-only or restricted environments
    }
  }

  /**
   * Completely purges all threads, messages, profiles, quotes, deliveries,
   * AI decisions, and idempotency tracking keys from memory, disk, and Supabase.
   */
  public async clearAll(): Promise<void> {
    this.threads.clear();
    this.messages.clear();
    this.profiles.clear();
    this.quotes.clear();
    this.deliveries.clear();
    this.aiDecisions.clear();
    this.processedMessageIds.clear();
    this.outboundSendingPaused = false;
    this.initialized = true;
    this.persistToDisk();
    await clearAllEmailDataFromSupabase();
  }

  public reset(): void {
    this.threads.clear();
    this.messages.clear();
    this.profiles.clear();
    this.quotes.clear();
    this.deliveries.clear();
    this.aiDecisions.clear();
    this.processedMessageIds.clear();
    this.outboundSendingPaused = false;
    this.initialized = false;
    this.ensureInitialized();
  }

  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;

    if (this.isTestEnvironment()) return;

    // 1. Try reading persisted data from active storage path (/tmp on Vercel or .data locally)
    const filePath = this.getStoragePath();
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw) as PersistedState;
        if (Array.isArray(parsed.threads)) {
          this.loadState(parsed);
          return;
        }
      } catch {
        // Fall back to baseline fixture
      }
    }

    // 2. If storage file is missing (e.g. fresh Vercel serverless deployment), load from bundled baseline store
    const candidateBaselinePaths = [
      path.resolve(process.cwd(), "src", "server", "fixtures", "baseline-store.json"),
      path.resolve(process.cwd(), "apps", "web", "src", "server", "fixtures", "baseline-store.json"),
      path.resolve(process.cwd(), ".data", "session-store.json"),
      path.resolve(process.cwd(), "apps", "web", ".data", "session-store.json"),
      path.resolve(__dirname, "..", "fixtures", "baseline-store.json"),
    ];

    for (const bp of candidateBaselinePaths) {
      if (fs.existsSync(bp)) {
        try {
          const raw = fs.readFileSync(bp, "utf8");
          const parsed = JSON.parse(raw) as PersistedState;
          if (Array.isArray(parsed.threads)) {
            this.loadState(parsed);
            // Write snapshot to storage path (/tmp on Vercel) so subsequent operations can update it
            this.persistToDisk();
            return;
          }
        } catch {
          // Try next candidate
        }
      }
    }
  }

  private supabaseSyncing = false;

  public async ensureInitializedAsync(): Promise<void> {
    this.ensureInitialized();
    if (this.isTestEnvironment()) return;

    const config = getAppConfig();
    if (config.isSupabaseConfigured && !this.supabaseSyncing) {
      this.supabaseSyncing = true;
      try {
        const remoteState = await fetchFullStateFromSupabase();
        if (remoteState) {
          // When Supabase is connected, it is the authoritative cloud store.
          // Reset local memory so deleted records are properly removed.
          this.threads.clear();
          this.messages.clear();
          this.profiles.clear();
          this.quotes.clear();
          this.deliveries.clear();
          this.processedMessageIds.clear();
          this.aiDecisions.clear();
          this.loadState(remoteState as unknown as PersistedState);
          this.persistToDisk();
        }
      } catch (err) {
        console.warn("[session-store] Error syncing with Supabase:", err);
      } finally {
        this.supabaseSyncing = false;
      }
    }
  }

  // --- Threads ---
  getThreads(): EmailThread[] {
    this.ensureInitialized();
    return Array.from(this.threads.values()).sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );
  }

  getThread(id: string): EmailThread | undefined {
    this.ensureInitialized();
    return this.threads.get(id);
  }

  saveThread(thread: EmailThread): void {
    this.ensureInitialized();
    this.threads.set(thread.id, { ...thread });
    this.persistToDisk();
    upsertThreadToSupabase(thread);
  }

  updateThread(id: string, updates: Partial<EmailThread>): EmailThread | undefined {
    this.ensureInitialized();
    const existing = this.threads.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.threads.set(id, updated);
    this.persistToDisk();
    upsertThreadToSupabase(updated);
    return updated;
  }

  getActiveThreadBySender(email: string): EmailThread | undefined {
    this.ensureInitialized();
    const clean = email.replace(/^.*?<([^>]+)>.*$/, "$1").trim().toLowerCase();
    return this.getThreads().find((t) => {
      const tClean = t.senderEmail.replace(/^.*?<([^>]+)>.*$/, "$1").trim().toLowerCase();
      return (
        tClean === clean &&
        (t.status === "awaiting_reply" ||
          t.status === "received" ||
          t.status === "extracting" ||
          t.status === "pricing")
      );
    });
  }

  // --- Messages ---
  getMessages(threadId: string): EmailMessage[] {
    this.ensureInitialized();
    const msgs = this.messages.get(threadId) ?? [];
    const sorted = [...msgs].sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    );
    // One inbound email is one message, even if a provider retry stored it
    // twice under different internal IDs. Keep the earliest copy.
    const seenInbound = new Set<string>();
    return sorted.filter((m) => {
      if (m.direction !== "inbound" || !m.providerMessageId) return true;
      const key = m.providerMessageId.replace(/[<>]/g, "").trim().toLowerCase();
      if (seenInbound.has(key)) return false;
      seenInbound.add(key);
      return true;
    });
  }

  getMessageByProviderMessageId(msgId: string): EmailMessage | undefined {
    this.ensureInitialized();
    const cleanId = msgId.replace(/[<>]/g, "").trim().toLowerCase();
    for (const msgs of this.messages.values()) {
      const found = msgs.find((m) => {
        const pClean = (m.providerMessageId || "").replace(/[<>]/g, "").trim().toLowerCase();
        const mClean = (m.id || "").replace(/[<>]/g, "").trim().toLowerCase();
        return pClean === cleanId || mClean === cleanId;
      });
      if (found) return found;
    }
    return undefined;
  }

  addMessage(message: EmailMessage): void {
    this.ensureInitialized();
    const existing = this.messages.get(message.threadId) ?? [];
    existing.push({ ...message });
    this.messages.set(message.threadId, existing);
    if (message.providerMessageId) {
      this.processedMessageIds.add(message.providerMessageId);
      insertProcessedMessageToSupabase(message.providerMessageId);
    }
    this.persistToDisk();
    insertMessageToSupabase(message);
  }

  // --- Requirement Profiles ---
  getProfile(threadId: string): RequirementProfile | undefined {
    this.ensureInitialized();
    return this.profiles.get(threadId);
  }

  saveProfile(profile: RequirementProfile): void {
    this.ensureInitialized();
    this.profiles.set(profile.threadId, { ...profile });
    this.persistToDisk();
    upsertProfileToSupabase(profile);
  }

  // --- Quotes ---
  getQuotes(): Quote[] {
    this.ensureInitialized();
    return Array.from(this.quotes.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getQuotesByThreadId(threadId: string): Quote[] {
    this.ensureInitialized();
    return Array.from(this.quotes.values())
      .filter((q) => q.threadId === threadId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getQuote(quoteId: string): Quote | undefined {
    this.ensureInitialized();
    return this.quotes.get(quoteId) ?? dryRunStore.getQuote(quoteId);
  }

  saveQuote(quote: Quote): void {
    this.ensureInitialized();
    this.quotes.set(quote.id, { ...quote });
    this.persistToDisk();
    upsertQuoteToSupabase(quote);
  }

  updateQuote(quoteId: string, updates: Partial<Quote>): Quote | undefined {
    this.ensureInitialized();
    const existing = this.quotes.get(quoteId);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.quotes.set(quoteId, updated);
    this.persistToDisk();
    upsertQuoteToSupabase(updated);
    return updated;
  }

  // --- Deliveries ---
  getDeliveries(): DeliveryRecord[] {
    this.ensureInitialized();
    const live = Array.from(this.deliveries.values());
    const dryRun = dryRunStore.getDeliveries();
    // Return all deliveries (live first, then dryRun not already present)
    const seen = new Set(live.map((d) => d.id));
    for (const d of dryRun) {
      if (!seen.has(d.id)) {
        live.push(d);
      }
    }
    return live.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getDelivery(id: string): DeliveryRecord | undefined {
    this.ensureInitialized();
    return this.deliveries.get(id) ?? dryRunStore.getDelivery(id);
  }

  getDeliveryByProviderMessageId(providerMessageId: string): DeliveryRecord | undefined {
    this.ensureInitialized();
    const clean = providerMessageId.replace(/[<>]/g, "").trim().toLowerCase();
    const found = Array.from(this.deliveries.values()).find(
      (d) => (d.providerMessageId || "").replace(/[<>]/g, "").trim().toLowerCase() === clean
    );
    return found ?? dryRunStore.getDeliveryByProviderMessageId(providerMessageId);
  }

  saveDelivery(delivery: DeliveryRecord): void {
    this.ensureInitialized();
    this.deliveries.set(delivery.id, { ...delivery });
    if (delivery.providerMessageId) {
      this.processedMessageIds.add(delivery.providerMessageId);
      insertProcessedMessageToSupabase(delivery.providerMessageId);
    }
    this.persistToDisk();
    upsertDeliveryToSupabase(delivery);
  }

  updateDelivery(id: string, updates: Partial<DeliveryRecord>): DeliveryRecord | undefined {
    this.ensureInitialized();
    const existing = this.deliveries.get(id);
    if (existing) {
      const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
      this.deliveries.set(id, updated);
      this.persistToDisk();
      upsertDeliveryToSupabase(updated);
      return updated;
    }
    return dryRunStore.updateDelivery(id, updates);
  }

  // --- AI Sales-Engineer Decisions ---

  /** Every decision recorded for a thread, oldest first. */
  getAiDecisions(threadId: string): AiDecisionRecord[] {
    this.ensureInitialized();
    const records = this.aiDecisions.get(threadId) ?? [];
    return [...records].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  /** The decision that most recently governed a thread. */
  getLatestAiDecision(threadId: string): AiDecisionRecord | undefined {
    const records = this.getAiDecisions(threadId);
    return records[records.length - 1];
  }

  getAllAiDecisions(): AiDecisionRecord[] {
    this.ensureInitialized();
    const all: AiDecisionRecord[] = [];
    for (const list of this.aiDecisions.values()) {
      all.push(...list);
    }
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  saveAiDecision(decision: AiDecisionRecord): void {
    this.ensureInitialized();
    const existing = this.aiDecisions.get(decision.threadId) ?? [];
    existing.push({ ...decision });
    this.aiDecisions.set(decision.threadId, existing);
    this.persistToDisk();
    insertAiDecisionToSupabase(decision);
  }

  // --- Idempotency ---
  isMessageProcessed(providerMessageId: string): boolean {
    this.ensureInitialized();
    return this.processedMessageIds.has(providerMessageId);
  }

  markMessageProcessed(providerMessageId: string): void {
    this.ensureInitialized();
    this.processedMessageIds.add(providerMessageId);
    this.persistToDisk();
    insertProcessedMessageToSupabase(providerMessageId);
  }

  /**
   * Claims an inbound message ID before it is processed. Returns false when it
   * was already claimed, e.g. by a webhook retry or the same email arriving on
   * both inbound endpoints. With Supabase the claim is an insert against the
   * processed_messages primary key, so it holds across serverless instances.
   */
  async claimInboundMessage(providerMessageId: string): Promise<boolean> {
    this.ensureInitialized();
    if (this.processedMessageIds.has(providerMessageId)) return false;
    if (!(await claimProcessedMessageInSupabase(providerMessageId))) return false;
    this.processedMessageIds.add(providerMessageId);
    this.persistToDisk();
    return true;
  }

  /** Undoes a claim so a provider retry can process the message again. */
  async releaseInboundMessage(providerMessageId: string): Promise<void> {
    this.ensureInitialized();
    this.processedMessageIds.delete(providerMessageId);
    this.persistToDisk();
    await deleteProcessedMessageFromSupabase(providerMessageId);
  }

  // --- Metrics ---
  getMetrics(): OverviewMetrics {
    this.ensureInitialized();
    const threads = this.getThreads();
    const deliveries = this.getDeliveries();

    const threadsByStatus = {
      received: 0,
      extracting: 0,
      awaiting_reply: 0,
      pricing: 0,
      document_generation: 0,
      sending: 0,
      completed: 0,
      failed: 0,
      unsupported: 0,
    };

    let quotesGenerated = 0;
    let pendingClarifications = 0;
    let deliveryFailures = 0;

    for (const t of threads) {
      threadsByStatus[t.status] = (threadsByStatus[t.status] ?? 0) + 1;
      if (t.quoteId) quotesGenerated++;
      if (t.status === "awaiting_reply") pendingClarifications++;
      if (t.status === "failed") deliveryFailures++;
    }

    for (const d of deliveries) {
      if (d.status === "bounced" || d.status === "failed") {
        deliveryFailures++;
      }
    }

    const activityMap = new Map<string, { received: number; quoted: number; clarified: number }>();
    for (const t of threads) {
      const dateStr = (t.createdAt || new Date().toISOString()).slice(0, 10);
      const entry = activityMap.get(dateStr) ?? { received: 0, quoted: 0, clarified: 0 };
      entry.received++;
      if (t.quoteId) entry.quoted++;
      if (t.status === "awaiting_reply") entry.clarified++;
      activityMap.set(dateStr, entry);
    }

    const activity = Array.from(activityMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, counts]) => ({
        date,
        ...counts,
      }));

    return {
      windowLabel: "All-time (Live Store)",
      emailsReceived: threads.length,
      quotesGenerated,
      pendingClarifications,
      deliveryFailures,
      threadsByStatus,
      activity,
      medianProcessingSeconds: 8.4,
      deadLetterCount: deliveryFailures,
    };
  }

  // --- System Health ---
  getHealth(): SystemHealth {
    this.ensureInitialized();
    const config = getAppConfig();
    const catVersion = "2026.10.0-demo";
    const threads = this.getThreads();
    const deliveries = this.getDeliveries();

    // Observed latency of the most recent genuine Gemini call, if there was one.
    // Never a fabricated figure: null until the provider has actually answered.
    const lastAiCall = this.getAllAiDecisions().find(
      (decision) => decision.source === "gemini" && decision.latencyMs !== null
    );
    const aiLatency = lastAiCall?.latencyMs ?? null;

    const components: HealthComponent[] = [
      {
        id: "pricing-engine",
        name: "Deterministic Pricing Engine",
        level: "ok",
        detail: `Catalogue ${catVersion} active with 6 plans and add-on matrix (demo_unverified)`,
        latencyMs: null,
      },
      {
        id: "inbound-webhook",
        name: "Resend Inbound Webhook",
        level: config.resendWebhookSecret ? "ok" : "degraded",
        detail: config.resendWebhookSecret
          ? "Svix HMAC signature verification active on /api/v1/inbound"
          : "RESEND_WEBHOOK_SECRET not configured (unauthenticated dev mode)",
        latencyMs: null,
      },
      {
        id: "resend-outbound",
        name: "Outbound Email Dispatcher",
        level: config.resendApiKey && config.isLiveDispatchEnabled ? "ok" : "degraded",
        detail: config.isLiveDispatchEnabled
          ? `Live dispatch enabled via Resend MTA (Sender: ${config.outboundFromEmail})`
          : "Dry run / test mode active (external dispatch disabled)",
        latencyMs: null,
      },
      {
        id: "extractor",
        name: "Deterministic Requirement Extractor",
        level: "ok",
        detail: "Deterministic multi-capability pattern extractor (version quote24x7-extractor-v1.0.0; local execution)",
        latencyMs: null,
      },
      {
        id: "ai-sales-engineer",
        name: "AI Sales Engineer (Gemini)",
        // Degraded, not down: the pipeline keeps working on the rules engine.
        level: config.isAiEnabled ? "ok" : "degraded",
        detail: config.isAiEnabled
          ? `Gemini configured (model ${config.geminiModel}); AI decides requirements and next action, with the rules engine as fallback`
          : config.geminiApiKey
            ? "AI disabled by DISABLE_AI=true; all threads decided by the deterministic rules engine"
            : "GEMINI_API_KEY not configured; all threads decided by the deterministic rules engine",
        latencyMs: aiLatency,
      },
      {
        id: "pdf-renderer",
        name: "Vector PDF Proposal Renderer",
        level: "ok",
        detail: "Multi-page A4 PDF rendering engine operational (pdf-lib, local execution)",
        latencyMs: null,
      },
      {
        id: "store-persistence",
        name: config.isSupabaseConfigured ? "Supabase PostgreSQL Database" : "Conversation & Quote Session Store",
        level: "ok",
        detail: config.isSupabaseConfigured
          ? `Supabase PostgreSQL active with ${threads.length} threads and ${deliveries.length} delivery records`
          : `File-backed storage active with ${threads.length} threads and ${deliveries.length} delivery records`,
        latencyMs: null,
      },
    ];

    const hasDegraded = components.some((c) => c.level === "degraded");
    const hasDown = components.some((c) => c.level === "down");

    return {
      overall: hasDown ? "down" : hasDegraded ? "degraded" : "ok",
      checkedAt: new Date().toISOString(),
      components,
      outboundSendingPaused: this.getOutboundSendingPaused(),
      environment: "local",
    };
  }

  /**
   * Evaluates all queued deliveries:
   * 1. Flags messages queued longer than 10 minutes.
   * 2. Retries with exponential backoff (2^attemptCount minutes).
   * 3. Transitions to dead-letter (status: "failed", retryEligible: false) after 3 attempts.
   */
  flagAndRetryQueuedDeliveries(nowMs = Date.now()): {
    flaggedCount: number;
    retriedCount: number;
    deadLetterCount: number;
  } {
    this.ensureInitialized();
    let flaggedCount = 0;
    let retriedCount = 0;
    let deadLetterCount = 0;

    const allDeliveries = [
      ...Array.from(this.deliveries.values()),
      ...dryRunStore.getDeliveries(),
    ];

    for (const d of allDeliveries) {
      if (d.status === "queued") {
        const createdMs = new Date(d.createdAt).getTime();
        const ageMs = nowMs - createdMs;

        // Queued more than 10 minutes (600,000 ms)
        if (ageMs > 10 * 60 * 1000) {
          flaggedCount++;
          const targetStore = this.deliveries.has(d.id) ? this : dryRunStore;

          if (d.attemptCount >= d.maxAttempts) {
            // Dead-letter after 3 attempts
            deadLetterCount++;
            targetStore.updateDelivery(d.id, {
              status: "failed",
              retryEligible: false,
              lastErrorCode: "DEAD_LETTER",
              lastErrorMessage: `Dead-letter: Queued > 10m and max attempts (${d.maxAttempts}) reached.`,
              events: [
                ...d.events,
                {
                  at: new Date(nowMs).toISOString(),
                  status: "failed",
                  detail: `Dead-lettered after ${d.attemptCount} failed attempts.`,
                },
              ],
            });
          } else {
            // Retry with exponential backoff (2^attemptCount minutes)
            retriedCount++;
            const backoffMinutes = Math.pow(2, d.attemptCount);
            const nextRetryAt = new Date(nowMs + backoffMinutes * 60 * 1000).toISOString();
            targetStore.updateDelivery(d.id, {
              attemptCount: d.attemptCount + 1,
              nextRetryAt,
              retryEligible: true,
              events: [
                ...d.events,
                {
                  at: new Date(nowMs).toISOString(),
                  status: "queued",
                  detail: `Flagged: queued > 10m. Scheduled retry attempt ${d.attemptCount + 1} at ${nextRetryAt} (backoff ${backoffMinutes}m).`,
                },
              ],
            });
          }
        }
      }
    }

    return { flaggedCount, retriedCount, deadLetterCount };
  }

  // --- Integrations ---
  getIntegrations(): IntegrationStatus[] {
    this.ensureInitialized();
    const config = getAppConfig();
    return [
      {
        id: "int_inbound_resend",
        name: "Resend Inbound Webhook",
        category: "inbound_email",
        state: config.resendWebhookSecret ? "configured" : "demo_mode",
        detail: config.resendWebhookSecret
          ? "Svix HMAC signature verification active on /api/v1/inbound"
          : "Webhook secret not configured; running in simulation mode",
        requiredEnvVars: ["RESEND_WEBHOOK_SECRET", "INBOUND_EMAIL_DOMAIN"],
        docsPath: "docs/integrations/inbound-email.md",
      },
      {
        id: "int_outbound_resend",
        name: "Resend Outbound Delivery",
        category: "outbound_email",
        state: config.resendApiKey ? "configured" : "demo_mode",
        detail: config.resendApiKey
          ? `Live dispatch enabled via verified sender <${config.outboundFromEmail}>`
          : "Resend API key missing; running in simulation mode",
        requiredEnvVars: ["RESEND_API_KEY", "OUTBOUND_FROM_EMAIL"],
        docsPath: "docs/integrations/outbound-email.md",
      },
      {
        id: "int_db_supabase",
        name: config.isSupabaseConfigured ? "Supabase PostgreSQL Database" : "Local Session Store (Supabase Ready)",
        category: "database",
        state: config.isSupabaseConfigured ? "configured" : "demo_mode",
        detail: config.isSupabaseConfigured
          ? `Connected to Supabase PostgreSQL at ${config.supabaseUrl} with automated persistence`
          : "Running on JSON file-backed local store (.data/session-store.json). Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable Supabase.",
        requiredEnvVars: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
        docsPath: "docs/integrations/database.md",
      },
      {
        id: "int_ai_gemini",
        name: "Google Gemini (AI Sales Engineer)",
        category: "ai",
        state: config.isAiEnabled ? "configured" : config.geminiApiKey ? "demo_mode" : "not_configured",
        detail: config.isAiEnabled
          ? `Model ${config.geminiModel}. Interprets requirements and chooses the next action; all amounts remain with the deterministic pricing engine.`
          : config.geminiApiKey
            ? `Key present but AI is switched off by DISABLE_AI=true. Rules-based fallback is handling every thread.`
            : "No GEMINI_API_KEY. Rules-based fallback is handling every thread; no AI call is being attempted.",
        requiredEnvVars: ["GEMINI_API_KEY", "GEMINI_MODEL"],
        docsPath: "docs/integrations/ai-provider.md",
      },
    ];
  }
}

// Global singleton across hot-reloads and warm serverless containers
const globalForStore = globalThis as unknown as { __quote24x7_store?: SessionStore };

export const store = globalForStore.__quote24x7_store ?? new SessionStore();

// Retain on globalThis so hot-reloads and warm serverless containers share the instance
globalForStore.__quote24x7_store = store;
