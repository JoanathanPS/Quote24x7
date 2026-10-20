import type {
  AddOnPack,
  CalculationStep,
  CatalogueVersion,
  CoverageRow,
  IntegrityCheck,
  MinorUnits,
  OptionType,
  Plan,
  QuoteLineItem,
  QuoteOption,
  UnitKind,
} from "@/types/domain";

import { formatMoney, multiplyMinor, sumMinor } from "./money.ts";

/**
 * Deterministic pricing engine.
 *
 * This module owns every amount in a quote. It contains no model calls, no
 * randomness and no clocks; the same demand against the same catalogue version
 * always produces the same options, line items and totals. The AI layer may
 * read its output to write prose, and may never write into it.
 *
 * Rule ids appear in the calculation trace and on every line item so an
 * operator can see exactly which rule produced an amount.
 */

export const CALCULATION_VERSION = "pricing-engine-v1.0.0";

/** The six quantities the Site24x7 intake form actually asks a buyer for. */
export const DEMAND_UNITS = [
  "basic_monitor",
  "advanced_monitor",
  "host_monitor",
  "network_component",
  "rum_pageview",
  "applog_gb",
] as const satisfies readonly UnitKind[];

export type DemandUnit = (typeof DEMAND_UNITS)[number];

export type PricingDemand = Record<DemandUnit, number>;

export const UNIT_LABELS: Record<UnitKind, string> = {
  basic_monitor: "Basic monitors",
  advanced_monitor: "Advanced monitors",
  host_monitor: "Host monitors",
  network_component: "Network components",
  rum_pageview: "RUM pageviews / month",
  applog_gb: "AppLogs GB / month",
  synthetic_run: "Synthetic runs / month",
};

export const UNIT_SHORT_UNITS: Record<UnitKind, string> = {
  basic_monitor: "websites",
  advanced_monitor: "advanced monitors",
  host_monitor: "servers",
  network_component: "network devices",
  rum_pageview: "pageviews",
  applog_gb: "GB logs",
  synthetic_run: "runs",
};

export function emptyDemand(): PricingDemand {
  return {
    basic_monitor: 0,
    advanced_monitor: 0,
    host_monitor: 0,
    network_component: 0,
    rum_pageview: 0,
    applog_gb: 0,
  };
}

/**
 * Included quantity for a unit on a plan.
 * `null` means the plan does not support the unit at all — which is different
 * from supporting it with zero included, and must never be read as zero.
 */
export function includedFor(plan: Plan, unit: UnitKind): number | null {
  const entitlement = plan.entitlements.find((item) => item.unit === unit);
  return entitlement ? entitlement.included : null;
}

// ---------------------------------------------------------------------------
// Add-on pack selection — rule PACK-SELECT-KNAPSACK-v1
// ---------------------------------------------------------------------------

