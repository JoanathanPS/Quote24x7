import type { EmailMessage, RequirementProfile } from "@/types/domain";
import type { AiProvider } from "../gemini-provider.ts";
import type { AiDecisionOutput } from "../decision-schema.ts";
import { loadActiveCatalogue } from "../../catalogue/loader.ts";
import { buildSalesContext } from "../context-builder.ts";
import { BENCHMARK_CASES } from "./datasets/benchmark-cases.ts";
import { detectHallucinations } from "./detectors/hallucination-detector.ts";
import { evaluateAccuracy } from "./accuracy-evaluator.ts";
import type {
  BenchmarkCase,
  BenchmarkCategory,
  BenchmarkSummaryReport,
  CaseEvaluationResult,
  HallucinationSeverity,
  HallucinationType,
} from "./types.ts";
import { extractRequirements, mergeRequirements } from "../../extraction/extractor.ts";
import type { DemandUnit } from "../../pricing/engine.ts";

export interface BenchmarkRunnerOptions {
  provider?: AiProvider;
  categoryFilter?: BenchmarkCategory;
  cases?: BenchmarkCase[];
  useRulesBaseline?: boolean;
}

/**
 * Runs the evaluation benchmark suite across the benchmark dataset.
 */
export async function runBenchmark(
  options: BenchmarkRunnerOptions = {},
): Promise<BenchmarkSummaryReport> {
  const catalogue = loadActiveCatalogue();
  const allCases = options.cases || BENCHMARK_CASES;
  const filteredCases = options.categoryFilter
    ? allCases.filter((c) => c.category === options.categoryFilter)
    : allCases;

  const caseResults: CaseEvaluationResult[] = [];
  const modelName = options.useRulesBaseline
    ? "rules_deterministic_baseline"
    : options.provider?.name || "gemini-3.8-flash";

  for (const bCase of filteredCases) {
    const startTime = Date.now();
    let decisionOutput: AiDecisionOutput;
    let latencyMs = 0;

    if (options.useRulesBaseline || !options.provider) {
      // Deterministic rules-based baseline
      decisionOutput = generateRulesBaselineDecision(bCase);
      latencyMs = Date.now() - startTime;
    } else {
      // AI Provider evaluation
      const syntheticThread = {
        id: `bench_th_${bCase.id}`,
        provider: "resend" as const,
        providerThreadId: `bench_p_${bCase.id}`,
        senderEmail: bCase.input.senderEmail || "eval-client@example.com",
        senderName: bCase.input.senderName || null,
        organisation: null,
        subject: bCase.input.subject,
        status: "received" as const,
        requestType: "quote" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        messageCount: (bCase.input.priorMessages?.length || 0) + 1,
        quoteId: null,
        quoteTotal: null,
        currency: "INR" as const,
        statusDetail: null,
      };

      const syntheticPriorMessages: EmailMessage[] = (bCase.input.priorMessages || []).map((m, idx) => ({
        id: `prior_msg_${idx}`,
        threadId: syntheticThread.id,
        providerMessageId: `prior_p_${idx}`,
        direction: m.direction,
        fromAddress: m.direction === "inbound" ? syntheticThread.senderEmail : "quotes@quotes.joanathan.in",
        fromName: m.direction === "inbound" ? (syntheticThread.senderName || "Customer") : "Quote24x7 Assistant",
        toAddresses: [m.direction === "inbound" ? "quotes@quotes.joanathan.in" : syntheticThread.senderEmail],
        subject: bCase.input.subject,
        bodyText: m.bodyText,
        occurredAt: new Date().toISOString(),
        deliveryId: null,
        securityNotes: [],
        attachments: [],
      }));

      const context = buildSalesContext({
        thread: syntheticThread,
        latestMessageText: bCase.input.messageText,
        priorMessages: syntheticPriorMessages,
        existingProfile: bCase.input.existingRequirements
          ? createSyntheticProfile(`prof_${bCase.id}`, syntheticThread.id, bCase.input.existingRequirements)
          : undefined,
        catalogue,
      });

      const result = await options.provider.generateDecision({
        systemInstruction: context.systemInstruction,
        userPrompt: context.userPrompt,
      });

      latencyMs = Date.now() - startTime;
      if (!result.ok) {
        // Provider error fallback
        decisionOutput = {
          action: "human_review",
          customerSummary: `Provider error: ${result.detail}`,
          identifiedNeeds: [],
          knownRequirements: [],
          missingRequirements: [],
          assumptions: [],
          recommendedProductCategories: [],
          referencedPlanIds: [],
          followUpQuestions: [],
          reasoningSummary: `Failed to invoke provider: ${result.detail}`,
          confidence: 0,
          humanReviewReasons: [result.detail],
          conversationalResponse: null,
        };
      } else {
        decisionOutput = result.decision;
      }
    }

    // Detect hallucinations
    const hallucinations = detectHallucinations(decisionOutput, bCase, catalogue);

    // Evaluate accuracy against ground truth
    const caseResult = evaluateAccuracy(decisionOutput, bCase, hallucinations, latencyMs);
    caseResults.push(caseResult);
  }

  return aggregateBenchmarkReport(caseResults, modelName, catalogue.version);
}

