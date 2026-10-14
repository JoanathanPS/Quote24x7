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

import { multiplyMinor, sumMinor } from "./money.ts";

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
  basic_monitor: "monitors",
  advanced_monitor: "monitors",
  host_monitor: "hosts",
  network_component: "components",
  rum_pageview: "pageviews",
  applog_gb: "GB",
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
// Add-on pack selection — rule PACK-SELECT-v1
// ---------------------------------------------------------------------------

interface PackSelection {
  pack: AddOnPack;
  count: number;
  unitsDelivered: number;
  cost: MinorUnits;
}

/**
 * Cheapest-first pack selection for an excess quantity.
 *
 * Packs are sorted by cost per unit (compared by cross-multiplication so no
 * floating point is involved), consumed greedily, then the remainder is covered
 * by the cheapest single pack large enough for it. A final pass replaces the
 * whole selection with one larger pack when that is cheaper — which happens
 * whenever bulk packs are better value than many small ones.
 */
export function selectPacks(excess: number, availablePacks: readonly AddOnPack[]): PackSelection[] {
  if (excess <= 0) return [];

  const priced = availablePacks.filter(
    (pack): pack is AddOnPack & { packPrice: MinorUnits } => pack.packPrice !== null,
  );
  if (priced.length === 0) return [];

  const byUnitCost = [...priced].sort((a, b) => {
    // a cheaper per unit than b  <=>  a.price / a.size < b.price / b.size
    const left = a.packPrice * b.packSize;
    const right = b.packPrice * a.packSize;
    if (left !== right) return left - right;
    if (a.packSize !== b.packSize) return b.packSize - a.packSize;
    return a.id.localeCompare(b.id);
  });

  const selection = new Map<string, PackSelection>();
  let remaining = excess;

  for (const pack of byUnitCost) {
    const count = Math.floor(remaining / pack.packSize);
    if (count > 0) {
      selection.set(pack.id, {
        pack,
        count,
        unitsDelivered: count * pack.packSize,
        cost: multiplyMinor(pack.packPrice, count, `pack ${pack.id}`),
      });
      remaining -= count * pack.packSize;
    }
  }

  if (remaining > 0) {
    const coveringTopUp = priced
      .filter((pack) => pack.packSize >= remaining)
      .sort((a, b) => a.packPrice - b.packPrice || a.packSize - b.packSize || a.id.localeCompare(b.id))[0];

    const topUp = coveringTopUp ?? byUnitCost[0]!;
    const existing = selection.get(topUp.id);
    if (existing) {
      existing.count += 1;
      existing.unitsDelivered += topUp.packSize;
      existing.cost = multiplyMinor(topUp.packPrice, existing.count, `pack ${topUp.id}`);
    } else {
      selection.set(topUp.id, {
        pack: topUp,
        count: 1,
        unitsDelivered: topUp.packSize,
        cost: topUp.packPrice,
      });
    }
  }

  const greedy = [...selection.values()];
  const greedyCost = sumMinor(greedy.map((item) => item.cost), "pack selection");

  // A single bulk pack can beat the greedy mix outright.
  const singleBest = priced
    .filter((pack) => pack.packSize >= excess)
    .sort((a, b) => a.packPrice - b.packPrice || a.packSize - b.packSize || a.id.localeCompare(b.id))[0];

  if (singleBest && singleBest.packPrice < greedyCost) {
    return [
      {
        pack: singleBest,
        count: 1,
        unitsDelivered: singleBest.packSize,
        cost: singleBest.packPrice,
      },
    ];
  }

  return greedy.sort((a, b) => a.pack.id.localeCompare(b.pack.id));
}

// ---------------------------------------------------------------------------
// Candidate evaluation
// ---------------------------------------------------------------------------

export interface Candidate {
  plan: Plan;
  valid: boolean;
  unavailabilityReason: string | null;
  lineItems: QuoteLineItem[];
  coverage: CoverageRow[];
  subtotal: MinorUnits;
  total: MinorUnits;
  /** Integer capacity score; see `scoreCandidate`. */
  coveragePoints: number;
  coverageScore: number;
  trace: CalculationStep[];
  addOnPackCount: number;
}

