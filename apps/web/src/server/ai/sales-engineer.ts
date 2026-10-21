import type {
  AiAction,
  AiDecisionRecord,
  AiFailureCategory,
  AiValidationOutcome,
  CatalogueVersion,
  ClarificationQuestion,
  EmailMessage,
  EmailThread,
  MessageAttachment,
  ProductCategory,
  RequirementField,
  RequirementProfile,
} from "@/types/domain";

import { getAppConfig } from "../config.ts";
import { DEMAND_UNITS, UNIT_LABELS, type DemandUnit, type PricingDemand } from "../pricing/engine.ts";
import {
  extractRequirements,
  mergeRequirements,
  type ExtractionResult,
} from "../extraction/extractor.ts";
import { buildSalesContext, deriveSupportedCategories } from "./context-builder.ts";
import { QUANTITY_BOUNDS, type AiDecisionOutput } from "./decision-schema.ts";
import { geminiProvider, type AiProvider } from "./gemini-provider.ts";
import { groqProvider } from "./groq-provider.ts";
import { cerebrasProvider } from "./cerebras-provider.ts";
import type { DecisionSource } from "@/types/domain";

/**
 * The AI sales engineer.
 *
 * Three parties with strictly separated authority:
 *
 *   Gemini / Groq     decides what the customer needs and what to do next.
 *   This module        validates that decision against the catalogue and
 *                      corrects or escalates it when it does not hold up.
 *   The pricing engine owns every amount, untouched by either of the above.
 *
 * The rules-based extractor is always run, for two reasons: it supplies the
 * commercial metadata the AI schema deliberately omits (currency, billing
 * period, organisation), and it is the fallback result, already computed, for
 * the moment the provider is unavailable.
 */

export const MAX_CLARIFICATION_ROUNDS = 3;

export function normaliseEvidenceText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[.,:;!?()[\]{}"'\-_/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const WORD_VALUES_SE: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};

const SUFFIX_MULTIPLIERS_SE: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, billion: 1e9, lakh: 1e5, lakhs: 1e5, crore: 1e7, crores: 1e7, gb: 1,
};