function createSyntheticProfile(
  id: string,
  threadId: string,
  requirements?: Partial<Record<DemandUnit, number>>,
): RequirementProfile {
  return {
    id,
    threadId,
    version: 1,
    supersedesProfileId: null,
    createdAt: new Date().toISOString(),
    extractorModel: "synthetic",
    extractorRunId: null,
    summary: "Synthetic benchmark profile",
    fields: Object.entries(requirements || {}).map(([unit, val]) => ({
      key: unit,
      label: unit,
      value: val,
      unit,
      group: "infrastructure" as const,
      state: "provided" as const,
      confidence: 1.0,
      evidence: null,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    })),
    pendingQuestions: [],
    answeredQuestions: [],
    clarificationRound: 0,
  };
}

/**
 * Builds an AiDecisionOutput directly from the rules engine so the benchmark can run
 * as a baseline without network calls or API keys.
 */
function generateRulesBaselineDecision(bCase: BenchmarkCase): AiDecisionOutput {
  const fullText = [
    bCase.input.messageText,
    ...(bCase.input.priorMessages?.map((m) => m.bodyText) || []),
  ].join("\n\n");

  const rules = bCase.input.existingRequirements
    ? mergeRequirements({
        existingProfile: createSyntheticProfile(
          `prof_rules_${bCase.id}`,
          `th_${bCase.id}`,
          bCase.input.existingRequirements,
        ),
        replyText: fullText,
        senderEmail: bCase.input.senderEmail || "eval@test.com",
        senderName: bCase.input.senderName || null,
        subject: bCase.input.subject,
      })
    : extractRequirements({
        threadId: `th_${bCase.id}`,
        senderEmail: bCase.input.senderEmail || "eval@test.com",
        senderName: bCase.input.senderName || null,
        subject: bCase.input.subject,
        bodyText: fullText,
      });

  const knownRequirements: AiDecisionOutput["knownRequirements"] = [];
  const unitFieldMap: Record<DemandUnit, string> = {
    host_monitor: "servers",
    basic_monitor: "basic_monitors",
    advanced_monitor: "advanced_monitors",
    network_component: "network_devices",
    rum_pageview: "rum_pageviews",
    applog_gb: "applogs_volume",
  };

  for (const [unit, fieldKey] of Object.entries(unitFieldMap) as Array<[DemandUnit, string]>) {
    const field = rules.profile.fields.find((f) => f.key === fieldKey);
    if (field && typeof field.value === "number" && field.value > 0) {
      knownRequirements.push({
        unit,
        quantity: field.value,
        basis: field.state === "inferred" ? "inferred" : "stated",
        evidence: field.evidence || `${field.value} ${unit}`,
        confidence: 0.95,
      });
    }
  }

  const missingRequirements: AiDecisionOutput["missingRequirements"] = rules.missingMaterialFields.map((fieldKey) => {
    let unit: DemandUnit = "host_monitor";
    if (fieldKey === "servers") unit = "host_monitor";
    else if (fieldKey === "basic_monitors") unit = "basic_monitor";
    else if (fieldKey === "advanced_monitors") unit = "advanced_monitor";
    else if (fieldKey === "rum_pageviews") unit = "rum_pageview";
    else if (fieldKey === "applogs_volume") unit = "applog_gb";
    else if (fieldKey === "network_devices") unit = "network_component";

    return {
      unit,
      whyItMatters: rules.suggestedQuestion?.question || `Missing quantity for ${unit}`,
      blocksPricing: true,
    };
  });

  const followUpQuestions = rules.suggestedQuestion ? [rules.suggestedQuestion.question] : [];

  const action =
    rules.missingMaterialFields.length > 0 || !rules.isComplete
      ? "ask_follow_up"
      : "prepare_quote";

  return {
    action,
    customerSummary: "Baseline rule extraction",
    identifiedNeeds: knownRequirements.map((r) => r.unit),
    knownRequirements,
    missingRequirements,
    assumptions: [],
    recommendedProductCategories: ["infrastructure_monitoring"],
    referencedPlanIds: [],
    followUpQuestions,
    reasoningSummary: `Deterministic rules extracted ${knownRequirements.length} units with ${missingRequirements.length} missing.`,
    confidence: 0.9,
    humanReviewReasons: [],
    conversationalResponse: null,
  };
}

/**
 * Aggregates individual case evaluation results into a comprehensive scorecard report.
 */
