/**
 * Quote24x7 domain model.
 *
 * These types mirror the persistence model in `docs/claude-code-prompt.md` §12
 * and are the contract between the operational console and the processing
 * backend. The console reads them through `src/lib/api-client.ts`; today that
 * client is served by Next route handlers over seeded fixtures, and later by
 * the FastAPI service, without the UI changing.
 *
 * Money rule: every amount in this file is an INTEGER COUNT OF MINOR UNITS
 * (paise for INR, cents for USD). JavaScript has no decimal type, so binary
 * floating point is never used for currency anywhere in this project. Values
 * are converted to a display string only at the rendering edge.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Amount in minor units. 971_100_00 === ₹971,100.00 */
export type MinorUnits = number;

export type CurrencyCode = "INR" | "USD" | "EUR" | "GBP";

export type MarketCode = "IN" | "US" | "EU" | "UK";

export type BillingPeriod = "monthly" | "annual";

export type IsoDateTime = string;

// ---------------------------------------------------------------------------
// Pricing catalogue
// ---------------------------------------------------------------------------

/**
 * How much trust a price deserves. Nothing in this repository may be
 * `company_authorized` — that status is reserved for a price book supplied by
 * the project owner.
 */
export type VerificationStatus =
  | "company_authorized"
  | "public_verified"
  | "screenshot_derived"
  | "synthetic_test";

export type CatalogueStatus = "draft" | "validated" | "active" | "retired";

export interface SourceReference {
  /** Stable key referenced by plans, add-ons and line items. */
  id: string;
  title: string;
  /** Page, document or screenshot file the value came from. */
  locator: string;
  url: string | null;
  retrievedAt: IsoDateTime;
  verificationStatus: VerificationStatus;
  /** Anything that makes this source less than authoritative. */
  caveats: string[];
}

/** Billable units the pricing engine understands. */
export type UnitKind =
  | "basic_monitor"
  | "advanced_monitor"
  | "host_monitor"
  | "network_component"
  | "rum_pageview"
  | "applog_gb"
  | "synthetic_run";

export interface Entitlement {
  unit: UnitKind;
  /** Quantity included in the plan base price. `null` = plan does not support this unit at all. */
  included: number | null;
}

export interface Plan {
  id: string;
  name: string;
  /** One-line positioning used in option cards and the quote document. */
  summary: string;
  basePrice: MinorUnits;
  priceMonthlyAnnualBilled?: MinorUnits;
  priceMonthToMonth?: MinorUnits;
  storePriceMonthlyAnnualBilled?: MinorUnits | null;
  billingPeriod: BillingPeriod;
  verificationStatus: VerificationStatus;
  entitlements: Entitlement[];
  /** Capability flags shown as coverage, e.g. "Application performance monitoring". */
  capabilities: string[];
  /** Add-on ids this plan is allowed to combine with. */
  allowedAddOnIds: string[];
  pollingFrequency: string;
  monitoringLocations: number | null;
  sourceId: string;
  families?: string[];
  quoteOnRequest?: boolean;
  priceIsFloor?: boolean;
}

export interface AddOnPack {
  id: string;
  name: string;
  unit: UnitKind;
  /** Units delivered by one pack. Excess demand is covered by whole packs only. */
  packSize: number;
  /** `null` when the source did not give a price — the engine must then refuse to quote. */
  packPrice: MinorUnits | null;
  billingPeriod: BillingPeriod;
  verificationStatus: VerificationStatus;
  sourceId: string;
  /** Plan ids this pack price applies to; empty = all plans that allow it. */
  appliesToPlanIds: string[];
}

export interface CatalogueVersion {
  id: string;
  version: string;
  market: MarketCode;
  currency: CurrencyCode;
  status: CatalogueStatus;
  verificationStatus: VerificationStatus;
  contentHash: string;
  effectiveFrom: IsoDateTime;
  effectiveTo: IsoDateTime | null;
  createdAt: IsoDateTime;
  activatedAt: IsoDateTime | null;
  plans: Plan[];
  addOns: AddOnPack[];
  planAddOnPrices?: Record<string, Record<string, MinorUnits>>;
  sources: SourceReference[];
  /** Validation findings produced at import time. */
  validation: CatalogueValidationReport;
  notes: string[];
}

export interface CatalogueValidationReport {
  checkedAt: IsoDateTime;
  passed: boolean;
  errors: CatalogueFinding[];
  warnings: CatalogueFinding[];
}

export interface CatalogueFinding {
  code: string;
  message: string;
  /** Plan id, add-on id or source id the finding relates to. */
  subject: string | null;
}

// ---------------------------------------------------------------------------
// Email threads and messages
// ---------------------------------------------------------------------------

