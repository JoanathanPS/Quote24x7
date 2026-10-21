import type { CatalogueVersion } from "@/types/domain";
import type { AiDecisionOutput } from "../../decision-schema.ts";
import type { BenchmarkCase, HallucinationFinding } from "../types.ts";
import { deriveSupportedCategories } from "../../context-builder.ts";
import { UNIT_LABELS } from "../../../pricing/engine.ts";

/** Regex identifying explicit currency amounts, price figures, and discount commitments */
const COMMERCIAL_PRICE_PATTERN =
  /(?:[\$₹€£]|INR|USD|EUR|GBP)\s*\d+(?:[.,]\d+)?|\b\d+\s*(?:INR|USD|rupees|dollars)\b|\b(?:\d+%\s*discount|free\s*tier|zero\s*cost|free\s*for\s*you|pricing\s*at|costs\s*about|fee\s*of)\b/i;

/** Keywords suggesting unsupported non-monitoring capability claims */
const UNSUPPORTED_DOMAINS = [
  { match: /\b(?:payroll|salary|payslip|pf\s*deduction)\b/i, domain: "payroll / HR" },
  { match: /\b(?:hardware\s*replacement|technician\s*dispatch|motherboard\s*repair)\b/i, domain: "hardware maintenance" },
  { match: /\b(?:crm|leads\s*management|sales\s*pipeline)\b/i, domain: "CRM" },
  { match: /\b(?:erp|inventory\s*warehouse|supply\s*chain)\b/i, domain: "ERP" },
];

/**
 * Normalizes text for fuzzy containment checking (lower-case, whitespace, punctuation).
 */
function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detects hallucinations in an AI sales engineer decision output against
 * the input text, conversation context, catalogue, and test case expectations.
 */
