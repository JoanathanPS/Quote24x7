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

/**
 * Seed data for Quote24x7 operational console.
 *
 * Purged of fabricated threads and quotes.
 * Serves as clean baseline for new tests.
 */

export interface SeedDataResult {
  threads: EmailThread[];
  messages: EmailMessage[];
  profiles: Map<string, RequirementProfile>;
  quotes: Map<string, Quote>;
  deliveries: DeliveryRecord[];
  metrics: OverviewMetrics;
  health: SystemHealth;
  integrations: IntegrationStatus[];
}

export function getSeedData(): SeedDataResult {
  const metrics: OverviewMetrics = {
    windowLabel: "All-time (Clean Store)",
    emailsReceived: 0,
    quotesGenerated: 0,
    pendingClarifications: 0,
    deliveryFailures: 0,
    threadsByStatus: {
      received: 0,
      extracting: 0,
      awaiting_reply: 0,
      pricing: 0,
      document_generation: 0,
      sending: 0,
      completed: 0,
      failed: 0,
      unsupported: 0,
    },
    activity: [],
    medianProcessingSeconds: null,
    deadLetterCount: 0,
  };

  const health: SystemHealth = {
    overall: "ok",
    checkedAt: new Date().toISOString(),
    components: [
      {
        id: "pricing-engine",
        name: "Deterministic Pricing Engine",
        level: "ok",
        detail: "Real pricing engine initialized",
        latencyMs: null,
      },
    ],
    outboundSendingPaused: false,
    environment: "local",
  };

  const integrations: IntegrationStatus[] = [];

  return {
    threads: [],
    messages: [],
    profiles: new Map(),
    quotes: new Map(),
    deliveries: [],
    metrics,
    health,
    integrations,
  };
}