export function extractCandidateValues(text: string): Set<number> {
  const norm = text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");
  const values = new Set<number>();
  const literals: number[] = [];

  for (const match of norm.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|billion|lakhs?|crores?|thousand|tb|gb)?\b/gi)) {
    const n = Number.parseFloat((match[1] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const suffix = (match[2] ?? "").toLowerCase();
    literals.push(n);
    values.add(n);
    if (suffix === "tb") {
      values.add(n * 1024);
      values.add(n * 1000);
    } else if (suffix in SUFFIX_MULTIPLIERS_SE) {
      values.add(n * (SUFFIX_MULTIPLIERS_SE[suffix] ?? 1));
    }
  }

  for (const match of norm.matchAll(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/gi)) {
    const w1 = match[1]?.toLowerCase();
    const w2 = match[2]?.toLowerCase();
    const sum = (w1 ? WORD_VALUES_SE[w1] ?? 0 : 0) + (w2 ? WORD_VALUES_SE[w2] ?? 0 : 0);
    literals.push(sum);
    values.add(sum);
  }
  for (const match of norm.matchAll(/[a-z]+/gi)) {
    const v = WORD_VALUES_SE[match[0].toLowerCase()];
    if (v !== undefined) {
      literals.push(v);
      values.add(v);
    }
  }

  for (let i = 0; i < literals.length; i += 1) {
    for (let j = i + 1; j < literals.length; j += 1) values.add((literals[i] ?? 0) + (literals[j] ?? 0));
  }
  if (literals.length > 1) values.add(literals.reduce((a, b) => a + b, 0));
  return values;
}

export function isModelEvidenceSupported(
  evidence: string | undefined,
  quantity: number,
  sourceText: string,
): boolean {
  if (quantity === 0) return true;
  if (!evidence || evidence.trim().length === 0) return false;

  const normSource = normaliseEvidenceText(sourceText);
  const normEvidence = normaliseEvidenceText(evidence);

  if (normEvidence.length > 0 && normSource.includes(normEvidence)) {
    return true;
  }

  const numericTokens = [...evidence.matchAll(/\b\d+\b/g)].map((m) => m[0]);
  const allNumericTokensInSource =
    numericTokens.length > 0 && numericTokens.every((token) => sourceText.includes(token));
  const candidates = extractCandidateValues(sourceText);
  const quantitySupported = candidates.has(quantity);

  if (allNumericTokensInSource && quantitySupported) {
    return true;
  }

  if (quantitySupported && normEvidence.length > 0) {
    const words = normEvidence.split(/\s+/).filter((w) => w.length > 3);
    if (words.length > 0 && words.some((w) => normSource.includes(w))) {
      return true;
    }
  }

  return false;
}

/**
 * Whether asking another question would exceed the clarification allowance.
 *
 * `roundsSpent` is the round already recorded on the stored profile, so the
 * question about to be asked would be round `roundsSpent + 1`. Reaching
 * MAX_CLARIFICATION_ROUNDS stops the loop, which allows two clarification
 * emails and escalates on the third unresolved turn. This matches the
 * behaviour the pipeline had before the AI was introduced.
 */
function clarificationLimitReached(roundsSpent: number): boolean {
  return roundsSpent + 1 >= MAX_CLARIFICATION_ROUNDS;
}

/** Maps a billable unit onto the requirement-profile field key used across the app. */
const UNIT_FIELD_KEYS: Record<DemandUnit, { key: string; label: string; unit: string; group: RequirementField["group"] }> = {
  host_monitor: { key: "servers", label: "Server / Host Monitors", unit: "servers", group: "infrastructure" },
  network_component: { key: "network_devices", label: "Network Devices", unit: "devices", group: "infrastructure" },
  advanced_monitor: { key: "advanced_monitors", label: "Advanced / Synthetic Monitors", unit: "monitors", group: "applications" },
  basic_monitor: { key: "basic_monitors", label: "Basic Monitors", unit: "monitors", group: "applications" },
  rum_pageview: { key: "rum_pageviews", label: "RUM Pageviews", unit: "pageviews/month", group: "applications" },
  applog_gb: { key: "applogs_volume", label: "AppLogs Volume", unit: "GB/month", group: "applications" },
};

const FIELD_KEY_TO_UNIT = new Map<string, DemandUnit>(
  (Object.entries(UNIT_FIELD_KEYS) as Array<[DemandUnit, { key: string }]>).map(([unit, meta]) => [meta.key, unit]),
);

/** Keywords that tie a follow-up question to the unit it is asking about. */
const QUESTION_UNIT_HINTS: Array<{ unit: DemandUnit; match: RegExp }> = [
  { unit: "host_monitor", match: /\b(server|host|vm|virtual machine|instance|node|machine)/i },
  { unit: "network_component", match: /\b(network|switch|router|firewall|interface)/i },
  { unit: "advanced_monitor", match: /\b(synthetic|advanced|transaction|browser check)/i },
  { unit: "basic_monitor", match: /\b(basic|ping|port|uptime|website count|how many (?:websites|urls|sites))/i },
  { unit: "rum_pageview", match: /\b(rum|real user|pageview|page view)/i },
  { unit: "applog_gb", match: /\b(log|applog)/i },
];

export interface SalesEngineerInput {
  thread: EmailThread;
  /** Current inbound message, quoted reply chain already stripped. */
  latestMessageText: string;
  /** Cumulative inbound text, used by the rules extractor so it never loses earlier turns. */
  cumulativeText: string;
  priorMessages: EmailMessage[];
  existingProfile: RequirementProfile | undefined;
  catalogue: CatalogueVersion;
  senderEmail: string;
  senderName: string | null;
  subject: string;
  /** Optional email attachments received with this message (PDF, Excel, CSV, text, images). */
  attachments?: MessageAttachment[];
}

export interface SalesDecision {
  /** Auditable record of what was decided and by whom. Persisted by the caller. */
  record: AiDecisionRecord;
  /** Consumed by the existing pipeline exactly as the rules extractor's output was. */
  extraction: ExtractionResult;
  action: AiAction;
}

/**
 * Why the AI path cannot be used right now, or null when it can.
 *
 * Exported so the console and tests can state the reason precisely instead of
 * collapsing every cause into "AI off".
 */
export interface AiAvailability {
  available: boolean;
  category: AiFailureCategory | null;
  detail: string | null;
}

export function getAiAvailability(): AiAvailability {
  const config = getAppConfig();

  if (!config.groqApiKey && !config.cerebrasApiKey && !config.geminiApiKey) {
    return {
      available: false,
      category: "not_configured",
      detail:
        "Neither GROQ_API_KEY nor GEMINI_API_KEY is configured; the rules-based engine decided this thread.",
    };
  }
  if (process.env.DISABLE_AI === "true") {
    return {
      available: false,
      category: "disabled_by_flag",
      detail: "AI is disabled by DISABLE_AI=true; the rules-based engine decided this thread.",
    };
  }
  if (!config.isAiEnabled) {
    return {
      available: false,
      category: "disabled_by_flag",
      detail:
        "AI is blocked in the automated test runtime so tests cannot spend API credits; " +
        "the rules-based engine decided this thread.",
    };
  }
  return { available: true, category: null, detail: null };
}

export interface ProviderChainOptions {
  groq?: AiProvider | null;
  cerebras?: AiProvider | null;
  gemini?: AiProvider | null;
}

function sanitizeFailureText(text: string): string {
  const config = getAppConfig();
  let sanitized = text;
  if (config.groqApiKey) sanitized = sanitized.split(config.groqApiKey).join("[REDACTED_KEY]");
  if (config.cerebrasApiKey) sanitized = sanitized.split(config.cerebrasApiKey).join("[REDACTED_KEY]");
  if (config.geminiApiKey) sanitized = sanitized.split(config.geminiApiKey).join("[REDACTED_KEY]");
  return sanitized
    .replace(/gsk_[0-9A-Za-z_-]{15,}/g, "[REDACTED_KEY]")
    .replace(/csk-[0-9A-Za-z_-]{15,}/g, "[REDACTED_KEY]")
    .replace(/AIza[0-9A-Za-z_-]{15,}/g, "[REDACTED_KEY]")
    .replace(/AQ\.[0-9A-Za-z_-]{15,}/g, "[REDACTED_KEY]");
}

/**
 * Runs the sales engineer for one inbound message.
 *
 * Never throws: every provider or validation failure resolves to a usable
 * decision from the rules fallback, with the reason recorded.
 *
 * An explicitly supplied `provider` is itself the configuration decision and
 * is always used — that is how tests exercise the AI path without credentials.
 * When none is supplied, Groq is attempted first, followed by Gemini.
 */
export async function decideNextAction(
  input: SalesEngineerInput,
  provider?: AiProvider | ProviderChainOptions,
  fallbackProvider?: AiProvider,
): Promise<SalesDecision> {
  // Always compute the deterministic result. It is both the fallback and the
  // source of the commercial metadata the AI schema does not cover.
  const rulesResult = input.existingProfile
    ? mergeRequirements({
        existingProfile: input.existingProfile,
        replyText: input.latestMessageText,
        senderEmail: input.senderEmail,
        senderName: input.senderName,
        subject: input.subject,
        cumulativeText: input.cumulativeText,
      })
    : extractRequirements({
        threadId: input.thread.id,
        senderEmail: input.senderEmail,
        senderName: input.senderName,
        subject: input.subject,
        bodyText: input.cumulativeText,
      });

  if (input.latestMessageText.trim().length === 0) {
    return buildFallbackDecision(input, rulesResult, "empty_input", "Inbound message had no usable body text.");
  }

  const context = buildSalesContext({
    thread: input.thread,
    latestMessageText: input.latestMessageText,
    priorMessages: input.priorMessages,
    existingProfile: input.existingProfile,
    catalogue: input.catalogue,
    attachments: input.attachments,
  });

  const isChainOptions = Boolean(provider && typeof provider === "object" && ("groq" in provider || "cerebras" in provider || "gemini" in provider));
  const explicitChain: ProviderChainOptions | null = isChainOptions
    ? (provider as ProviderChainOptions)
    : provider && fallbackProvider
    ? { groq: provider as AiProvider, gemini: fallbackProvider }
    : null;

  if (provider && !isChainOptions && !fallbackProvider) {
    const single = provider as AiProvider;
    const result = await single.generateDecision({
      systemInstruction: context.systemInstruction,
      userPrompt: context.userPrompt,
    });

    if (!result.ok) {
      const sanitizedDetail = sanitizeFailureText(result.detail);
      const provName = single.name && single.name !== "mock" ? single.name : "the AI provider";
      return buildFallbackDecision(input, rulesResult, result.category, sanitizedDetail, result.latencyMs, provName);
    }

    const source: DecisionSource = single.name === "groq" ? "groq" : single.name === "cerebras" ? "cerebras" : "gemini";
    return buildAiDecision(input, rulesResult, result.decision, result.model, result.latencyMs, source);
  }

  const availability = getAiAvailability();
  if (!availability.available && !explicitChain) {
    return buildFallbackDecision(
      input,
      rulesResult,
      availability.category ?? "not_configured",
      availability.detail ?? "AI provider unavailable.",
    );
  }

  const config = getAppConfig();
  const primaryProvider = explicitChain ? explicitChain.groq : (config.groqApiKey ? groqProvider : null);
  const secondaryProvider = explicitChain ? explicitChain.cerebras : (config.cerebrasApiKey ? cerebrasProvider : null);
  const tertiaryProvider = explicitChain ? explicitChain.gemini : (config.geminiApiKey ? geminiProvider : null);

  let groqFailure: { category: AiFailureCategory; detail: string; latencyMs: number | null } | null = null;
  let cerebrasFailure: { category: AiFailureCategory; detail: string; latencyMs: number | null } | null = null;
  let geminiFailure: { category: AiFailureCategory; detail: string; latencyMs: number | null } | null = null;

  // 1. Primary: Groq
  if (primaryProvider) {
    const groqResult = await primaryProvider.generateDecision({
      systemInstruction: context.systemInstruction,
      userPrompt: context.userPrompt,
    });

    if (groqResult.ok) {
      return buildAiDecision(
        input,
        rulesResult,
        groqResult.decision,
        groqResult.model,
        groqResult.latencyMs,
        "groq",
      );
    }

    groqFailure = {
      category: groqResult.category,
      detail: sanitizeFailureText(groqResult.detail),
      latencyMs: groqResult.latencyMs,
    };
  }

  // 2. Secondary: Cerebras
  if (secondaryProvider) {
    const cerebrasResult = await secondaryProvider.generateDecision({
      systemInstruction: context.systemInstruction,
      userPrompt: context.userPrompt,
    });

    if (cerebrasResult.ok) {
      return buildAiDecision(
        input,
        rulesResult,
        cerebrasResult.decision,
        cerebrasResult.model,
        cerebrasResult.latencyMs,
        "cerebras",
      );
    }

    cerebrasFailure = {
      category: cerebrasResult.category,
      detail: sanitizeFailureText(cerebrasResult.detail),
      latencyMs: cerebrasResult.latencyMs,
    };
  }

  // 3. Tertiary: Gemini
  if (tertiaryProvider) {
    const geminiResult = await tertiaryProvider.generateDecision({
      systemInstruction: context.systemInstruction,
      userPrompt: context.userPrompt,
    });

    if (geminiResult.ok) {
      return buildAiDecision(
        input,
        rulesResult,
        geminiResult.decision,
        geminiResult.model,
        geminiResult.latencyMs,
        "gemini",
      );
    }

    geminiFailure = {
      category: geminiResult.category,
      detail: sanitizeFailureText(geminiResult.detail),
      latencyMs: geminiResult.latencyMs,
    };
  }

  // If providers were attempted and failed, record combined details
  const attemptedFailures = [
    groqFailure ? { name: "groq", ...groqFailure } : null,
    cerebrasFailure ? { name: "cerebras", ...cerebrasFailure } : null,
    geminiFailure ? { name: "gemini", ...geminiFailure } : null,
  ].filter((f): f is { name: string; category: AiFailureCategory; detail: string; latencyMs: number | null } => f !== null);

  if (attemptedFailures.length > 0) {
    const combinedDetail = attemptedFailures
      .map((f) => `${f.name}: ${f.category} - ${f.detail} (${f.latencyMs ?? 0}ms)`)
      .join(" | ");
    const totalLatency = attemptedFailures.reduce((acc, f) => acc + (f.latencyMs ?? 0), 0);
    const primaryCat = attemptedFailures[0]!.category;
    const providerNames = attemptedFailures.map((f) => f.name.charAt(0).toUpperCase() + f.name.slice(1)).join(" / ");
    return buildFallbackDecision(
      input,
      rulesResult,
      primaryCat,
      combinedDetail,
      totalLatency,
      providerNames,
    );
  }

  return buildFallbackDecision(input, rulesResult, "not_configured", "No AI provider configured.", null, "the AI provider");
}

// ---------------------------------------------------------------------------
// AI path
// ---------------------------------------------------------------------------

function buildAiDecision(
  input: SalesEngineerInput,
  rulesResult: ExtractionResult,
  output: AiDecisionOutput,
  model: string,
  latencyMs: number,
  source: DecisionSource = "gemini",
): SalesDecision {
  const supportedCategories = deriveSupportedCategories(input.catalogue);
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- Guard 1: every recommended category must be deliverable ------------
  const unsupportedCategories = output.recommendedProductCategories.filter(
    (category) => !supportedCategories.includes(category),
  );
  const acceptedCategories = output.recommendedProductCategories.filter((category) =>
    supportedCategories.includes(category),
  );
  for (const category of unsupportedCategories) {
    errors.push(
      `Recommended category "${category}" is not deliverable by any plan in catalogue ${input.catalogue.version}.`,
    );
  }

  // --- Guard 2: referenced plan ids must exist ----------------------------
  const knownPlanIds = new Set(input.catalogue.plans.map((plan) => plan.id));
  const unknownPlanIds = output.referencedPlanIds.filter((planId) => !knownPlanIds.has(planId));
  for (const planId of unknownPlanIds) {
    // Advisory field only — the engine ranks plans itself, so this cannot
    // affect a price. Recorded so hallucinated ids stay visible.
    warnings.push(`Referenced plan id "${planId}" does not exist in the active catalogue and was ignored.`);
  }

  // --- Guard 3: quantities must be plausible whole numbers and validated against source text ---
  const availableSourceText = `${input.latestMessageText}\n${input.cumulativeText}`;
  const aiQuantities = new Map<
    DemandUnit,
    { quantity: number; basis: "stated" | "inferred"; evidence: string; confidence: number; conflictWith?: string | null }
  >();
  const disagreementReasons: string[] = [];

  for (const requirement of output.knownRequirements) {
    const bound = QUANTITY_BOUNDS[requirement.unit];
    if (!Number.isSafeInteger(requirement.quantity) || requirement.quantity < 0) {
      errors.push(`Quantity for ${UNIT_LABELS[requirement.unit]} was not a whole non-negative number.`);
      continue;
    }
    if (requirement.quantity > bound) {
      errors.push(
        `Quantity for ${UNIT_LABELS[requirement.unit]} (${requirement.quantity.toLocaleString("en-IN")}) exceeds the sanity bound of ${bound.toLocaleString("en-IN")} and needs human confirmation.`,
      );
      continue;
    }

    const modelSupported = isModelEvidenceSupported(requirement.evidence, requirement.quantity, availableSourceText);
    const deterministicVal = rulesResult.demand[requirement.unit];
    const deterministicReq = rulesResult.intakeRequirements?.[requirement.unit];
    const deterministicState = deterministicReq?.state;
    const deterministicEvidence = deterministicReq?.evidence;
    const rulesHasEvidence =
      (deterministicState === "stated" || (Boolean(deterministicEvidence) && deterministicEvidence!.trim().length > 0)) &&
      deterministicVal !== null &&
      deterministicVal !== undefined;

    let finalQuantity = requirement.quantity;
    let finalEvidence = requirement.evidence;
    let finalBasis = requirement.basis;
    let conflictWith: string | null = null;

    if (!modelSupported && requirement.quantity > 0) {
      // Model quantity has no supporting evidence at all -> Silent override to deterministic value
      warnings.push(
        `AI quantity ${requirement.quantity} for ${UNIT_LABELS[requirement.unit]} lacks a valid evidence span in the source text; falling back to deterministic value ${deterministicVal}.`,
      );
      finalQuantity = deterministicVal;
      finalEvidence = deterministicEvidence || requirement.evidence;
      finalBasis = deterministicState === "stated" ? "stated" : "inferred";
    } else if (modelSupported && rulesHasEvidence && deterministicVal !== requirement.quantity) {
      // Both model and rules have evidence, but disagree:
      // Do NOT silently let either one win. Record both values and route to human_review.
      const reason = `AI says ${requirement.quantity}, rules say ${deterministicVal} for ${UNIT_LABELS[requirement.unit]}`;
      disagreementReasons.push(reason);
      warnings.push(`Disagreement on ${UNIT_LABELS[requirement.unit]}: ${reason}`);
      conflictWith = `rules: ${deterministicVal} (${deterministicEvidence})`;
      finalQuantity = requirement.quantity;
      finalEvidence = `${requirement.evidence} (rules: ${deterministicVal} via "${deterministicEvidence}")`;
    }

    // Last value wins if the model emitted a unit twice; both are recorded.
    if (aiQuantities.has(requirement.unit)) {
      warnings.push(`${UNIT_LABELS[requirement.unit]} was reported more than once; the last value was used.`);
    }
    aiQuantities.set(requirement.unit, {
      quantity: finalQuantity,
      basis: finalBasis,
      evidence: finalEvidence,
      confidence: requirement.confidence,
      conflictWith,
    });
  }

  // --- Guard 4: no requirement may be lost to model omission --------------
  // Anything already established stays established unless the model supplied a
  // replacement for that same unit. A forgetful model cannot shrink the demand.
  const retainedFields = new Map<string, RequirementField>();
  for (const field of input.existingProfile?.fields ?? []) {
    if (field.state === "provided" || field.state === "inferred") {
      retainedFields.set(field.key, field);
    }
  }

  const blockingUnits = new Set<DemandUnit>();
  for (const missing of output.missingRequirements) {
    // A unit the model also reported a quantity for is not missing.
    if (aiQuantities.has(missing.unit)) {
      warnings.push(
        `${UNIT_LABELS[missing.unit]} was listed as both known and missing; the known quantity was used.`,
      );
      continue;
    }
    // Nor is one already established in an earlier turn.
    const fieldKey = UNIT_FIELD_KEYS[missing.unit].key;
    if (retainedFields.has(fieldKey)) {
      warnings.push(
        `${UNIT_LABELS[missing.unit]} was listed as missing but is already established; the established value was kept.`,
      );
      continue;
    }
    if (missing.blocksPricing) blockingUnits.add(missing.unit);
  }

  // --- Build the demand ---------------------------------------------------
  const demand: PricingDemand = { ...emptyPricingDemand() };
  const fields: RequirementField[] = [];

  for (const unit of DEMAND_UNITS) {
    const meta = UNIT_FIELD_KEYS[unit];
    const fromAi = aiQuantities.get(unit);
    const retained = retainedFields.get(meta.key);

    if (fromAi) {
      demand[unit] = fromAi.quantity;
      fields.push({
        key: meta.key,
        label: meta.label,
        group: meta.group,
        value: fromAi.quantity,
        unit: meta.unit,
        state: fromAi.basis === "stated" ? "provided" : "inferred",
        confidence: fromAi.confidence,
        evidence: fromAi.evidence || null,
        conflictWith: fromAi.conflictWith ?? null,
        previousValue:
          retained && retained.value !== fromAi.quantity ? retained.value : retained?.previousValue ?? null,
        materialToPricing: true,
      });
      continue;
    }

    if (retained) {
      demand[unit] = Number(retained.value) || 0;
      fields.push({ ...retained });
      continue;
    }

    if (blockingUnits.has(unit)) {
      fields.push({
        key: meta.key,
        label: meta.label,
        group: meta.group,
        value: null,
        unit: meta.unit,
        state: "missing",
        confidence: null,
        evidence: null,
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      });
    }
  }

  // Carry forward non-quantity context fields (website monitoring, APM flags,
  // currency, billing period) from the established profile and the rules pass,
  // so the profile the operator sees is not thinner than before.
  for (const field of mergeContextFields(input.existingProfile, rulesResult)) {
    if (!fields.some((existing) => existing.key === field.key)) {
      fields.push(field);
    }
  }

  // --- Guard 5: drop any question that is already answered ----------------
  const knownFieldKeys = new Set(
    fields.filter((field) => field.state === "provided" || field.state === "inferred").map((field) => field.key),
  );
  const acceptedQuestions: string[] = [];
  for (const question of output.followUpQuestions) {
    const askedUnits = QUESTION_UNIT_HINTS.filter((hint) => hint.match.test(question)).map((hint) => hint.unit);
    const allAlreadyKnown =
      askedUnits.length > 0 && askedUnits.every((unit) => knownFieldKeys.has(UNIT_FIELD_KEYS[unit].key));
    if (allAlreadyKnown) {
      warnings.push(`Dropped a follow-up question that asked for information already on file: "${truncateForLog(question)}"`);
      continue;
    }
    acceptedQuestions.push(question);
  }

  // --- Guard 6: resolve the action (Rule 1: code decides ask vs quote) -----
  const roundsSpent = input.existingProfile?.clarificationRound ?? 0;
  const hasPrimaryWorkload = DEMAND_UNITS.some((unit) => demand[unit] > 0);
  const missingMaterialFields = fields
    .filter((field) => field.state === "missing" && field.materialToPricing)
    .map((field) => field.key);

  const humanReviewReasons = [...output.humanReviewReasons, ...disagreementReasons];
  let action: AiAction;

  if (errors.length > 0) {
    action = "human_review";
    humanReviewReasons.push(...errors);
  } else if (output.action === "human_review" || humanReviewReasons.length > 0) {
    action = "human_review";
  } else if (missingMaterialFields.length > 0 || !hasPrimaryWorkload) {
    if (clarificationLimitReached(roundsSpent)) {
      action = "human_review";
      humanReviewReasons.push(
        `Clarification limit reached (${roundsSpent + 1} of ${MAX_CLARIFICATION_ROUNDS} rounds) with requirements still incomplete.`,
      );
    } else {
      action = "ask_follow_up";
      if (output.action === "prepare_quote") {
        if (missingMaterialFields.length > 0) {
          warnings.push(
            `Model chose prepare_quote while ${missingMaterialFields.join(", ")} remained unknown; corrected to ask_follow_up.`,
          );
        } else {
          warnings.push("Model chose prepare_quote with no billable quantity in the configuration; corrected to ask_follow_up.");
        }
      }
    }
  } else {
    // Requirements are complete and billable workload is present: code quotes
    action = "prepare_quote";
    if (output.action === "ask_follow_up") {
      warnings.push("Model chose ask_follow_up but all required sizing parameters are complete; corrected to prepare_quote.");
    }
  }

  // Synthesize a valid question if action is ask_follow_up and model gave none
  if (action === "ask_follow_up" && acceptedQuestions.length === 0) {
    const missingDescriptions: string[] = [];
    if (missingMaterialFields.includes("servers")) {
      missingDescriptions.push("how many servers or virtual hosts you plan to monitor");
    }
    if (missingMaterialFields.includes("network_devices")) {
      missingDescriptions.push("how many network devices (switches, routers, firewalls) you need to monitor");
    }
    if (missingMaterialFields.includes("advanced_monitors")) {
      missingDescriptions.push("how many synthetic transaction or advanced web/application monitors you require");
    }
    if (missingMaterialFields.includes("basic_monitors")) {
      missingDescriptions.push("how many basic website checks or URLs you require");
    }
    if (!hasPrimaryWorkload && missingDescriptions.length === 0) {
      missingDescriptions.push("the number of servers, websites, or network devices you plan to monitor");
    }
    const synthesizedQuestion = `To calculate an accurate Site24x7 quotation, could you please specify ${missingDescriptions.join("; ")}?`;
    acceptedQuestions.push(synthesizedQuestion);
  }

  const suggestedQuestion: ClarificationQuestion | null =
    action === "ask_follow_up" && acceptedQuestions.length > 0
      ? {
          id: `cq_${Date.now()}`,
          fieldKeys: missingMaterialFields.length > 0 ? missingMaterialFields : [...knownFieldKeys].slice(0, 1),
          question: acceptedQuestions.join("\n"),
          reason: output.reasoningSummary,
          askedAt: new Date().toISOString(),
          answeredAt: null,
          answerSummary: null,
        }
      : null;

  const profile: RequirementProfile = {
    id: `prof_${Date.now()}`,
    threadId: input.thread.id,
    version: (input.existingProfile?.version ?? 0) + 1,
    supersedesProfileId: input.existingProfile?.id ?? null,
    createdAt: new Date().toISOString(),
    extractorModel: `${source}:${model}`,
    extractorRunId: `ai_${Date.now()}`,
    fields,
    summary: output.customerSummary,
    pendingQuestions: suggestedQuestion
      ? [...carryPendingQuestions(input.existingProfile, knownFieldKeys), suggestedQuestion]
      : [],
    answeredQuestions: resolveAnsweredQuestions(input.existingProfile, knownFieldKeys),
    clarificationRound: action === "ask_follow_up" ? roundsSpent + 1 : roundsSpent,
    intakeRequirements: rulesResult.intakeRequirements,
    optionalParameters: rulesResult.optionalParameters,
    triageCategory: rulesResult.triageCategory,
  };

  const validation: AiValidationOutcome = {
    passed: errors.length === 0,
    errors,
    warnings,
    unsupportedCategories,
    unknownPlanIds,
  };

  const record: AiDecisionRecord = {
    id: `aid_${Date.now()}`,
    threadId: input.thread.id,
    profileId: profile.id,
    createdAt: new Date().toISOString(),
    source,
    model,
    action,
    originalAction: action === output.action ? null : output.action,
    customerSummary: output.customerSummary,
    identifiedNeeds: output.identifiedNeeds,
    recommendedCategories: acceptedCategories,
    referencedPlanIds: output.referencedPlanIds.filter((planId) => knownPlanIds.has(planId)),
    assumptions: output.assumptions,
    followUpQuestions: acceptedQuestions,
    reasoningSummary: output.reasoningSummary,
    confidence: output.confidence,
    humanReviewReasons,
    validation,
    failureCategory: null,
    failureDetail: null,
    latencyMs,
    catalogueVersion: input.catalogue.version,
    conversationalResponse: output.conversationalResponse || null,
  };

  return {
    record,
    action,
    extraction: {
      profile,
      demand,
      isComplete: action === "prepare_quote",
      missingMaterialFields,
      suggestedQuestion,
      clarificationQuestions: [],
      organization: rulesResult.organization,
      billingPeriod: rulesResult.billingPeriod,
      currency: rulesResult.currency,
      conversationalResponse: output.conversationalResponse || null,
      triageCategory: rulesResult.triageCategory,
      isSubstantive: rulesResult.isSubstantive,
      intakeRequirements: rulesResult.intakeRequirements,
      optionalParameters: rulesResult.optionalParameters,
    },
  };
}

// ---------------------------------------------------------------------------
// Fallback path
// ---------------------------------------------------------------------------

/**
 * Wraps the rules-based result as a decision.
 *
 * The rules engine's own judgement is preserved exactly: its completeness
 * check decides whether to quote or ask, and its generated question is used
 * verbatim. The record states plainly that Gemini did not decide this thread.
 */
function buildFallbackDecision(
  input: SalesEngineerInput,
  rulesResult: ExtractionResult,
  category: AiFailureCategory,
  detail: string,
  latencyMs: number | null = null,
  providerName = "the AI provider",
): SalesDecision {
  const roundsSpent = input.existingProfile?.clarificationRound ?? 0;
  const humanReviewReasons: string[] = [];

  let action: AiAction;
  if (rulesResult.isComplete) {
    action = "prepare_quote";
  } else if (clarificationLimitReached(roundsSpent)) {
    action = "human_review";
    humanReviewReasons.push(
      `Clarification limit reached (${roundsSpent + 1} of ${MAX_CLARIFICATION_ROUNDS} rounds); still missing: ${rulesResult.missingMaterialFields.join(", ")}.`,
    );
  } else if (rulesResult.suggestedQuestion) {
    action = "ask_follow_up";
  } else {
    action = "human_review";
    humanReviewReasons.push("The rules-based engine could not size this request and had no question to ask.");
  }

  const record: AiDecisionRecord = {
    id: `aid_${Date.now()}`,
    threadId: input.thread.id,
    profileId: rulesResult.profile.id,
    createdAt: new Date().toISOString(),
    source: "rules_fallback",
    model: null,
    action,
    originalAction: null,
    customerSummary: rulesResult.profile.summary,
    identifiedNeeds: deriveNeedsFromDemand(rulesResult.demand),
    recommendedCategories: deriveCategoriesFromDemand(rulesResult.demand, input.catalogue),
    referencedPlanIds: [],
    assumptions: [],
    followUpQuestions: rulesResult.suggestedQuestion ? [rulesResult.suggestedQuestion.question] : [],
    reasoningSummary:
      `Decided by the deterministic rules engine, not by ${providerName}. ${truncateForLog(detail, 200)} ` +
      `Pattern extraction found ${rulesResult.missingMaterialFields.length} unresolved material field(s).`,
    confidence: null,
    humanReviewReasons,
    validation: {
      passed: true,
      errors: [],
      warnings: [`AI path unavailable (${category}); deterministic fallback used.`],
      unsupportedCategories: [],
      unknownPlanIds: [],
    },
    failureCategory: category,
    failureDetail: detail,
    latencyMs,
    catalogueVersion: input.catalogue.version,
  };

  return { record, action, extraction: rulesResult };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyPricingDemand(): PricingDemand {
  return {
    basic_monitor: 0,
    advanced_monitor: 0,
    host_monitor: 0,
    network_component: 0,
    rum_pageview: 0,
    applog_gb: 0,
  };
}

/** Non-quantity fields worth preserving: capability flags and commercial metadata. */
function mergeContextFields(
  existingProfile: RequirementProfile | undefined,
  rulesResult: ExtractionResult,
): RequirementField[] {
  const output: RequirementField[] = [];
  const seen = new Set<string>();

  const consider = (field: RequirementField) => {
    if (FIELD_KEY_TO_UNIT.has(field.key)) return; // quantities are owned by the AI path
    if (seen.has(field.key)) return;
    if (field.state === "missing") return;
    seen.add(field.key);
    output.push({ ...field });
  };

  for (const field of existingProfile?.fields ?? []) consider(field);
  for (const field of rulesResult.profile.fields) consider(field);

  return output;
}

/** Questions still unanswered after this turn's merge. */
function carryPendingQuestions(
  existingProfile: RequirementProfile | undefined,
  knownFieldKeys: Set<string>,
): ClarificationQuestion[] {
  return (existingProfile?.pendingQuestions ?? []).filter(
    (question) => !question.fieldKeys.every((key) => knownFieldKeys.has(key)),
  );
}

/** Previously pending questions whose fields are now known become answered. */
function resolveAnsweredQuestions(
  existingProfile: RequirementProfile | undefined,
  knownFieldKeys: Set<string>,
): ClarificationQuestion[] {
  if (!existingProfile) return [];
  const newlyAnswered = existingProfile.pendingQuestions
    .filter((question) => question.fieldKeys.length > 0 && question.fieldKeys.every((key) => knownFieldKeys.has(key)))
    .map((question) => ({
      ...question,
      answeredAt: new Date().toISOString(),
      answerSummary: `Resolved from the customer's reply for: ${question.fieldKeys.join(", ")}.`,
    }));
  return [...existingProfile.answeredQuestions, ...newlyAnswered];
}

function deriveNeedsFromDemand(demand: PricingDemand): string[] {
  return DEMAND_UNITS.filter((unit) => demand[unit] > 0).map(
    (unit) => `${UNIT_LABELS[unit]}: ${demand[unit].toLocaleString("en-IN")}`,
  );
}

function deriveCategoriesFromDemand(demand: PricingDemand, catalogue: CatalogueVersion): ProductCategory[] {
  const supported = deriveSupportedCategories(catalogue);
  const derived: ProductCategory[] = [];
  if (demand.host_monitor > 0) derived.push("infrastructure_monitoring");
  if (demand.network_component > 0) derived.push("network_monitoring");
  if (demand.basic_monitor > 0) derived.push("website_monitoring");
  if (demand.advanced_monitor > 0) derived.push("synthetic_monitoring");
  if (demand.rum_pageview > 0) derived.push("real_user_monitoring");
  if (demand.applog_gb > 0) derived.push("log_management");
  return derived.filter((category) => supported.includes(category));
}

function truncateForLog(text: string, limit = 120): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit)}...` : collapsed;
}
