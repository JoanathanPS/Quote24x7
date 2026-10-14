import type {
  DeliveryRecord,
  EmailMessage,
  EmailThread,
  IntegrationStatus,
  OverviewMetrics,
  Quote,
  RequirementProfile,
  SystemHealth,
} from "@/types/domain";
import { getSeedData } from "../fixtures/seed-data.ts";

/**
 * Stateful in-memory repository for Quote24x7.
 * Seeded with initial realistic fixture data, but accepts real runtime mutations
 * from inbound webhooks, extraction pipeline, pricing engine, and Resend delivery events.
 */
class SessionStore {
  private threads: Map<string, EmailThread> = new Map();
  private messages: Map<string, EmailMessage[]> = new Map(); // keyed by threadId
  private profiles: Map<string, RequirementProfile> = new Map(); // keyed by threadId
  private quotes: Map<string, Quote> = new Map(); // keyed by quoteId
  private deliveries: Map<string, DeliveryRecord> = new Map(); // keyed by deliveryId
  private processedMessageIds: Set<string> = new Set(); // for idempotency
  private initialized = false;

  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;

    const seed = getSeedData();
    for (const thread of seed.threads) {
      this.threads.set(thread.id, { ...thread });
    }

    for (const msg of seed.messages) {
      const existing = this.messages.get(msg.threadId) ?? [];
      existing.push({ ...msg });
      this.messages.set(msg.threadId, existing);
      if (msg.providerMessageId) {
        this.processedMessageIds.add(msg.providerMessageId);
      }
    }

    for (const [threadId, profile] of seed.profiles.entries()) {
      this.profiles.set(threadId, { ...profile });
    }

    for (const [quoteId, quote] of seed.quotes.entries()) {
      this.quotes.set(quoteId, { ...quote });
    }

    for (const delivery of seed.deliveries) {
      this.deliveries.set(delivery.id, { ...delivery });
      if (delivery.providerMessageId) {
        this.processedMessageIds.add(delivery.providerMessageId);
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
  }

  updateThread(id: string, updates: Partial<EmailThread>): EmailThread | undefined {
    this.ensureInitialized();
    const existing = this.threads.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.threads.set(id, updated);
    return updated;
  }

  // --- Messages ---
  getMessages(threadId: string): EmailMessage[] {
    this.ensureInitialized();
    const msgs = this.messages.get(threadId) ?? [];
    return [...msgs].sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    );
  }

  addMessage(message: EmailMessage): void {
    this.ensureInitialized();
    const existing = this.messages.get(message.threadId) ?? [];
    existing.push({ ...message });
    this.messages.set(message.threadId, existing);
    if (message.providerMessageId) {
      this.processedMessageIds.add(message.providerMessageId);
    }
  }

  // --- Requirement Profiles ---
  getProfile(threadId: string): RequirementProfile | undefined {
    this.ensureInitialized();
    return this.profiles.get(threadId);
  }

  saveProfile(profile: RequirementProfile): void {
    this.ensureInitialized();
    this.profiles.set(profile.threadId, { ...profile });
  }

  // --- Quotes ---
  getQuote(quoteId: string): Quote | undefined {
    this.ensureInitialized();
    return this.quotes.get(quoteId);
  }

  saveQuote(quote: Quote): void {
    this.ensureInitialized();
    this.quotes.set(quote.id, { ...quote });
  }

  // --- Deliveries ---
  getDeliveries(): DeliveryRecord[] {
    this.ensureInitialized();
    return Array.from(this.deliveries.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getDelivery(id: string): DeliveryRecord | undefined {
    this.ensureInitialized();
    return this.deliveries.get(id);
  }

  getDeliveryByProviderMessageId(providerMessageId: string): DeliveryRecord | undefined {
    this.ensureInitialized();
    return Array.from(this.deliveries.values()).find(
      (d) => d.providerMessageId === providerMessageId
    );
  }

  saveDelivery(delivery: DeliveryRecord): void {
    this.ensureInitialized();
    this.deliveries.set(delivery.id, { ...delivery });
    if (delivery.providerMessageId) {
      this.processedMessageIds.add(delivery.providerMessageId);
    }
  }

  updateDelivery(id: string, updates: Partial<DeliveryRecord>): DeliveryRecord | undefined {
    this.ensureInitialized();
    const existing = this.deliveries.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.deliveries.set(id, updated);
    return updated;
  }

  // --- Idempotency ---
  isMessageProcessed(providerMessageId: string): boolean {
    this.ensureInitialized();
    return this.processedMessageIds.has(providerMessageId);
  }

  markMessageProcessed(providerMessageId: string): void {
    this.ensureInitialized();
    this.processedMessageIds.add(providerMessageId);
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

    const seed = getSeedData();

    return {
      windowLabel: "All-time (Live Store)",
      emailsReceived: threads.length,
      quotesGenerated,
      pendingClarifications,
      deliveryFailures,
      threadsByStatus,
      activity: seed.metrics.activity,
      medianProcessingSeconds: 8.4,
      deadLetterCount: deliveryFailures,
    };
  }

  // --- System Health ---
  getHealth(): SystemHealth {
    this.ensureInitialized();
    const seed = getSeedData();
    return {
      ...seed.health,
      checkedAt: new Date().toISOString(),
    };
  }

  // --- Integrations ---
  getIntegrations(): IntegrationStatus[] {
    this.ensureInitialized();
    const seed = getSeedData();
    return seed.integrations;
  }
}

// Global singleton across hot-reloads
const globalForStore = globalThis as unknown as { __quote24x7_store?: SessionStore };

export const store = globalForStore.__quote24x7_store ?? new SessionStore();

if (process.env.NODE_ENV !== "production") {
  globalForStore.__quote24x7_store = store;
}
