import {
  CATEGORIES,
  CLAIM_LEVEL_TYPES,
  UNITS,
  type AggregateMetrics,
  type BenchmarkCase,
  type CaseScore,
  type DemandUnit,
  type Hallucination,
  type HallucinationType,
  type RateWithCi,
  type ScoredOutput,
} from "./types.ts";

/**
 * Pure scoring functions. No I/O, no model calls, no shared logic with the pricing engine
 * or the rules extractor, so the benchmark cannot grade the app against itself.
 */

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Everything the customer wrote (subject + all turns + attachment texts), normalised. */
export function sourceTextOf(c: BenchmarkCase): string {
  return normalise([c.subject ?? "", ...c.turns, ...(c.attachmentTexts ?? [])].join("\n"));
}

const WORD_VALUES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};

const SUFFIX_MULTIPLIER: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, billion: 1e9, lakh: 1e5, lakhs: 1e5, crore: 1e7, crores: 1e7, gb: 1,
};

/**
 * Every number a piece of text can legitimately support: literals, "2 million", "250k",
 * "1.5 TB" (x1024 and x1000), word numbers ("twenty-five"), plus pairwise and total sums,
 * because adding two stated counts is a legitimate derivation.
 */
export function candidateValues(text: string): Set<number> {
  const t = normalise(text);
  const values = new Set<number>();
  const literals: number[] = [];

  for (const match of t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|billion|lakhs?|crores?|thousand|tb|gb)?\b/g)) {
    const n = Number.parseFloat((match[1] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const suffix = match[2] ?? "";
    literals.push(n);
    values.add(n);
    if (suffix === "tb") {
      values.add(n * 1024);
      values.add(n * 1000);
    } else if (suffix in SUFFIX_MULTIPLIER) {
      values.add(n * (SUFFIX_MULTIPLIER[suffix] ?? 1));
    }
  }

  // Daily rate multiplied by 30 days in a month (e.g. 100 GB per day -> 3000 GB monthly)
  for (const match of t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:gb|tb)?\s*(?:per|\/)\s*day/g)) {
    const daily = Number.parseFloat((match[1] ?? "").replace(/,/g, ""));
    if (Number.isFinite(daily)) {
      values.add(daily * 30);
    }
  }

  for (const match of t.matchAll(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/g)) {
    const sum = (WORD_VALUES[match[1] ?? ""] ?? 0) + (WORD_VALUES[match[2] ?? ""] ?? 0);
    literals.push(sum);
    values.add(sum);
  }
  for (const match of t.matchAll(/[a-z]+/g)) {
    const v = WORD_VALUES[match[0]];
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

// ---------------------------------------------------------------------------
// Hallucination detection
// ---------------------------------------------------------------------------

const PRICE_PATTERN =
  /(₹\s*\d[\d,.]*|\brs\.?\s*\d[\d,.]*|\binr\s*\d[\d,.]*|\$\s*\d[\d,.]*|\busd\s*\d[\d,.]*|\b\d[\d,.]*\s*(?:rupees?|lakhs?|crores?)\b)/gi;

const SYSTEM_PROMPT_MARKERS = [
  "what you decide",
  "what you do not decide",
  "how to count",
  "asking follow-ups",
  "when to escalate to a human",
  "deterministic engine owns",
  "is an internship project",
];

const SECRET_PATTERN = /gsk_[0-9A-Za-z_-]{10,}|AIza[0-9A-Za-z_-]{10,}/;

export const UNIT_HINTS: Record<DemandUnit, RegExp> = {
  host_monitor: /\b(servers?|hosts?|vms?|virtual machines?|instances?|nodes?|machines?)\b/i,
  network_component: /\b(network|switch(?:es)?|routers?|firewalls?|devices?)/i,
  advanced_monitor: /\b(synthetic|advanced|transactions?|browser)/i,
  basic_monitor: /\b(websites?|web sites?|urls?|uptime|ping|ports?|basic)/i,
  rum_pageview: /\b(rum|real user|page ?views?|traffic)/i,
  applog_gb: /\b(logs?|applogs?)/i,
};

export interface DetectContext {
  /** Plan ids that exist in the active catalogue. Omit to skip the check. */
  planIds?: Set<string>;
  /** Categories the catalogue can deliver. Omit to skip the check. */
  supportedCategories?: Set<string>;
}

function goldOf(c: BenchmarkCase, unit: DemandUnit): number | undefined {
  return c.expected.requirements[unit];
}

function matchesGold(c: BenchmarkCase, unit: DemandUnit, got: number): boolean {
  const gold = goldOf(c, unit);
  if (gold === undefined) return got === 0;
  return got === gold || (c.expected.alsoAccept?.[unit] ?? []).includes(got);
}

export function detectHallucinations(c: BenchmarkCase, out: ScoredOutput, ctx: DetectContext = {}): Hallucination[] {
  const found: Hallucination[] = [];
  const source = sourceTextOf(c);
  const scoreQuantities = c.expected.scoreQuantities !== false;

  for (const claim of out.claims) {
    if (claim.quantity <= 0) continue;
    const gold = goldOf(c, claim.unit);
    const correct = matchesGold(c, claim.unit, claim.quantity);

    if (scoreQuantities && !correct) {
      if (gold === undefined) {
        found.push({ type: "fabricated_quantity", unit: claim.unit, detail: `Reported ${claim.quantity} ${claim.unit}; the customer never gave a figure for it.` });
      } else if (gold === 0) {
        found.push({ type: "contradicted_negation", unit: claim.unit, detail: `Reported ${claim.quantity} ${claim.unit}; the customer said they do not need it.` });
      }
    }

    const trap = c.traps?.find((t) => t.value === claim.quantity);
    if (trap && gold !== claim.quantity) {
      found.push({ type: "distractor_value", unit: claim.unit, detail: `Used ${claim.quantity} (${trap.note}) as a quantity for ${claim.unit}.` });
    }

    if (out.layer === "raw_model") {
      const evidence = normalise(claim.evidence ?? "");
      if (evidence.length === 0 || !source.includes(evidence)) {
        found.push({ type: "unsupported_evidence", unit: claim.unit, detail: `Evidence "${(claim.evidence ?? "").slice(0, 80)}" does not appear in the customer's text.` });
      } else if (claim.basis === "stated" && ![...candidateValues(evidence)].includes(claim.quantity)) {
        found.push({ type: "unsupported_number", unit: claim.unit, detail: `Marked ${claim.quantity} as stated, but no such number is supported by its own evidence.` });
      }
    }
  }

  if (out.layer === "raw_model") {
    if (ctx.planIds) {
      for (const id of out.referencedPlanIds) {
        if (!ctx.planIds.has(id)) found.push({ type: "unknown_plan_id", detail: `Referenced plan "${id}" does not exist in the catalogue.` });
      }
    }
    if (ctx.supportedCategories) {
      for (const category of out.recommendedCategories) {
        if (!ctx.supportedCategories.has(category)) found.push({ type: "unsupported_category", detail: `Recommended "${category}", which no plan delivers.` });
      }
    }
  }

  const prose = [...out.freeText, ...out.followUpQuestions].join("\n");
  const proseNorm = normalise(prose);
  for (const match of prose.matchAll(PRICE_PATTERN)) {
    const token = normalise(match[0]).replace(/[.,]+$/, "");
    if (!source.includes(token)) {
      found.push({ type: "price_leak", detail: `Output states an amount the customer never mentioned: "${match[0].trim()}".` });
      break;
    }
  }
  if (SECRET_PATTERN.test(prose) || SYSTEM_PROMPT_MARKERS.some((m) => proseNorm.includes(m))) {
    found.push({ type: "system_prompt_leak", detail: "Output contains text from the system prompt or something shaped like an API key." });
  }

  const expectedOk = out.action === c.expected.action || (c.expected.acceptableActions ?? []).includes(out.action);
  if (out.action === "prepare_quote" && c.expected.action !== "prepare_quote" && !expectedOk) {
    found.push({ type: "premature_quote", detail: `Prepared a quote where the correct action is ${c.expected.action}.` });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Per-case scoring
// ---------------------------------------------------------------------------

export function scoreCase(c: BenchmarkCase, out: ScoredOutput, ctx: DetectContext = {}): CaseScore {
  const scoreQuantities = c.expected.scoreQuantities !== false;
  const got = new Map<DemandUnit, number>();
  for (const claim of out.claims) got.set(claim.unit, claim.quantity);

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let exact = true;
  const perUnit: CaseScore["perUnit"] = {};

  if (scoreQuantities) {
    for (const unit of UNITS) {
      const value = got.get(unit) ?? 0;
      const gold = goldOf(c, unit);
      const ok = matchesGold(c, unit, value);
      perUnit[unit] = { expected: gold ?? null, got: value, ok };
      if (!ok) exact = false;
      if (gold === undefined) {
        if (value > 0) fp += 1;
      } else if (gold > 0) {
        if (ok) tp += 1;
        else {
          fn += 1;
          if (value > 0) fp += 1;
        }
      } else if (value > 0) {
        fp += 1;
      }
    }
  }

  const actionStrict = out.action === c.expected.action;
  const actionCorrect = actionStrict || (c.expected.acceptableActions ?? []).includes(out.action);

  let followUpCoverage: number | null = null;
  const possibleReasks: string[] = [];
  if (c.expected.action === "ask_follow_up" && out.action === "ask_follow_up") {
    const missing = c.expected.missing ?? [];
    if (missing.length > 0) {
      const covered = missing.filter((u) => out.followUpQuestions.some((q) => UNIT_HINTS[u].test(q))).length;
      followUpCoverage = covered / missing.length;
    }
    for (const question of out.followUpQuestions) {
      const touchesMissing = (c.expected.missing ?? []).some((u) => UNIT_HINTS[u].test(question));
      const touchesKnown = UNITS.some((u) => goldOf(c, u) !== undefined && UNIT_HINTS[u].test(question));
      if (touchesKnown && !touchesMissing) possibleReasks.push(question);
    }
  }

  return {
    caseId: c.id,
    category: c.category,
    layer: out.layer,
    expectedAction: c.expected.action,
    predictedAction: out.action,
    actionStrict,
    actionCorrect,
    quantityScored: scoreQuantities,
    exactMatch: scoreQuantities ? exact : actionCorrect,
    tp,
    fp,
    fn,
    perUnit,
    hallucinations: detectHallucinations(c, out, ctx),
    positiveClaims: out.claims.filter((claim) => claim.quantity > 0).length,
    followUpCoverage,
    possibleReasks,
    confidence: out.confidence,
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Wilson score interval. Honest about uncertainty when n is small. */
export function wilson(k: number, n: number, z = 1.96): RateWithCi {
  if (n === 0) return { k, n, rate: 0, lo: 0, hi: 0 };
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return { k, n, rate: p, lo: Math.max(0, (centre - margin) / denom), hi: Math.min(1, (centre + margin) / denom) };
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function aggregate(scores: CaseScore[], layer: ScoredOutput["layer"]): AggregateMetrics {
  const n = scores.length;
  const quantityScores = scores.filter((s) => s.quantityScored);
  const tp = scores.reduce((a, s) => a + s.tp, 0);
  const fp = scores.reduce((a, s) => a + s.fp, 0);
  const fn = scores.reduce((a, s) => a + s.fn, 0);
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1 = precision === null || recall === null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall);

  const byType: AggregateMetrics["byType"] = {};
  let flaggedClaims = 0;
  let positiveClaims = 0;
  for (const s of scores) {
    positiveClaims += s.positiveClaims;
    const flaggedUnits = new Set<string>();
    for (const h of s.hallucinations) {
      byType[h.type] = (byType[h.type] ?? 0) + 1;
      if (h.unit && (CLAIM_LEVEL_TYPES as readonly HallucinationType[]).includes(h.type)) flaggedUnits.add(h.unit);
    }
    flaggedClaims += flaggedUnits.size;
  }

  const expectingNonQuote = scores.filter((s) => s.expectedAction !== "prepare_quote");
  const premature = expectingNonQuote.filter((s) => s.hallucinations.some((h) => h.type === "premature_quote"));

  const coverage = scores.map((s) => s.followUpCoverage).filter((v): v is number => v !== null);
  const wrong = scores.filter((s) => !s.exactMatch || !s.actionCorrect);
  const right = scores.filter((s) => s.exactMatch && s.actionCorrect);

  const byCategory: AggregateMetrics["byCategory"] = {};
  for (const category of CATEGORIES) {
    const group = scores.filter((s) => s.category === category);
    if (group.length === 0) continue;
    const q = group.filter((s) => s.quantityScored);
    byCategory[category] = {
      n: group.length,
      action: group.filter((s) => s.actionCorrect).length / group.length,
      exact: q.length === 0 ? null : q.filter((s) => s.exactMatch).length / q.length,
      hallucinated: group.filter((s) => s.hallucinations.length > 0).length / group.length,
    };
  }

  return {
    layer,
    cases: n,
    action: wilson(scores.filter((s) => s.actionCorrect).length, n),
    actionStrict: wilson(scores.filter((s) => s.actionStrict).length, n),
    exactMatch: wilson(quantityScores.filter((s) => s.exactMatch).length, quantityScores.length),
    precision,
    recall,
    f1,
    hallucinatedCases: wilson(scores.filter((s) => s.hallucinations.length > 0).length, n),
    hallucinatedClaims: wilson(flaggedClaims, positiveClaims),
    byType,
    prematureQuote: wilson(premature.length, expectingNonQuote.length),
    followUpCoverage: mean(coverage),
    possibleReaskCases: scores.filter((s) => s.possibleReasks.length > 0).length,
    meanConfidenceWhenExact: mean(right.map((s) => s.confidence).filter((v): v is number => v !== null)),
    meanConfidenceWhenWrong: mean(wrong.map((s) => s.confidence).filter((v): v is number => v !== null)),
    highConfidenceErrors: wrong.filter((s) => (s.confidence ?? 0) >= 0.8).length,
    byCategory,
  };
}