export type ThreadStatus =
  | "received"
  | "extracting"
  | "awaiting_reply"
  | "pricing"
  | "document_generation"
  | "sending"
  | "completed"
  | "failed"
  | "unsupported";

export type RequestType = "quote" | "proposal" | "clarification" | "unknown";

export interface EmailThread {
  id: string;
  provider: string;
  providerThreadId: string | null;
  senderEmail: string;
  senderName: string | null;
  organisation: string | null;
  subject: string;
  status: ThreadStatus;
  requestType: RequestType;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  lastMessageAt: IsoDateTime;
  messageCount: number;
  /** Set only when a valid quote exists; never a placeholder. */
  quoteId: string | null;
  quoteTotal: MinorUnits | null;
  currency: CurrencyCode | null;
  /** Operator-safe explanation for failed / unsupported threads. */
  statusDetail: string | null;
  state?: string;
  roundsUsed?: number;
  nonproductiveStreak?: number;
  inboundCount?: number;
  lastInboundAt?: IsoDateTime | null;
  subjectCanonical?: string | null;
}

export type MessageDirection = "inbound" | "outbound";

export interface EmailMessage {
  id: string;
  threadId: string;
  providerMessageId: string;
  direction: MessageDirection;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  subject: string;
  /** Already sanitised server-side: scripts, remote images and trackers stripped. */
  bodyText: string;
  occurredAt: IsoDateTime;
  /** Outbound only. */
  deliveryId: string | null;
  /** Set when ingress flagged the message, e.g. a prompt-injection attempt. */
  securityNotes: string[];
  attachments: MessageAttachment[];
  messageIdHeader?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
}

export type DocumentFormatKind = "pdf" | "excel" | "csv" | "text" | "image" | "word" | "other";

export interface MessageAttachment {
  name: string;
  contentType: string;
  sizeBytes: number;
  /** Whether the attachment was scanned and verified safe. */
  scanned: boolean;
  /** Plain text or structured tabular markdown extracted from document attachments. */
  extractedText?: string;
  /** Classified document kind (pdf, excel, csv, text, image, word, or other). */
  documentKind?: DocumentFormatKind;
  /** Base64 encoded file payload if retained for multimodal vision. */
  contentBase64?: string;
}

// ---------------------------------------------------------------------------
// Requirement extraction
// ---------------------------------------------------------------------------

export type FieldState = "provided" | "inferred" | "missing" | "conflicting";

export type IntakeUnit =
  | "host_monitor"
  | "basic_monitor"
  | "advanced_monitor"
  | "network_component"
  | "rum_pageview"
  | "applog_gb";

export type IntakeUnitState = "stated" | "none" | "unknown";

export interface IntakeRequirement {
  unit: IntakeUnit;
  state: IntakeUnitState;
  quantity: number | null;
  evidence: string | null;
}

export type EmailTriageCategory =
  | "actionable_rfq"
  | "vague_inquiry"
  | "non_substantive"
  | "unsupported";

export interface OptionalRequirementParameters {
  usersOver10?: boolean | null;
  logRetentionOver30Days?: boolean | null;
  statusPages?: boolean | null;
  anomalyDetection?: boolean | null;
}

export interface RequirementField {
  key: string;
  label: string;
  /** Grouping used by the thread detail screen. */
  group: "infrastructure" | "applications" | "commercial" | "context";
  value: number | string | null;
  unit: string | null;
  state: FieldState;
  intakeState?: IntakeUnitState;
  /** 0–1. Only meaningful for `provided` and `inferred`. */
  confidence: number | null;
  /** Verbatim span from the buyer's email supporting the value. */
  evidence: string | null;
  /** Populated for `conflicting` fields. */
  conflictWith: string | null;
  /** Populated when a later message superseded an earlier value. */
  previousValue: number | string | null;
  /** Whether a missing value would change the price, driving the clarification policy. */
  materialToPricing: boolean;
}

export interface RequirementProfile {
  id: string;
  threadId: string;
  version: number;
  supersedesProfileId: string | null;
  createdAt: IsoDateTime;
  extractorModel: string;
  /** Null until a model is configured; fixtures record the fixture generator instead. */
  extractorRunId: string | null;
  fields: RequirementField[];
  summary: string;
  /** Material gaps the clarification policy selected, in asking order. */
  pendingQuestions: ClarificationQuestion[];
  answeredQuestions: ClarificationQuestion[];
  /** Rounds already spent, against the configured limit. */
  clarificationRound: number;
  intakeRequirements?: Record<IntakeUnit, IntakeRequirement>;
  optionalParameters?: OptionalRequirementParameters;
  triageCategory?: EmailTriageCategory;
}

