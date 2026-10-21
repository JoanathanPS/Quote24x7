import type { DemandUnit } from "../pricing/engine.ts";

export type { DemandUnit };

/** The six billable quantities the AI sales engineer is responsible for extracting. */
export const UNITS = [
  "host_monitor",
  "network_component",
  "basic_monitor",
  "advanced_monitor",
  "rum_pageview",
  "applog_gb",
] as const satisfies readonly DemandUnit[];

export type BenchAction = "ask_follow_up" | "prepare_quote" | "human_review";

export const CATEGORIES = [
  "clear_stated",
  "unit_conversion",
  "explicit_zero",
  "multi_turn_correction",
  "distractor_trap",
  "missing_info",
  "escalation",
  "prompt_injection",
] as const;
export type CaseCategory = (typeof CATEGORIES)[number];

/**
 * One labelled benchmark case: a customer conversation plus the ground truth a
 * correct system must reproduce.
 */
export interface BenchmarkCase {
  id: string;
  category: CaseCategory;
  /** What this case is designed to catch. */
  description: string;
  subject?: string;
  /** Customer messages in order. The last one is the message being decided on. */
  turns: string[];
  expected: {
    action: BenchAction;
    /** Other actions that are defensible under the written policy. Scored as "lenient" correct. */
    acceptableActions?: BenchAction[];
    /**
     * Ground-truth quantities. A unit set to 0 means the customer explicitly said they do not
     * need it. A unit that is absent means the customer never said anything about it.
     */
    requirements: Partial<Record<DemandUnit, number>>;
    /** Alternative quantities that are also correct (e.g. 1.5 TB = 1536 or 1500 GB). */
    alsoAccept?: Partial<Record<DemandUnit, number[]>>;
    /** For ask_follow_up cases: units a good follow-up question should cover. */
    missing?: DemandUnit[];
    /** Set false for cases where quantities are not the point (escalations). Default true. */
    scoreQuantities?: boolean;
  };
  /** Numbers present in the email that must NOT be turned into a quantity (phone numbers, years, budgets...). */
  traps?: Array<{ value: number; note: string }>;
}

export interface ClaimedRequirement {
  unit: DemandUnit;
  quantity: number;
  basis?: "stated" | "inferred";
  /** Verbatim quote the model offered in support. Only available on the raw model layer. */
  evidence?: string;
}

/** A system output reduced to what the scorer needs. */
export interface ScoredOutput {
  /** raw_model: what the LLM returned. final_system: what the app acted on after its guards. */
  layer: "raw_model" | "final_system";
  action: BenchAction;
  claims: ClaimedRequirement[];
  referencedPlanIds: string[];
  recommendedCategories: string[];
  /** Free-text fields scanned for leaked prices and prompts. */
  freeText: string[];
  followUpQuestions: string[];
  confidence: number | null;
}

export type HallucinationType =
  | "fabricated_quantity"
  | "contradicted_negation"
  | "distractor_value"
  | "unsupported_evidence"
  | "unsupported_number"
  | "unknown_plan_id"
  | "unsupported_category"
  | "price_leak"
  | "system_prompt_leak"
  | "premature_quote";

/** Types that describe a single fabricated claim (counted against the claim-level rate). */
export const CLAIM_LEVEL_TYPES: readonly HallucinationType[] = [
  "fabricated_quantity",
  "contradicted_negation",
  "distractor_value",
  "unsupported_evidence",
  "unsupported_number",
];

export interface Hallucination {
  type: HallucinationType;
  unit?: DemandUnit;
  detail: string;
}

export interface CaseScore {
  caseId: string;
  category: CaseCategory;
  layer: ScoredOutput["layer"];
  expectedAction: BenchAction;
  predictedAction: BenchAction;
  /** Matches expected.action exactly. */
  actionStrict: boolean;
  /** Matches expected.action or one of acceptableActions. */
  actionCorrect: boolean;
  quantityScored: boolean;
  exactMatch: boolean;
  tp: number;
  fp: number;
  fn: number;
  perUnit: Partial<Record<DemandUnit, { expected: number | null; got: number; ok: boolean }>>;
  hallucinations: Hallucination[];
  /** Number of claims with quantity > 0. */
  positiveClaims: number;
  /** Fraction of expected.missing units that the follow-up questions touch. Null when not applicable. */
  followUpCoverage: number | null;
  /** Heuristic: follow-up questions that appear to re-ask something the customer already answered. */
  possibleReasks: string[];
  confidence: number | null;
}

export interface RateWithCi {
  k: number;
  n: number;
  rate: number;
  lo: number;
  hi: number;
}

export interface AggregateMetrics {
  layer: ScoredOutput["layer"];
  cases: number;
  action: RateWithCi;
  actionStrict: RateWithCi;
  exactMatch: RateWithCi;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  hallucinatedCases: RateWithCi;
  hallucinatedClaims: RateWithCi;
  byType: Partial<Record<HallucinationType, number>>;
  prematureQuote: RateWithCi;
  followUpCoverage: number | null;
  possibleReaskCases: number;
  meanConfidenceWhenExact: number | null;
  meanConfidenceWhenWrong: number | null;
  /** Wrong (not exact or wrong action) while reporting confidence >= 0.8. */
  highConfidenceErrors: number;
  byCategory: Record<string, { n: number; action: number; exact: number | null; hallucinated: number }>;
}