function packsForPlan(
  catalogue: CatalogueVersion,
  plan: Plan,
  unit: UnitKind,
): AddOnPack[] {
  return catalogue.addOns.filter(
    (addOn) =>
      addOn.unit === unit &&
      plan.allowedAddOnIds.includes(addOn.id) &&
      (addOn.appliesToPlanIds.length === 0 || addOn.appliesToPlanIds.includes(plan.id)),
  );
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

  lineItems.push({
    id: `${plan.id}__base`,
    ruleId: "RULE-BASE-PRICE",
    description: `${plan.name} plan — base subscription`,
    quantity: 1,
    unit: "subscription",
    unitPrice: plan.basePrice,
    lineTotal: plan.basePrice,
    includedQuantity: null,
    sourceId: plan.sourceId,
  });
  pushStep(
    "RULE-BASE-PRICE",
    `${plan.name} base price for one ${plan.billingPeriod} subscription`,
    `base = ${plan.basePrice} minor units`,
    plan.basePrice,
  );

  let unavailabilityReason: string | null = null;

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
      unavailabilityReason ??= `${plan.name} cannot be topped up for ${UNIT_LABELS[unit].toLowerCase()} — no add-on pack is available for this plan.`;
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

    const selected = selectPacks(excess, packs);
    if (selected.length === 0) {
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
        description: `${item.pack.name} add-on pack`,
        quantity: item.count,
        unit: "packs",
        unitPrice: item.pack.packPrice!,
        lineTotal: item.cost,
        includedQuantity: included,
        sourceId: item.pack.sourceId,
      });
      pushStep(
        "RULE-ADDON-PACK",
        `${item.pack.name} on ${plan.name}`,
        `ceil-fit of ${excess} excess ${UNIT_SHORT_UNITS[unit]} → ${item.count} × ${item.pack.packSize} = ${item.unitsDelivered} ${UNIT_SHORT_UNITS[unit]} at ${item.pack.packPrice} each`,
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

  // Tax is deliberately not calculated: no verified tax treatment exists for
  // this market in the demo catalogue, and inventing one is forbidden.
  const total = subtotal;
  pushStep(
    "RULE-TOTAL",
    `${plan.name} total`,
    `sum of ${lineItems.length} line item(s) = ${subtotal}; no tax applied (tax treatment unverified)`,
    total,
  );

  const valid = unavailabilityReason === null && coverage.every((row) => row.satisfied);
  const { coveragePoints, coverageScore } = scoreCandidate(plan, demand, coverage);

  return {
    plan,
    valid,
    unavailabilityReason,
    lineItems,
    coverage,
    subtotal,
    total,
    coveragePoints,
    coverageScore,
    trace,
    addOnPackCount,
  };
}

/**
 * Integer capacity scoring.
 *
 * `coveragePoints` is the sum, over every unit the buyer actually asked for, of
 * delivered-as-a-percentage-of-required, capped at 400 so a single wildly
 * oversized unit cannot dominate. `coverageScore` adds breadth and service-level
 * credit and is used only to rank Best Coverage.
 */
export function scoreCandidate(
  plan: Plan,
  demand: PricingDemand,
  coverage: readonly CoverageRow[],
): { coveragePoints: number; coverageScore: number } {
  let coveragePoints = 0;
  let demandedUnits = 0;

  for (const unit of DEMAND_UNITS) {
    const required = demand[unit];
    if (required <= 0) continue;
    demandedUnits += 1;
    const row = coverage.find((item) => item.unit === unit);
    const delivered = row?.total ?? 0;
    coveragePoints += Math.min(Math.round((delivered * 100) / required), 400);
  }

  if (demandedUnits === 0) coveragePoints = 100;

  const supportedUnitKinds = plan.entitlements.filter((item) => item.included !== null).length;
  const breadthPoints = supportedUnitKinds * 25;
  const pollingPoints = plan.pollingFrequency.includes("10 second") ? 50 : 0;
  const locationPoints = plan.monitoringLocations ?? 0;

  return {
    coveragePoints,
    coverageScore: coveragePoints + breadthPoints + pollingPoints + locationPoints,
  };
}