export interface ClarificationQuestion {
  id: string;
  fieldKeys: string[];
  question: string;
  reason: string;
  askedAt: IsoDateTime | null;
  answeredAt: IsoDateTime | null;
  answerSummary: string | null;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export type QuoteStatus =
  | "estimate"
  | "validated"
  | "sent"
  | "delivery_failed"
  | "superseded";

export type OptionType = "best_value" | "lowest_cost" | "best_coverage";

/** How confident the system is that the amounts may be shown to a buyer. */
export type PricingStatus =
  | "demo_unverified"
  | "research_estimate"
  | "authorized";

export interface QuoteLineItem {
  id: string;
  /** Pricing rule that produced the line, for audit. */
  ruleId: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: MinorUnits;
  lineTotal: MinorUnits;
  /** Quantity already covered by the plan base price. */
  includedQuantity: number | null;
  sourceId: string;
  packSize?: number | null;
  purchasedUnits?: number | null;
}

export interface CoverageRow {
  unit: UnitKind;
  label: string;
  required: number;
  included: number;
  viaAddOns: number;
  total: number;
  /** True when total >= required. */
  satisfied: boolean;
}

export interface QuoteOption {
  id: string;
  quoteId: string;
  optionType: OptionType;
  planId: string;
  planName: string;
  /** Deterministic, data-derived reason — not model prose. */
  rankReason: string;
  subtotal: MinorUnits;
  /** Null when tax treatment for the market is not verified. */
  taxTotal: MinorUnits | null;
  total: MinorUnits;
  valid: boolean;
  unavailabilityReason: string | null;
  isStartingAt?: boolean;
  requiresReview?: boolean;
  pricingNote?: string | null;
  whatItAdds?: string[];
  comparisonNote?: string | null;
  lineItems: QuoteLineItem[];
  coverage: CoverageRow[];
  /** Headroom beyond the stated requirement, used to justify Best Coverage. */
  headroomNotes: string[];
}

export interface CalculationStep {
  step: number;
  ruleId: string;
  description: string;
  /** Human-readable arithmetic, e.g. "ceil((80 - 20) / 10) = 6 packs". */
  computation: string;
  resultMinor: MinorUnits | null;
}

export interface Quote {
  id: string;
  threadId: string;
  requirementProfileId: string;
  catalogueVersionId: string;
  catalogueVersion: string;
  calculationVersion: string;
  status: QuoteStatus;
  pricingStatus: PricingStatus;
  market: MarketCode;
  currency: CurrencyCode;
  billingPeriod: BillingPeriod;
  createdAt: IsoDateTime;
  /** Only set when a verified validity policy is configured. */
  expiresAt: IsoDateTime | null;
  options: QuoteOption[];
  assumptions: string[];
  exclusions: string[];
  calculationTrace: CalculationStep[];
  /** Integrity checks run after calculation, before any document is produced. */
  integrityChecks: IntegrityCheck[];
  documents: QuoteDocument[];
  /** Why fewer than three options exist, when that is the case. */
  optionCountNote: string | null;
  /** Plain English comparison line comparing base option to alternative tier. */
  comparisonLine?: string | null;
  version?: number;
  supersededBy?: string | null;
}

export interface IntegrityCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export type DocumentType = "quote" | "proposal";

export interface QuoteDocument {
  id: string;
  quoteId: string;
  documentType: DocumentType;
  fileName: string;
  contentHash: string;
  pageCount: number;
  createdAt: IsoDateTime;
  /** Null until a server-side renderer is wired up; the console previews from quote data. */
  storageKey: string | null;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export type DeliveryStatus =
  | "queued"
  | "accepted"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed"
  | "suppressed";

export interface DeliveryEvent {
  at: IsoDateTime;
  status: DeliveryStatus | "retry_scheduled";
  detail: string;
}

export interface DeliveryRecord {
  id: string;
  threadId: string;
  quoteId: string | null;
  provider: string;
  providerMessageId: string | null;
  recipient: string;
  subject: string;
  status: DeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  /** Operator-safe message. Never contains credentials or full message bodies. */
  lastErrorMessage: string | null;
  nextRetryAt: IsoDateTime | null;
  retryEligible: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  events: DeliveryEvent[];
}

// ---------------------------------------------------------------------------
// Operations / health
// ---------------------------------------------------------------------------

export interface OverviewMetrics {
  windowLabel: string;
  emailsReceived: number;
  quotesGenerated: number;
  pendingClarifications: number;
  deliveryFailures: number;
  threadsByStatus: Record<ThreadStatus, number>;
  /** Daily buckets for the activity chart; real counts from seeded threads. */
  activity: ActivityBucket[];
  medianProcessingSeconds: number | null;
  deadLetterCount: number;
}

export interface ActivityBucket {
  date: string;
  received: number;
  quoted: number;
  clarified: number;
}

export type IntegrationState = "configured" | "demo_mode" | "not_configured" | "error";

export interface IntegrationStatus {
  id: string;
  name: string;
  category: "inbound_email" | "outbound_email" | "ai" | "database" | "documents" | "storage";
  state: IntegrationState;
  /** What the console actually knows, phrased so it never overstates readiness. */
  detail: string;
  /** Environment variable names only — never values. */
  requiredEnvVars: string[];
  docsPath: string | null;
}

export type HealthLevel = "ok" | "degraded" | "down" | "unknown";

export interface SystemHealth {
  overall: HealthLevel;
  checkedAt: IsoDateTime;
  components: HealthComponent[];
  /** Global pause on automated outbound sending. */
  outboundSendingPaused: boolean;
  sendingEnabled?: boolean;
  environment: "local" | "staging" | "production";
  countsByThreadState?: Record<string, number>;
  queueDepth?: number;
  stuckMessagesOver10m?: number;
  lastWebhookAt?: string | null;
  liveLatencyMs?: number | null;
}

export interface HealthComponent {
  id: string;
  name: string;
  level: HealthLevel;
  detail: string;
  latencyMs: number | null;
}

// ---------------------------------------------------------------------------
// AI sales-engineer decisions
// ---------------------------------------------------------------------------

/** What the sales engineer decided to do next with a thread. */
export type AiAction = "ask_follow_up" | "prepare_quote" | "human_review";

/** Which component actually produced the decision that was acted on. */
export type DecisionSource = "groq" | "gemini" | "rules_fallback";

/** Why the AI path was not used, or not trusted. Safe for operator display. */
export type AiFailureCategory =
  | "not_configured"
  | "disabled_by_flag"
  | "timeout"
  | "rate_limited"
  | "provider_error"
  | "unsupported_model"
  | "invalid_output"
  | "schema_violation"
  | "empty_input";

/** Monitoring categories the sales engineer may recommend. Each is checked against the catalogue. */
export type ProductCategory =
  | "infrastructure_monitoring"
  | "website_monitoring"
  | "synthetic_monitoring"
  | "application_performance_monitoring"
  | "real_user_monitoring"
  | "log_management"
  | "network_monitoring"
  | "msp";

/**
 * Outcome of validating a model decision against the catalogue and the
 * deterministic engine. Recorded whether it passed or failed, so an operator
 * can see what the AI proposed and what the system allowed.
 */
export interface AiValidationOutcome {
  passed: boolean;
  /** Blocking problems. A non-empty list means the AI decision was not acted on as given. */
  errors: string[];
  /** Non-blocking corrections, e.g. an unsupported category that was dropped. */
  warnings: string[];
  /** Categories the model asked for that no plan in the catalogue can deliver. */
  unsupportedCategories: ProductCategory[];
  /** Plan ids the model referenced that do not exist in the active catalogue. */
  unknownPlanIds: string[];
}

/**
 * A persisted record of one sales-engineering decision.
 *
 * Holds the auditable decision and its provenance. It deliberately does not
 * hold API keys, raw provider payloads, or hidden model reasoning traces —
 * `reasoningSummary` is the concise, model-authored explanation that was
 * explicitly requested as an auditable output.
 */
export interface AiDecisionRecord {
  id: string;
  threadId: string;
  /** Profile version this decision was made against. */
  profileId: string | null;
  createdAt: IsoDateTime;
  source: DecisionSource;
  /** Model identifier when source is "gemini"; null for the rules fallback. */
  model: string | null;
  action: AiAction;
  /** The action the model asked for, when validation changed it. */
  originalAction: AiAction | null;
  customerSummary: string;
  identifiedNeeds: string[];
  recommendedCategories: ProductCategory[];
  /** Catalogue plan ids the model referenced. Advisory only — ranking stays deterministic. */
  referencedPlanIds: string[];
  assumptions: string[];
  followUpQuestions: string[];
  reasoningSummary: string;
  /** Model self-reported confidence, 0–1. Null for the rules fallback. */
  confidence: number | null;
  humanReviewReasons: string[];
  validation: AiValidationOutcome;
  /** Set when the AI path was attempted and did not produce a usable decision. */
  failureCategory: AiFailureCategory | null;
  /** Operator-safe error summary. Never contains credentials or full prompts. */
  failureDetail: string | null;
  /** Wall-clock duration of the provider call, when one was made. */
  latencyMs: number | null;
  /** Catalogue version the decision was validated against. */
  catalogueVersion: string | null;
  /** Natural language response addressing customer general/product questions. */
  conversationalResponse?: string | null;
  provider?: string | null;
  decisionSource?: "ai" | "rules_fallback" | null;
  fallbackReason?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}

export interface WebhookEventRecord {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: "pending" | "processed" | "failed" | "ignored";
  processedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