function aggregateBenchmarkReport(
  caseResults: CaseEvaluationResult[],
  modelOrEngine: string,
  catalogueVersion: string,
): BenchmarkSummaryReport {
  const totalCases = caseResults.length;
  const passedCases = caseResults.filter((c) => c.passed).length;
  const passRate = totalCases > 0 ? passedCases / totalCases : 0;

  // Action accuracy & confusion matrix
  let actionMatches = 0;
  const actionConfusionMatrix: Record<string, Record<string, number>> = {
    prepare_quote: { prepare_quote: 0, ask_follow_up: 0, human_review: 0 },
    ask_follow_up: { prepare_quote: 0, ask_follow_up: 0, human_review: 0 },
    human_review: { prepare_quote: 0, ask_follow_up: 0, human_review: 0 },
  };

  for (const c of caseResults) {
    if (c.actionMatch) actionMatches++;
    const exp = c.actionExpected;
    const act = c.actionActual;
    if (actionConfusionMatrix[exp] && actionConfusionMatrix[exp][act] !== undefined) {
      actionConfusionMatrix[exp][act]++;
    }
  }
  const actionAccuracy = totalCases > 0 ? actionMatches / totalCases : 0;

  // Quantity metrics
  let totalExactMatches = 0;
  let totalExpectedQuantities = 0;
  let totalFalsePositives = 0;
  let _totalFalseNegatives = 0;

  for (const c of caseResults) {
    totalExactMatches += c.quantityAccuracy.exactMatches;
    totalExpectedQuantities += c.quantityAccuracy.totalExpected;
    totalFalsePositives += c.quantityAccuracy.falsePositives;
    _totalFalseNegatives += c.quantityAccuracy.falseNegatives;
  }

  const overallQuantityPrecision =
    totalExactMatches + totalFalsePositives > 0
      ? totalExactMatches / (totalExactMatches + totalFalsePositives)
      : 1;
  const overallQuantityRecall =
    totalExpectedQuantities > 0 ? totalExactMatches / totalExpectedQuantities : 1;
  const overallQuantityF1 =
    overallQuantityPrecision + overallQuantityRecall > 0
      ? (2 * overallQuantityPrecision * overallQuantityRecall) /
        (overallQuantityPrecision + overallQuantityRecall)
      : 0;
  const exactMatchRate =
    totalCases > 0
      ? caseResults.filter(
          (c) =>
            c.quantityAccuracy.exactMatches === c.quantityAccuracy.totalExpected &&
            c.quantityAccuracy.falsePositives === 0,
        ).length / totalCases
      : 0;

  // Missing requirements recall
  let totalMissingExpected = 0;
  let totalMissingMatched = 0;
  for (const c of caseResults) {
    totalMissingExpected += c.missingRequirementsAccuracy.expected.length;
    totalMissingMatched += c.missingRequirementsAccuracy.matched.length;
  }
  const missingRequirementRecall =
    totalMissingExpected > 0 ? totalMissingMatched / totalMissingExpected : 1;

  // Hallucination metrics
  const byType: Record<HallucinationType, number> = {
    fabricated_quantity: 0,
    unfaithful_evidence: 0,
    commercial_pricing_leak: 0,
    unsupported_category: 0,
    schema_contradiction: 0,
    phantom_plan: 0,
  };
  const bySeverity: Record<HallucinationSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  let totalHallucinations = 0;
  let casesWithHallucination = 0;

  for (const c of caseResults) {
    if (c.hallucinations.length > 0) {
      casesWithHallucination++;
      for (const h of c.hallucinations) {
        totalHallucinations++;
        byType[h.type]++;
        bySeverity[h.severity]++;
      }
    }
  }

  const hallucinationFreeRate =
    totalCases > 0 ? (totalCases - casesWithHallucination) / totalCases : 1;

  // Category breakdown
  const categoryBreakdown: BenchmarkSummaryReport["categoryBreakdown"] = {
    standard_quotes: { total: 0, passed: 0, passRate: 0, hallucinations: 0 },
    unit_conversion: { total: 0, passed: 0, passRate: 0, hallucinations: 0 },
    missing_requirements: { total: 0, passed: 0, passRate: 0, hallucinations: 0 },
    hallucination_traps: { total: 0, passed: 0, passRate: 0, hallucinations: 0 },
    adversarial_and_unsupported: { total: 0, passed: 0, passRate: 0, hallucinations: 0 },
    multi_turn_conversations: { total: 0, passed: 0, passRate: 0, hallucinations: 0 },
  };

  for (const c of caseResults) {
    const entry = categoryBreakdown[c.category];
    if (entry) {
      entry.total++;
      if (c.passed) entry.passed++;
      entry.hallucinations += c.hallucinations.length;
    }
  }

  for (const cat of Object.keys(categoryBreakdown) as BenchmarkCategory[]) {
    const item = categoryBreakdown[cat];
    item.passRate = item.total > 0 ? item.passed / item.total : 0;
  }

  return {
    timestamp: new Date().toISOString(),
    modelOrEngine,
    catalogueVersion,
    totalCases,
    passedCases,
    passRate,
    accuracy: {
      actionAccuracy,
      actionConfusionMatrix,
      overallQuantityPrecision,
      overallQuantityRecall,
      overallQuantityF1,
      exactMatchRate,
      missingRequirementRecall,
    },
    hallucination: {
      totalHallucinations,
      casesWithHallucination,
      hallucinationFreeRate,
      byType,
      bySeverity,
    },
    categoryBreakdown,
    caseResults,
  };
}