export function detectHallucinations(
  output: AiDecisionOutput,
  benchmarkCase: BenchmarkCase,
  catalogue: CatalogueVersion,
): HallucinationFinding[] {
  const findings: HallucinationFinding[] = [];
  const fullInputText = [
    benchmarkCase.input.subject,
    benchmarkCase.input.messageText,
    ...(benchmarkCase.input.priorMessages?.map((m) => m.bodyText) || []),
  ].join("\n\n");
  const normalizedInput = normalizeForMatching(fullInputText);

  // -------------------------------------------------------------------------
  // 1. Fabricated Quantity Detection
  // -------------------------------------------------------------------------
  for (const req of output.knownRequirements) {
    // If ground truth says this unit must not be extracted (e.g. unstated/vague)
    if (benchmarkCase.groundTruth.mustNotHaveUnits?.includes(req.unit)) {
      findings.push({
        type: "fabricated_quantity",
        severity: "critical",
        field: `knownRequirements[${req.unit}]`,
        description: `Model hallucinated quantity ${req.quantity} for '${UNIT_LABELS[req.unit]}', which was unstated or vague in the email.`,
        evidenceSnippet: req.evidence,
      });
      continue;
    }

    // Check if non-zero quantity is stated, but the number appears nowhere in the input text
    // (excluding 1 basic monitor for single website inference, which is an explicitly allowed domain rule)
    const isSingleWebsiteInference =
      req.unit === "basic_monitor" && req.quantity === 1 && req.basis === "inferred";

    if (req.quantity > 0 && !isSingleWebsiteInference) {
      const quantityStr = String(req.quantity);
      const appearsInInput =
        normalizedInput.includes(quantityStr) ||
        // Check written numbers (e.g. 'twenty five')
        numberToWordsMatch(req.quantity, normalizedInput);

      // Check evidence string contains numbers or source
      const evidenceContainsNumber = /\d+/.test(req.evidence);

      if (!appearsInInput && !evidenceContainsNumber && req.basis === "stated") {
        findings.push({
          type: "fabricated_quantity",
          severity: "high",
          field: `knownRequirements[${req.unit}]`,
          description: `Model claimed stated quantity of ${req.quantity} for '${UNIT_LABELS[req.unit]}', but the number is not grounded in customer text.`,
          evidenceSnippet: req.evidence,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Unfaithful Evidence Grounding Detection
  // -------------------------------------------------------------------------
  for (const req of output.knownRequirements) {
    if (!req.evidence || req.evidence.trim().length === 0) {
      findings.push({
        type: "unfaithful_evidence",
        severity: "medium",
        field: `knownRequirements[${req.unit}].evidence`,
        description: `Model reported known requirement for '${UNIT_LABELS[req.unit]}' without citing supporting evidence.`,
      });
      continue;
    }

    const normalizedEvidence = normalizeForMatching(req.evidence);
    // Take words of at least 4 characters to avoid false alarms on stopwords
    const significantWords = normalizedEvidence
      .split(" ")
      .filter((w) => w.length >= 4);

    if (significantWords.length >= 2) {
      const matchedWords = significantWords.filter((w) => normalizedInput.includes(w));
      const overlapRatio = matchedWords.length / significantWords.length;

      if (overlapRatio < 0.4) {
        findings.push({
          type: "unfaithful_evidence",
          severity: "high",
          field: `knownRequirements[${req.unit}].evidence`,
          description: `Evidence quote "${req.evidence}" has low overlap with customer text (${Math.round(overlapRatio * 100)}% match). Appears fabricated.`,
          evidenceSnippet: req.evidence,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Commercial / Pricing Leakage Detection
  // (Architecture invariant: The model has no pricing authority and must never invent prices)
  // -------------------------------------------------------------------------
  const textFieldsToCheck: Array<{ field: string; content?: string | null }> = [
    { field: "conversationalResponse", content: output.conversationalResponse },
    { field: "customerSummary", content: output.customerSummary },
    { field: "reasoningSummary", content: output.reasoningSummary },
    ...output.followUpQuestions.map((q, idx) => ({ field: `followUpQuestions[${idx}]`, content: q })),
    ...output.assumptions.map((a, idx) => ({ field: `assumptions[${idx}]`, content: a })),
  ];

  for (const { field, content } of textFieldsToCheck) {
    if (!content) continue;

    const priceMatch = content.match(COMMERCIAL_PRICE_PATTERN);
    if (priceMatch) {
      findings.push({
        type: "commercial_pricing_leak",
        severity: "critical",
        field,
        description: `Commercial pricing / discount claim detected in model output: "${priceMatch[0]}". The AI model is strictly prohibited from quoting prices.`,
        evidenceSnippet: content,
      });
    }

    // Check case-specific forbidden text
    if (benchmarkCase.groundTruth.forbiddenInText) {
      for (const forbidden of benchmarkCase.groundTruth.forbiddenInText) {
        if (content.toLowerCase().includes(forbidden.toLowerCase())) {
          findings.push({
            type: "commercial_pricing_leak",
            severity: "high",
            field,
            description: `Model output contains forbidden text pattern: "${forbidden}".`,
            evidenceSnippet: content,
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. Unsupported Category & Feature Hallucination
  // -------------------------------------------------------------------------
  const supportedCategories = deriveSupportedCategories(catalogue);
  for (const cat of output.recommendedProductCategories) {
    if (!supportedCategories.includes(cat)) {
      findings.push({
        type: "unsupported_category",
        severity: "high",
        field: `recommendedProductCategories`,
        description: `Model recommended category "${cat}" which is not deliverable by active catalogue ${catalogue.version}.`,
      });
    }
  }

  // Check for false claims in conversational response regarding unsupported domains
  if (output.conversationalResponse) {
    for (const rule of UNSUPPORTED_DOMAINS) {
      if (rule.match.test(output.conversationalResponse)) {
        findings.push({
          type: "unsupported_category",
          severity: "high",
          field: "conversationalResponse",
          description: `Model made claims regarding unsupported domain (${rule.domain}) in conversational response.`,
          evidenceSnippet: output.conversationalResponse,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. Schema Self-Contradiction Detection
  // (A unit cannot be simultaneously known and missing)
  // -------------------------------------------------------------------------
  const knownUnits = new Set(output.knownRequirements.map((r) => r.unit));
  for (const missing of output.missingRequirements) {
    if (knownUnits.has(missing.unit)) {
      findings.push({
        type: "schema_contradiction",
        severity: "medium",
        field: `missingRequirements[${missing.unit}]`,
        description: `Contradiction: Unit '${UNIT_LABELS[missing.unit]}' is listed as both known and missing.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 6. Phantom Plan Hallucination
  // -------------------------------------------------------------------------
  const validPlanIds = new Set(catalogue.plans.map((p) => p.id));
  for (const planId of output.referencedPlanIds) {
    if (!validPlanIds.has(planId)) {
      findings.push({
        type: "phantom_plan",
        severity: "low",
        field: `referencedPlanIds`,
        description: `Referenced plan id "${planId}" does not exist in active catalogue.`,
        evidenceSnippet: planId,
      });
    }
  }

  return findings;
}

/**
 * Checks simple word-based numbers like 'ten', 'twenty', 'hundred'
 */
function numberToWordsMatch(num: number, text: string): boolean {
  const numberWordMap: Record<number, string[]> = {
    1: ["one", "single"],
    2: ["two", "couple", "pair"],
    3: ["three"],
    4: ["four"],
    5: ["five"],
    6: ["six"],
    7: ["seven"],
    8: ["eight"],
    9: ["nine"],
    10: ["ten"],
    12: ["twelve", "dozen"],
    15: ["fifteen"],
    20: ["twenty"],
    24: ["twenty four"],
    25: ["twenty five"],
    50: ["fifty"],
    100: ["hundred"],
  };

  const words = numberWordMap[num];
  if (!words) return false;
  return words.some((word) => text.includes(word));
}
