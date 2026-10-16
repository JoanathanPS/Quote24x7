import type {
  CatalogueVersion,
  Quote,
  QuoteDocument,
  RequirementProfile,
} from "@/types/domain";

import {
  CALCULATION_VERSION,
  DEMAND_UNITS,
  UNIT_LABELS,
  evaluateCandidate,
  rankOptions,
  runIntegrityChecks,
  type Candidate,
  type PricingDemand,
} from "./engine.ts";

/**
 * Assembles a complete `Quote` record from a demand and a catalogue version.
 *
 * Everything here is derived from catalogue data or from the demand itself —
 * assumptions and exclusions included. No sentence in a generated quote is
 * written by a model.
 */

export interface BuildQuoteInput {
  quoteId: string;
  threadId: string;
  profile: RequirementProfile;
  demand: PricingDemand;
  catalogue: CatalogueVersion;
  createdAt: string;
  documents?: QuoteDocument[];
  status?: Quote["status"];
  version?: number;
  supersededBy?: string | null;
}

export function buildQuote(input: BuildQuoteInput): { quote: Quote; rejected: Candidate[] } {
  const { quoteId, threadId, profile, demand, catalogue, createdAt } = input;

  const candidates = catalogue.plans.map((plan) => evaluateCandidate(catalogue, plan, demand));
  const { options, rejected, optionCountNote, comparisonLine } = rankOptions(candidates, demand, quoteId);

  const trace = [
    {
      step: 0,
      ruleId: "RULE-CATALOGUE-RESOLVE",
      description: `Resolved active catalogue ${catalogue.version} for market ${catalogue.market}`,
      computation: `currency=${catalogue.currency}, billing=${catalogue.plans[0]?.billingPeriod ?? "unknown"}, hash=${catalogue.contentHash}`,
      resultMinor: null,
    },
    ...options.flatMap((option) => {
      const candidate = candidates.find((item) => item.plan.id === option.planId);
      if (!candidate) return [];
      return candidate.trace.map((entry) => ({
        ...entry,
        description: `[${option.planName}] ${entry.description}`,
      }));
    }),
  ];

  const integrityChecks = runIntegrityChecks(catalogue, options, demand);

  const quote: Quote = {
    id: quoteId,
    threadId,
    requirementProfileId: profile.id,
    catalogueVersionId: catalogue.id,
    catalogueVersion: catalogue.version,
    calculationVersion: CALCULATION_VERSION,
    status:
      input.status ??
      (options.length > 0 && integrityChecks.every((c) => c.passed) ? "validated" : "estimate"),
    pricingStatus:
      catalogue.verificationStatus === "company_authorized" ? "authorized" : "demo_unverified",
    market: catalogue.market,
    currency: catalogue.currency,
    billingPeriod: catalogue.plans[0]?.billingPeriod ?? "annual",
    createdAt,
    version: input.version ?? 1,
    supersededBy: input.supersededBy ?? null,
    // No verified quote-validity policy exists, so no expiry date is claimed.
    expiresAt: null,
    options,
    assumptions: buildAssumptions(demand, catalogue, profile),
    exclusions: buildExclusions(catalogue),
    calculationTrace: trace,
    integrityChecks,
    documents: input.documents ?? [],
    optionCountNote,
    comparisonLine,
  };

  return { quote, rejected };
}

function buildAssumptions(
  demand: PricingDemand,
  catalogue: CatalogueVersion,
  profile: RequirementProfile,
): string[] {
  const assumptions: string[] = [];

  const stated = DEMAND_UNITS.filter((unit) => demand[unit] > 0).map(
    (unit) => `${UNIT_LABELS[unit]}: ${demand[unit].toLocaleString("en-IN")}`,
  );
  if (stated.length > 0) {
    assumptions.push(`Priced against the quantities understood from the request — ${stated.join("; ")}.`);
  }

  assumptions.push(
    `All amounts are in ${catalogue.currency} for the ${catalogue.market} market, billed ${
      catalogue.plans[0]?.billingPeriod === "annual" ? "annually" : "monthly"
    }.`,
  );

  const inferred = profile.fields.filter((field) => field.state === "inferred");
  for (const field of inferred) {
    assumptions.push(
      `${field.label} was not stated explicitly; ${String(field.value)}${field.unit ? ` ${field.unit}` : ""} was inferred from the request and used in the calculation.`,
    );
  }

  // Explicit Website Monitoring Allowance
  const hasWebsite = profile.fields.some((f) => f.key === "website_monitoring") || demand.basic_monitor > 0;
  if (hasWebsite) {
    assumptions.push(
      "Website Availability Monitoring: Website uptime and accessibility checks are covered under the base plan subscription's included basic monitor allowance (Lite includes 5, Professional includes 20, Enterprise includes 50) at INR 0 additional cost.",
    );
  }

  // Explicit APM Capability & Pack Information
  const hasApm = profile.fields.some((f) => f.key === "application_monitoring");
  if (hasApm) {
    assumptions.push(
      "Application Performance Monitoring (APM): Server/host monitoring does not implicitly bundle custom APM instances. In the active catalogue, Lite includes 0 APM/advanced monitors, Professional includes 1 included APM/advanced monitor, and Enterprise includes 10 included APM/advanced monitors. Additional APM capacity requires 2-pack Advanced Monitor add-ons (INR 15,390.00/yr per pack) or custom APM licensing once specific runtime instances are confirmed.",
    );
  }

  const zeroButUnverified = catalogue.notes.find((note) => note.includes("Enterprise plan were not visible"));
  if (zeroButUnverified) {
    assumptions.push(
      "Where an included quantity could not be verified from the supplied sources it was treated as zero, so any error in this quote overstates rather than understates cost.",
    );
  }

  assumptions.push(
    "Add-on capacity is sold in whole packs, so delivered quantities may exceed the amounts requested.",
  );

  assumptions.push(
    `Catalogue Notice: Sizing and pricing reflect official catalogue rates (${catalogue.version}, verification: ${catalogue.verificationStatus}) and are non-binding.`,
  );

  return assumptions;
}

function buildExclusions(catalogue: CatalogueVersion): string[] {
  return [
    "Taxes, duties and levies — no verified tax treatment exists for this market in the active catalogue, so none has been applied.",
    "Discounts and promotional pricing — standard catalogue list prices are applied; volume or partner discounts are calculated during official checkout.",
    "Onboarding, professional services, migration and training.",
    "Unquantified custom APM instances beyond included base entitlements (separate add-on packs apply).",
    "Any monitoring capability not listed in the coverage table for the chosen option.",
    `Contractual terms, service-level commitments and quote validity periods — catalogue ${catalogue.version} carries no authorised policy for these.`,
  ];
}
