import type { ProductCategory } from "@/types/domain";
import type { DemandUnit } from "../../pricing/engine.ts";
import type { AiAction } from "@/types/domain";

export type BenchmarkCategory =
  | "standard_quotes"
  | "unit_conversion"
  | "missing_requirements"
  | "hallucination_traps"
  | "adversarial_and_unsupported"
  | "multi_turn_conversations";

export interface GroundTruthRequirements {
  /** Expected action to be taken */
  action: AiAction;
  /** Expected billable quantities by unit */
  quantities?: Partial<Record<DemandUnit, number>>;
  /** Units that MUST NOT be present in known requirements (prevents fabrication) */
  mustNotHaveUnits?: DemandUnit[];
  /** Units that should be identified as missing / needing follow-up */
  missingUnits?: DemandUnit[];
  /** Product categories expected to be recommended */
  categories?: ProductCategory[];
  /** Substrings or patterns forbidden anywhere in model textual output */
  forbiddenInText?: string[];
  /** Expected keywords in conversational response */
  expectedConversationalKeywords?: string[];
  /** Whether conversationalResponse must be null or absent */
  expectNullConversationalResponse?: boolean;
}

export interface BenchmarkCase {
  id: string;
  name: string;
  description: string;
  category: BenchmarkCategory;
  input: {
    subject: string;
    messageText: string;
    senderName?: string;
    senderEmail?: string;
    priorMessages?: Array<{
      direction: "inbound" | "outbound";
      bodyText: string;
    }>;
    existingRequirements?: Partial<Record<DemandUnit, number>>;
  };
  groundTruth: GroundTruthRequirements;
}

export type HallucinationType =
  | "fabricated_quantity"
  | "unfaithful_evidence"
  | "commercial_pricing_leak"
  | "unsupported_category"
  | "schema_contradiction"
  | "phantom_plan";

export type HallucinationSeverity = "low" | "medium" | "high" | "critical";

export interface HallucinationFinding {
  type: HallucinationType;
  severity: HallucinationSeverity;
  field: string;
  description: string;
  evidenceSnippet?: string;
}

export interface UnitErrorDetail {
  expected?: number;
  actual?: number;
  delta?: number;
  status: "match" | "mismatch" | "false_positive" | "false_negative";
}

export interface CaseEvaluationResult {
  caseId: string;
  caseName: string;
  category: BenchmarkCategory;
  passed: boolean;
  actionMatch: boolean;
  actionExpected: AiAction;
  actionActual: AiAction;
  quantityAccuracy: {
    exactMatches: number;
    totalExpected: number;
    falsePositives: number;
    falseNegatives: number;
    precision: number;
    recall: number;
    f1: number;
    unitDetails: Record<string, UnitErrorDetail>;
  };
  missingRequirementsAccuracy: {
    expected: DemandUnit[];
    actual: DemandUnit[];
    matched: DemandUnit[];
    recall: number;
  };
  hallucinations: HallucinationFinding[];
  hasHallucination: boolean;
  latencyMs: number;
  notes: string[];
}

export interface BenchmarkSummaryReport {
  timestamp: string;
  modelOrEngine: string;
  catalogueVersion: string;
  totalCases: number;
  passedCases: number;
  passRate: number;
  accuracy: {
    actionAccuracy: number;
    actionConfusionMatrix: Record<string, Record<string, number>>;
    overallQuantityPrecision: number;
    overallQuantityRecall: number;
    overallQuantityF1: number;
    exactMatchRate: number;
    missingRequirementRecall: number;
  };
  hallucination: {
    totalHallucinations: number;
    casesWithHallucination: number;
    hallucinationFreeRate: number;
    byType: Record<HallucinationType, number>;
    bySeverity: Record<HallucinationSeverity, number>;
  };
  categoryBreakdown: Record<
    BenchmarkCategory,
    {
      total: number;
      passed: number;
      passRate: number;
      hallucinations: number;
    }
  >;
  caseResults: CaseEvaluationResult[];
}
