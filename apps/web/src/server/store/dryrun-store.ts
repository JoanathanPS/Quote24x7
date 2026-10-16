import fs from "node:fs";
import path from "node:path";
import type {
  DeliveryRecord,
  EmailMessage,
  EmailThread,
  Quote,
  RequirementProfile,
} from "@/types/domain";

interface DryRunPersistedState {
  threads: EmailThread[];
  messages: EmailMessage[];
  profiles: Array<[string, RequirementProfile]>;
  quotes: Array<[string, Quote]>;
  deliveries: DeliveryRecord[];
}

/**
 * Separate storage repository strictly for seed and dry-run / simulation records.
 * Keeps production session-store.json completely isolated from test, fixture,
 * and dry-run artifacts.
 */
export class DryRunStore {
  private threads: Map<string, EmailThread> = new Map();
  private messages: Map<string, EmailMessage[]> = new Map(); // keyed by threadId
  private profiles: Map<string, RequirementProfile> = new Map(); // keyed by threadId
  private quotes: Map<string, Quote> = new Map(); // keyed by quoteId
  private deliveries: Map<string, DeliveryRecord> = new Map(); // keyed by deliveryId
  private initialized = false;

  private isTestEnvironment(): boolean {
    return (
      process.env.NODE_ENV === "test" ||
      process.env.npm_lifecycle_event === "test" ||
      process.execArgv.some((a) => a.includes("test"))
    );
  }

  private getStoragePath(): string {
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      return path.join("/tmp", "dryrun-store.json");
    }
    return path.resolve(process.cwd(), ".data", "dryrun-store.json");
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
      const data: DryRunPersistedState = {
        threads: Array.from(this.threads.values()),
        messages: allMessages,
        profiles: Array.from(this.profiles.entries()),
        quotes: Array.from(this.quotes.entries()),
        deliveries: Array.from(this.deliveries.values()),
      };
      const tmpPath = `${filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
      fs.renameSync(tmpPath, filePath);
    } catch {
      // Graceful fallback for read-only environments
    }
  }

  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;

    const filePath = this.getStoragePath();
    if (!this.isTestEnvironment() && fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw) as DryRunPersistedState;
        if (Array.isArray(parsed.threads)) {
          for (const thread of parsed.threads) {
            this.threads.set(thread.id, thread);
          }
          for (const msg of parsed.messages || []) {
            const existing = this.messages.get(msg.threadId) ?? [];
            existing.push(msg);
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
        }
      } catch {
        // Fall back to empty store
      }
    }
  }

  public clearAll(): void {
    this.threads.clear();
    this.messages.clear();
    this.profiles.clear();
    this.quotes.clear();
    this.deliveries.clear();
    this.initialized = true;
    this.persistToDisk();
  }

  public reset(): void {
    this.threads.clear();
    this.messages.clear();
    this.profiles.clear();
    this.quotes.clear();
    this.deliveries.clear();
    this.initialized = false;
    this.ensureInitialized();
  }

  // --- Deliveries ---
  saveDelivery(delivery: DeliveryRecord): void {
    this.ensureInitialized();
    this.deliveries.set(delivery.id, { ...delivery });
    this.persistToDisk();
  }

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

  updateDelivery(id: string, updates: Partial<DeliveryRecord>): DeliveryRecord | undefined {
    this.ensureInitialized();
    const existing = this.deliveries.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.deliveries.set(id, updated);
    this.persistToDisk();
    return updated;
  }

  // --- Threads ---
  saveThread(thread: EmailThread): void {
    this.ensureInitialized();
    this.threads.set(thread.id, { ...thread });
    this.persistToDisk();
  }

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

  // --- Messages ---
  addMessage(message: EmailMessage): void {
    this.ensureInitialized();
    const existing = this.messages.get(message.threadId) ?? [];
    existing.push({ ...message });
    this.messages.set(message.threadId, existing);
    this.persistToDisk();
  }

  getMessages(threadId: string): EmailMessage[] {
    this.ensureInitialized();
    const msgs = this.messages.get(threadId) ?? [];
    return [...msgs].sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    );
  }

  // --- Quotes ---
  saveQuote(quote: Quote): void {
    this.ensureInitialized();
    this.quotes.set(quote.id, { ...quote });
    this.persistToDisk();
  }

  getQuote(id: string): Quote | undefined {
    this.ensureInitialized();
    return this.quotes.get(id);
  }
}

// Global singleton across hot-reloads and warm serverless containers
const globalForDryRun = globalThis as unknown as { __quote24x7_dryrun_store?: DryRunStore };

export const dryRunStore = globalForDryRun.__quote24x7_dryrun_store ?? new DryRunStore();

globalForDryRun.__quote24x7_dryrun_store = dryRunStore;