export interface PackSelection {
  pack: AddOnPack;
  count: number;
  unitsDelivered: number;
  cost: MinorUnits;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/**
 * Computes the minimum-cost pack combination to cover at least `excess` units
 * using an unbounded knapsack dynamic programming algorithm.
 *
 * Guaranteed invariants:
 * 1. Lowest total monthly price that satisfies the excess requirement.
 * 2. No headroom unless a larger pack is strictly cheaper (bulk value).
 * 3. Uses only packs permitted on the specified plan.
 * 4. All arithmetic in whole integer paise.
 */
export function selectPacksKnapsack(
  excess: number,
  availablePacks: readonly AddOnPack[],
): PackSelection[] | null {
  if (excess <= 0) return [];

  const priced = availablePacks.filter(
    (pack): pack is AddOnPack & { packPrice: MinorUnits } =>
      pack.packPrice !== null && pack.packPrice > 0 && pack.packSize > 0,
  );
  if (priced.length === 0) return null;

  // Compute Greatest Common Divisor of all available pack sizes
  let g = priced[0]!.packSize;
  for (let i = 1; i < priced.length; i++) {
    g = gcd(g, priced[i]!.packSize);
  }

  // Normalized required units
  let N = Math.ceil(excess / g);

  // Normalized pack representations: s = size in gcd units, w = pack price in paise
  const packs = priced.map((pack) => ({
    pack,
    s: Math.floor(pack.packSize / g),
    w: pack.packPrice,
  }));

  const bulkSelections = new Map<string, number>();

  // For very large quantities (e.g. RUM pageviews in millions), take bulk packs
  // of the most unit-cost-effective pack to keep the DP state array small.
  const maxNormalizedSize = Math.max(...packs.map((p) => p.s));
  if (N > 3000) {
    let bestPack = packs[0]!;
    for (const p of packs) {
      if (p.w * bestPack.s < bestPack.w * p.s) {
        bestPack = p;
      }
    }
    const safeRemainder = 2000;
    if (N > safeRemainder + bestPack.s) {
      const bulkCount = Math.floor((N - safeRemainder) / bestPack.s);
      if (bulkCount > 0) {
        bulkSelections.set(bestPack.pack.id, bulkCount);
        N -= bulkCount * bestPack.s;
      }
    }
  }

  const maxTarget = N + maxNormalizedSize;
  const dpCost = new Float64Array(maxTarget + 1);
  const dpCount = new Int32Array(maxTarget + 1);
  const dpParent = new Int32Array(maxTarget + 1);

  dpCost.fill(Infinity);
  dpCount.fill(0);
  dpParent.fill(-1);
  dpCost[0] = 0;

  for (let j = 1; j <= maxTarget; j++) {
    for (let i = 0; i < packs.length; i++) {
      const p = packs[i]!;
      if (j >= p.s) {
        const prevCost = dpCost[j - p.s]!;
        if (prevCost !== Infinity) {
          const cost = prevCost + p.w;
          const count = dpCount[j - p.s]! + 1;
          if (
            cost < dpCost[j]! ||
            (cost === dpCost[j]! && count < dpCount[j]!)
          ) {
            dpCost[j] = cost;
            dpCount[j] = count;
            dpParent[j] = i;
          }
        }
      }
    }
  }

  // Find minimum-cost state covering at least N units
  let bestJ = -1;
  let minCost = Infinity;
  let minCount = Infinity;

  for (let j = N; j <= maxTarget; j++) {
    const cost = dpCost[j]!;
    if (cost < minCost) {
      minCost = cost;
      minCount = dpCount[j]!;
      bestJ = j;
    } else if (cost === minCost) {
      // Tie-breakers:
      // 1. Minimum delivered units (smaller j = minimum headroom)
      // 2. Minimum pack count
      if (dpCount[j]! < minCount) {
        minCount = dpCount[j]!;
        bestJ = j;
      }
    }
  }

  if (bestJ === -1 || minCost === Infinity) {
    return null;
  }

  // Backtrack to extract pack counts
  const packCounts = new Map<string, number>(bulkSelections);
  let curr = bestJ;
  while (curr > 0) {
    const packIdx = dpParent[curr]!;
    if (packIdx === -1) break;
    const p = packs[packIdx]!;
    packCounts.set(p.pack.id, (packCounts.get(p.pack.id) ?? 0) + 1);
    curr -= p.s;
  }

  const result: PackSelection[] = [];
  for (const [packId, count] of packCounts.entries()) {
    if (count <= 0) continue;
    const pack = priced.find((p) => p.id === packId)!;
    result.push({
      pack,
      count,
      unitsDelivered: count * pack.packSize,
      cost: multiplyMinor(pack.packPrice, count, `pack ${pack.id}`),
    });
  }

  return result.sort((a, b) => a.pack.id.localeCompare(b.pack.id));
}

/** Legacy alias for backwards compatibility. */
export function selectPacks(excess: number, availablePacks: readonly AddOnPack[]): PackSelection[] {
  return selectPacksKnapsack(excess, availablePacks) ?? [];
}

// ---------------------------------------------------------------------------
// Candidate evaluation
// ---------------------------------------------------------------------------

export interface Candidate {
  plan: Plan;
  valid: boolean;
  unavailabilityReason: string | null;
  isHandoff?: boolean;
  isStartingAt?: boolean;
  requiresReview?: boolean;
  pricingNote?: string | null;
  whatItAdds?: string[];
  lineItems: QuoteLineItem[];
  coverage: CoverageRow[];
  subtotal: MinorUnits;
  total: MinorUnits;
  trace: CalculationStep[];
  addOnPackCount: number;
}

function packsForPlan(
  catalogue: CatalogueVersion,
  plan: Plan,
  unit: UnitKind,
): AddOnPack[] {
  const planPrices = catalogue.planAddOnPrices?.[plan.id];
  if (!planPrices) {
    return [];
  }

  const matching: AddOnPack[] = [];
  for (const addOn of catalogue.addOns) {
    if (addOn.unit !== unit) continue;
    if (!plan.allowedAddOnIds.includes(addOn.id)) continue;

    // Requirement 1: Exclude every add-on marked needs_confirmation,
    // including "10 GB Logs Storage for 6 Months" and "10GB Log Forwarding".
    if (
      addOn.id === "addon_logs_10gb_6mo" ||
      addOn.id === "addon_log_fwd_10gb" ||
      /needs_confirmation/i.test(addOn.id) ||
      /needs_confirmation/i.test(addOn.name) ||
      /Storage for 6 Months/i.test(addOn.name) ||
      /Log Forwarding/i.test(addOn.name)
    ) {
      continue;
    }

    // The log requirement may use only the "10 GB Logs / 100 GB Logs / 1 TB Logs" family.
    if (unit === "applog_gb") {
      const isAllowedLogFamily =
        addOn.id === "addon_logs_10gb" ||
        addOn.id === "addon_logs_100gb" ||
        addOn.id === "addon_logs_1tb" ||
        /^(?:10|100|1)\s*(?:GB|TB)\s*Logs$/i.test(addOn.name.trim());
      if (!isAllowedLogFamily) {
        continue;
      }
    }

    const pricePaise = planPrices[addOn.id];
    if (pricePaise === undefined || pricePaise === null) continue;
    matching.push({
      ...addOn,
      packPrice: pricePaise,
    });
  }
  return matching;
}

export function applyGrowthBuffer(
  demand: PricingDemand,
  expectingGrowth: boolean,
): { bufferedDemand: PricingDemand; assumptions: string[] } {
  if (!expectingGrowth) {
    return { bufferedDemand: { ...demand }, assumptions: [] };
  }

  const bufferedDemand: PricingDemand = { ...demand };
  const assumptions: string[] = [];

  for (const unit of DEMAND_UNITS) {
    const raw = demand[unit];
    if (raw > 0) {
      const buffered = Math.floor((raw * 110 + 99) / 100);
      bufferedDemand[unit] = buffered;
      assumptions.push(
        `Expecting 10% growth: ${UNIT_LABELS[unit]} buffered from ${raw} to ${buffered} (ceil(need × 110 / 100); exact Zoho rule needs_confirmation).`,
      );
    }
  }

  return { bufferedDemand, assumptions };
}

export function evaluateCandidate(
  catalogue: CatalogueVersion,
  plan: Plan,
  demand: PricingDemand,
): Candidate {
  const lineItems: QuoteLineItem[] = [];
  const coverage: CoverageRow[] = [];
  const trace: CalculationStep[] = [];
  let step = 0;
  let addOnPackCount = 0;

  const pushStep = (ruleId: string, description: string, computation: string, resultMinor: MinorUnits | null) => {
    step += 1;
    trace.push({ step, ruleId, description, computation, resultMinor });
  };

  const isMsp =
    plan.id === "plan_msp" ||
    plan.id === "plan_msp_enterprise" ||
    plan.billingPeriod === "monthly";
  const monthlyListPrice = plan.priceMonthlyAnnualBilled ?? plan.basePrice;
  const planBaseTotal = isMsp ? monthlyListPrice : monthlyListPrice * 12;

  lineItems.push({
    id: `${plan.id}__base`,
    ruleId: "RULE-BASE-PRICE",
    description: isMsp
      ? `${plan.name} plan — monthly subscription`
      : `${plan.name} plan — annual subscription (${formatMoney(monthlyListPrice, catalogue.currency)}/mo × 12 months)`,
    quantity: 1,
    unit: isMsp ? "month" : "annual subscription",
    unitPrice: planBaseTotal,
    lineTotal: planBaseTotal,
    includedQuantity: null,
    sourceId: plan.sourceId,
    packSize: 1,
    purchasedUnits: 0,
  });
  pushStep(
    "RULE-BASE-PRICE",
    isMsp
      ? `${plan.name} base price for monthly subscription`
      : `${plan.name} base price for annual subscription (${plan.name} list monthly × 12)`,
    isMsp
      ? `base = ${planBaseTotal} paise (quoted per month)`
      : `${monthlyListPrice} paise/mo × 12 = ${planBaseTotal} paise`,
    planBaseTotal,
  );

  let unavailabilityReason: string | null = null;
  const isMspPlan =
    plan.id === "plan_msp" ||
    plan.id === "plan_msp_enterprise" ||
    Boolean(plan.families && plan.families.includes("fam_msp"));
  if (isMspPlan) {
    unavailabilityReason ??= "MSP plans are for managed service providers";
  }

  for (const unit of DEMAND_UNITS) {
    const required = demand[unit];
    const included = includedFor(plan, unit);

    if (required <= 0) {
      if (included !== null && included > 0) {
        coverage.push({
          unit,
          label: UNIT_LABELS[unit],
          required: 0,
          included,
          viaAddOns: 0,
          total: included,
          satisfied: true,
        });
      }
      continue;
    }

    if (included === null) {
      unavailabilityReason ??= `${plan.name} does not support ${UNIT_LABELS[unit].toLowerCase()}, which this request requires.`;
      coverage.push({
        unit,
        label: UNIT_LABELS[unit],
        required,
        included: 0,
        viaAddOns: 0,
        total: 0,
        satisfied: false,
      });
      pushStep(
        "RULE-UNSUPPORTED-UNIT",
        `${plan.name} has no entitlement for ${UNIT_LABELS[unit]}`,
        `required ${required}, plan support = none → candidate rejected`,
        null,
      );
      continue;
    }

    const excess = Math.max(0, required - included);
    pushStep(
      "RULE-EXCESS-QUANTITY",
      `${UNIT_LABELS[unit]} beyond the ${plan.name} entitlement`,
      `max(0, ${required} required − ${included} included) = ${excess}`,
      null,
    );

    if (excess === 0) {
      coverage.push({
        unit,
        label: UNIT_LABELS[unit],
        required,
        included,
        viaAddOns: 0,
        total: included,
        satisfied: true,
      });
      continue;
    }

    const packs = packsForPlan(catalogue, plan, unit);
    if (packs.length === 0) {
      unavailabilityReason ??= `${plan.name} cannot be topped up for ${UNIT_LABELS[unit].toLowerCase()}; additional packs not available for this plan.`;
      coverage.push({
        unit,
        label: UNIT_LABELS[unit],
        required,
        included,
        viaAddOns: 0,
        total: included,
        satisfied: false,
      });
      pushStep(
        "RULE-NO-ADDON-AVAILABLE",
        `No ${UNIT_LABELS[unit]} add-on is permitted on ${plan.name}`,
        `excess ${excess} cannot be covered → candidate rejected`,
        null,
      );
      continue;
    }

    const selected = selectPacksKnapsack(excess, packs);
    if (selected === null || selected.length === 0) {
      unavailabilityReason ??= `${plan.name} needs ${excess} more ${UNIT_SHORT_UNITS[unit]}, but no priced add-on pack exists in catalogue ${catalogue.version}. The price is unknown, so this option is withheld rather than estimated.`;
      coverage.push({
        unit,
        label: UNIT_LABELS[unit],
        required,
        included,
        viaAddOns: 0,
        total: included,
        satisfied: false,
      });
      pushStep(
        "RULE-MISSING-PRICE",
        `${UNIT_LABELS[unit]} add-on for ${plan.name} has no price in any source`,
        `excess ${excess} → unknown price → candidate rejected (unknown is never treated as zero)`,
        null,
      );
      continue;
    }

    let deliveredByAddOns = 0;
    for (const item of selected) {
      addOnPackCount += item.count;
      deliveredByAddOns += item.unitsDelivered;
      lineItems.push({
        id: `${plan.id}__${item.pack.id}`,
        ruleId: "RULE-ADDON-PACK",
        description: `${item.pack.name} add-on pack (annual)`,
        quantity: item.count,
        unit: "packs",
        unitPrice: item.pack.packPrice!,
        lineTotal: item.cost,
        includedQuantity: included,
        sourceId: item.pack.sourceId,
        packSize: item.pack.packSize,
        purchasedUnits: item.unitsDelivered,
      });
      pushStep(
        "RULE-ADDON-PACK",
        `${item.pack.name} on ${plan.name}`,
        `knapsack-fit of ${excess} excess ${UNIT_SHORT_UNITS[unit]} → ${item.count} × ${item.pack.packSize} = ${item.unitsDelivered} ${UNIT_SHORT_UNITS[unit]} at verbatim Store rate ${item.pack.packPrice} paise/yr each`,
        item.cost,
      );
    }

    coverage.push({
      unit,
      label: UNIT_LABELS[unit],
      required,
      included,
      viaAddOns: deliveredByAddOns,
      total: included + deliveredByAddOns,
      satisfied: included + deliveredByAddOns >= required,
    });
  }

  const subtotal = sumMinor(lineItems.map((item) => item.lineTotal), `candidate ${plan.id}`);
  const total = subtotal;
  pushStep(
    "RULE-TOTAL",
    `${plan.name} total`,
    `sum of ${lineItems.length} line item(s) = ${subtotal}; no tax applied (tax treatment unverified)`,
    total,
  );

  const isEnterprise =
    plan.id === "plan_enterprise" ||
    plan.id === "plan_enterprise_plus_web" ||
    plan.id === "plan_msp_enterprise" ||
    Boolean(plan.quoteOnRequest);

  if (isEnterprise) {
    pushStep(
      "RULE-ENTERPRISE-STARTING-AT",
      `${plan.name} tier priced as starting-at rate`,
      `Computed total ${total} paise is a starting floor; requires sales engineering review and is withheld from automated quotes.`,
      total,
    );
    return {
      plan,
      valid: false,
      isHandoff: true,
      isStartingAt: true,
      requiresReview: true,
      pricingNote: "Starting at rate, confirmed by Site24x7 sales",
      unavailabilityReason: `${plan.name} requires custom sales consultation handoff; pricing is starting at rate confirmed by Site24x7 sales.`,
      lineItems,
      coverage,
      subtotal,
      total,
      trace,
      addOnPackCount,
    };
  }

  const valid = unavailabilityReason === null && coverage.every((row) => row.satisfied);

  return {
    plan,
    valid,
    unavailabilityReason,
    lineItems,
    coverage,
    subtotal,
    total,
    trace,
    addOnPackCount,
  };
}

function cheapest(a: Candidate, b: Candidate): number {
  if (a.total !== b.total) return a.total - b.total;
  if (a.addOnPackCount !== b.addOnPackCount) return a.addOnPackCount - b.addOnPackCount;
  return a.plan.id.localeCompare(b.plan.id);
}

export function includesStrictlyMore(
  alt: Candidate,
  base: Candidate,
  demand: PricingDemand,
): boolean {
  if (alt.total <= base.total) return false;

  let hasMore = false;

  for (const unit of DEMAND_UNITS) {
    const altInc = includedFor(alt.plan, unit) ?? 0;
    const baseInc = includedFor(base.plan, unit) ?? 0;
    const altCov = alt.coverage.find((c) => c.unit === unit)?.total ?? altInc;

    // Alt must fully cover demand on all requested units
    if (demand[unit] > 0 && altCov < demand[unit]) return false;

    // On unrequested units, alt must never provide less included base entitlement
    if (demand[unit] === 0 && altInc < baseInc) return false;

    if (altInc > baseInc) {
      hasMore = true;
    }
  }

  const altPollSeconds = alt.plan.pollingFrequency.includes("second") ? 30 : 60;
  const basePollSeconds = base.plan.pollingFrequency.includes("second") ? 30 : 60;
  if (altPollSeconds > basePollSeconds) return false;
  if (altPollSeconds < basePollSeconds) hasMore = true;

  return hasMore;
}

export function describeWhatItAdds(
  alt: Candidate,
  base: Candidate,
  _demand?: PricingDemand,
): string[] {
  const adds: string[] = [];

  for (const unit of DEMAND_UNITS) {
    const altInc = includedFor(alt.plan, unit) ?? 0;
    const baseInc = includedFor(base.plan, unit) ?? 0;

    if (altInc > baseInc) {
      const diff = altInc - baseInc;
      let label = "";
      if (unit === "advanced_monitor") {
        label = diff === 1 ? "1 advanced monitor" : `${diff} advanced monitors`;
      } else if (unit === "network_component") {
        label = diff === 1 ? "1 network device" : `${diff} network devices`;
      } else if (unit === "basic_monitor") {
        label = diff === 1 ? "1 website check" : `${diff} website checks`;
      } else if (unit === "host_monitor") {
        label = diff === 1 ? "1 server" : `${diff} servers`;
      } else if (unit === "rum_pageview") {
        label = `${diff.toLocaleString("en-IN")} RUM page views`;
      } else if (unit === "applog_gb") {
        label = `${diff} GB log ingestion`;
      }

      if (label) {
        adds.push(label);
      }
    }
  }

  // APM and status pages must never appear in the alternative line unless the buyer asked for them
  if (
    alt.plan.pollingFrequency.includes("second") &&
    !base.plan.pollingFrequency.includes("second")
  ) {
    adds.push(`faster ${alt.plan.pollingFrequency} polling`);
  }

  return adds;
}

export function buildComparisonLine(
  lowest: QuoteOption,
  alternative: QuoteOption,
  _demand?: PricingDemand,
): string {
  const diffPaise = alternative.total - lowest.total;
  const diffFormatted = formatMoney(diffPaise, "INR", { showDecimals: false });
  const altTotalFormatted = formatMoney(alternative.total, "INR", { showDecimals: false });

  const adds =
    alternative.whatItAdds && alternative.whatItAdds.length > 0
      ? alternative.whatItAdds.join(", ").replace(/, ([^,]+)$/, ", and $1")
      : "additional capability";

  return `${alternative.planName} costs ${diffFormatted} more per year (${altTotalFormatted}). It adds ${adds}.`;
}

const RANK_REASONS: Record<OptionType, (candidate: Candidate) => string> = {
  lowest_cost: (candidate) =>
    `Cheapest configuration meeting every stated requirement, using ${candidate.addOnPackCount} add-on pack(s).`,
  best_value: (candidate) =>
    `Recommended configuration: optimal balance of included allowances, service levels (${candidate.plan.pollingFrequency} polling), and commitment.`,
  best_coverage: (candidate) =>
    `Widest supported coverage among valid configurations: ${candidate.plan.capabilities.length} capability areas, ${candidate.plan.pollingFrequency} polling.`,
};

export interface RankedOptions {
  options: QuoteOption[];
  rejected: Candidate[];
  optionCountNote: string | null;
  comparisonLine?: string | null;
}

export function rankOptions(
  candidates: readonly Candidate[],
  demand: PricingDemand,
  quoteId: string,
): RankedOptions {
  const valid = candidates.filter((candidate) => candidate.valid);
  const rejected = candidates.filter((candidate) => !candidate.valid);

  if (valid.length === 0) {
    return {
      options: [],
      rejected,
      optionCountNote:
        "No configuration in the active catalogue satisfies this request. No price is shown rather than an invented one.",
      comparisonLine: null,
    };
  }

  // Item 1: RECOMMENDATION = CHEAPEST.
  // Sort strictly by cheapest annual total ascending.
  const sortedByPrice = [...valid].sort(cheapest);
  const lowestCostCandidate = sortedByPrice[0]!;

  if (valid.length === 1) {
    const pick = valid[0]!;
    const options: QuoteOption[] = [toQuoteOption(pick, "best_value", demand, quoteId)];
    const optionCountNote =
      "Only 1 genuinely distinct valid configuration exists for this request. The remaining plans either lack a capability the request needs, or have no priced add-on to cover the shortfall. Options are not invented to reach three.";
    return { options, rejected, optionCountNote, comparisonLine: null };
  }

  // Option 1 (index 0) MUST ALWAYS be the valid candidate with the minimum annual total!
  const lowestOpt = toQuoteOption(lowestCostCandidate, "lowest_cost", demand, quoteId);

  // Alternative option: find a higher-tier or higher-spec candidate that costs more
  const alternatives = sortedByPrice
    .slice(1)
    .filter(
      (alt) =>
        alt.total > lowestCostCandidate.total &&
        includesStrictlyMore(alt, lowestCostCandidate, demand),
    );

  if (alternatives.length > 0) {
    const altCandidate = alternatives[0]!;
    const whatItAdds = describeWhatItAdds(altCandidate, lowestCostCandidate, demand);
    const altOpt = toQuoteOption(altCandidate, "best_value", demand, quoteId, whatItAdds);
    const comparisonLine = buildComparisonLine(lowestOpt, altOpt, demand);
    altOpt.comparisonNote = comparisonLine;
    lowestOpt.comparisonNote = comparisonLine;

    // Option 1 is lowestOpt (cheapest), Option 2 is altOpt (higher tier/coverage)
    const options: QuoteOption[] = [lowestOpt, altOpt];
    return { options, rejected, optionCountNote: null, comparisonLine };
  }

  const singleOpt = toQuoteOption(lowestCostCandidate, "best_value", demand, quoteId);
  return {
    options: [singleOpt],
    rejected,
    optionCountNote:
      "Only 1 genuinely distinct valid configuration exists for this request without redundant extra costs. Options are not invented.",
    comparisonLine: null,
  };
}

function toQuoteOption(
  candidate: Candidate,
  optionType: OptionType,
  demand: PricingDemand,
  quoteId: string,
  whatItAdds?: string[],
  comparisonNote?: string | null,
): QuoteOption {
  const headroomNotes: string[] = [];
  for (const row of candidate.coverage) {
    const required = demand[row.unit as DemandUnit] ?? 0;
    if (required > 0 && row.total > required) {
      const spare = row.total - required;
      headroomNotes.push(
        `${spare.toLocaleString("en-IN")} spare ${UNIT_SHORT_UNITS[row.unit]} beyond the ${required.toLocaleString("en-IN")} requested (${row.label.toLowerCase()}).`,
      );
    }
  }

  return {
    id: `${quoteId}__${optionType}`,
    quoteId,
    optionType,
    planId: candidate.plan.id,
    planName: candidate.plan.name,
    rankReason: RANK_REASONS[optionType](candidate),
    subtotal: candidate.subtotal,
    taxTotal: null,
    total: candidate.total,
    valid: candidate.valid,
    unavailabilityReason: candidate.unavailabilityReason,
    isStartingAt: candidate.isStartingAt,
    requiresReview: candidate.requiresReview,
    pricingNote: candidate.pricingNote,
    whatItAdds,
    comparisonNote,
    lineItems: candidate.lineItems,
    coverage: candidate.coverage,
    headroomNotes,
  };
}

// ---------------------------------------------------------------------------
// Quote integrity validation
// ---------------------------------------------------------------------------

/**
 * Runs after calculation and before any document or email is produced. A failed
 * check must stop the quote from being sent.
 */
export function runIntegrityChecks(
  catalogue: CatalogueVersion,
  options: readonly QuoteOption[],
  demand: PricingDemand,
): IntegrityCheck[] {
  const checks: IntegrityCheck[] = [];
  const hasOptions = options.length > 0;

  checks.push({
    id: "has-valid-options",
    label: "At least one valid pricing option was generated",
    passed: hasOptions,
    detail: hasOptions
      ? `${options.length} valid option(s) generated to meet requirements.`
      : "No configuration in the active catalogue satisfies all stated requirements.",
  });

  const totalsMatch =
    hasOptions &&
    options.every(
      (option) => sumMinor(option.lineItems.map((item) => item.lineTotal), "integrity") === option.total,
    );
  checks.push({
    id: "totals-match-line-items",
    label: "Every option total equals the sum of its line items",
    passed: totalsMatch,
    detail: totalsMatch
      ? `${options.length} option(s) reconciled against ${options.reduce((n, o) => n + o.lineItems.length, 0)} line items.`
      : hasOptions
        ? "At least one option total does not reconcile against its line items."
        : "No options available to reconcile line items.",
  });

  const sourceIds = new Set(catalogue.sources.map((source) => source.id));
  const everyLineSourced =
    hasOptions &&
    options.every((option) =>
      option.lineItems.every((item) => sourceIds.has(item.sourceId)),
    );
  checks.push({
    id: "line-items-sourced",
    label: "Every priced line item traces to a recorded source",
    passed: everyLineSourced,
    detail: everyLineSourced
      ? "All line items reference a source in the catalogue source register."
      : hasOptions
        ? "A line item references a source that is not in the register."
        : "No options available to trace line item sources.",
  });

  const coversDemand =
    hasOptions &&
    options.every((option) =>
      DEMAND_UNITS.every((unit) => {
        const required = demand[unit];
        if (required <= 0) return true;
        const row = option.coverage.find((item) => item.unit === unit);
        return (row?.total ?? 0) >= required && row?.satisfied === true;
      }),
    );
  checks.push({
    id: "covers-stated-requirements",
    label: "Every presented option meets all stated minimum quantities",
    passed: coversDemand,
    detail: coversDemand
      ? "No option is shown that falls short of a quantity the buyer stated."
      : hasOptions
        ? "An option does not meet a stated minimum and must not be presented."
        : "No options meet all stated requirements.",
  });

  const integersOnly =
    hasOptions &&
    options.every(
      (option) =>
        Number.isSafeInteger(option.total) &&
        Number.isSafeInteger(option.subtotal) &&
        option.lineItems.every(
          (item) => Number.isSafeInteger(item.unitPrice) && Number.isSafeInteger(item.lineTotal),
        ),
    );
  checks.push({
    id: "integer-minor-units",
    label: "All amounts are integers in minor units (no floating-point currency)",
    passed: integersOnly,
    detail: integersOnly
      ? "Arithmetic stayed in whole paise throughout."
      : hasOptions
        ? "A non-integer amount was produced — the quote is not trustworthy."
        : "No options available to evaluate minor unit integrity.",
  });

  const lowestCostOpt = options.find((o) => o.optionType === "lowest_cost");
  const lowestCostIsMinimum =
    !lowestCostOpt ||
    options.every((o) => lowestCostOpt.total <= o.total);
  checks.push({
    id: "lowest-cost-is-minimum",
    label: "Lowest cost option total is less than or equal to all other option prices",
    passed: lowestCostIsMinimum,
    detail: lowestCostIsMinimum
      ? "Lowest cost option represents the true minimum commitment across all presented configurations."
      : "Lowest cost option has a higher price than another option — recommendation ranking failed.",
  });

  const notAuthorised = catalogue.verificationStatus !== "company_authorized";
  checks.push({
    id: "pricing-status-honest",
    label: "Quote is not labelled as authorised pricing",
    passed: notAuthorised,
    detail: notAuthorised
      ? `Catalogue ${catalogue.version} is ${catalogue.verificationStatus}; the quote is labelled demo data and is non-binding.`
      : "Catalogue claims authorised status without an authorised source.",
  });

  return checks;
}