// ---------------------------------------------------------------------------
// Three-option ranking — rule RANK-v1
// ---------------------------------------------------------------------------

/** a is better value than b when a costs less per point of delivered capacity. */
function betterValue(a: Candidate, b: Candidate): number {
  const left = a.total * b.coveragePoints;
  const right = b.total * a.coveragePoints;
  if (left !== right) return left - right;
  if (a.total !== b.total) return a.total - b.total;
  return a.plan.id.localeCompare(b.plan.id);
}

function cheapest(a: Candidate, b: Candidate): number {
  if (a.total !== b.total) return a.total - b.total;
  if (a.addOnPackCount !== b.addOnPackCount) return a.addOnPackCount - b.addOnPackCount;
  return a.plan.id.localeCompare(b.plan.id);
}

function broadest(a: Candidate, b: Candidate): number {
  if (a.coverageScore !== b.coverageScore) return b.coverageScore - a.coverageScore;
  if (a.total !== b.total) return a.total - b.total;
  return a.plan.id.localeCompare(b.plan.id);
}

const RANKERS: Record<OptionType, (a: Candidate, b: Candidate) => number> = {
  best_value: betterValue,
  lowest_cost: cheapest,
  best_coverage: broadest,
};

const RANK_REASONS: Record<OptionType, (candidate: Candidate) => string> = {
  best_value: (candidate) =>
    `Lowest cost per unit of delivered capacity among valid configurations (${candidate.coveragePoints} capacity points for the quoted total).`,
  lowest_cost: (candidate) =>
    `Cheapest configuration that still meets every stated minimum, using ${candidate.addOnPackCount} add-on pack(s).`,
  best_coverage: (candidate) =>
    `Widest supported coverage among valid configurations: ${candidate.plan.capabilities.length} capability areas, ${candidate.plan.pollingFrequency} polling.`,
};

export interface RankedOptions {
  options: QuoteOption[];
  rejected: Candidate[];
  optionCountNote: string | null;
}

/**
 * Selects up to three distinct options. Slots are filled in priority order and
 * a plan is never reused, so two cards can never show the same configuration
 * under different headings. When a slot cannot be filled with a distinct valid
 * candidate the slot is dropped and the reason is recorded.
 */
export function rankOptions(
  candidates: readonly Candidate[],
  demand: PricingDemand,
  quoteId: string,
): RankedOptions {
  const valid = candidates.filter((candidate) => candidate.valid);
  const rejected = candidates.filter((candidate) => !candidate.valid);

  const used = new Set<string>();
  const options: QuoteOption[] = [];
  const slots: OptionType[] = ["best_value", "lowest_cost", "best_coverage"];

  for (const slot of slots) {
    const pick = [...valid].sort(RANKERS[slot]).find((candidate) => !used.has(candidate.plan.id));
    if (!pick) continue;
    used.add(pick.plan.id);
    options.push(toQuoteOption(pick, slot, demand, quoteId));
  }

  let optionCountNote: string | null = null;
  if (valid.length === 0) {
    optionCountNote =
      "No configuration in the active catalogue satisfies this request. No price is shown rather than an invented one.";
  } else if (options.length < 3) {
    optionCountNote =
      `Only ${options.length} genuinely distinct valid configuration${options.length === 1 ? " exists" : "s exist"} ` +
      `for this request. The remaining plans either lack a capability the request needs, or have no priced add-on ` +
      `to cover the shortfall. Options are not invented to reach three.`;
  }

  return { options, rejected, optionCountNote };
}

function toQuoteOption(
  candidate: Candidate,
  optionType: OptionType,
  demand: PricingDemand,
  quoteId: string,
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
    valid: true,
    unavailabilityReason: null,
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
