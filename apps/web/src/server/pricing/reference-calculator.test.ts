import assert from "node:assert/strict";
import test from "node:test";

import { loadActiveCatalogue } from "../catalogue/loader.ts";
import { evaluateCandidate, rankOptions, type DemandUnit, type PricingDemand } from "./engine.ts";
import type { CatalogueVersion, Plan } from "@/types/domain";

/**
 * Independent Min-Cost-Cover Calculator.
 *
 * Implements an unbounded knapsack per unit using dynamic programming.
 * Does NOT import or share any code from engine.ts.
 * Only uses active catalogue plans and prices from the catalogue seed.
 * Excludes SKUs with needsConfirmation === true.
 */
interface PackOption {
  id: string;
  name: string;
  packSize: number;
  priceMinor: number;
  unit: DemandUnit;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

function solveIndependentMinCostCover(
  needed: number,
  packs: PackOption[],
): { costMinor: number; packCounts: Map<string, number> } {
  if (needed <= 0) {
    return { costMinor: 0, packCounts: new Map() };
  }
  if (packs.length === 0) {
    return { costMinor: Infinity, packCounts: new Map() };
  }

  const g = packs.reduce((acc, p) => gcd(acc, p.packSize), packs[0]!.packSize);
  const normalizedPacks = packs.map((p) => ({
    ...p,
    normalizedSize: Math.floor(p.packSize / g),
  }));
  const normalizedNeeded = Math.ceil(needed / g);

  const maxPackSize = Math.max(...normalizedPacks.map((p) => p.normalizedSize));
  const upperLimit = normalizedNeeded + maxPackSize;
  const dp: number[] = new Array(upperLimit + 1).fill(Infinity);
  const parentPack: number[] = new Array(upperLimit + 1).fill(-1);
  const parentPrev: number[] = new Array(upperLimit + 1).fill(-1);

  dp[0] = 0;
  for (let c = 0; c < upperLimit; c++) {
    if (dp[c] === Infinity) continue;
    for (let i = 0; i < normalizedPacks.length; i++) {
      const next = Math.min(upperLimit, c + normalizedPacks[i]!.normalizedSize);
      const nextCost = dp[c]! + normalizedPacks[i]!.priceMinor;
      if (nextCost < dp[next]!) {
        dp[next] = nextCost;
        parentPack[next] = i;
        parentPrev[next] = c;
      }
    }
  }

  let bestCap = normalizedNeeded;
  let minCost = Infinity;
  for (let c = normalizedNeeded; c <= upperLimit; c++) {
    if (dp[c]! < minCost) {
      minCost = dp[c]!;
      bestCap = c;
    }
  }

  const packCounts = new Map<string, number>();
  let curr = bestCap;
  while (curr > 0) {
    const pIdx = parentPack[curr];
    if (pIdx === -1 || pIdx === undefined) break;
    const pack = normalizedPacks[pIdx]!;
    packCounts.set(pack.id, (packCounts.get(pack.id) ?? 0) + 1);
    curr = parentPrev[curr]!;
    if (curr <= 0) break;
  }

  return { costMinor: minCost, packCounts };
}

function getAvailablePacks(catalogue: CatalogueVersion, plan: Plan, unit: DemandUnit): PackOption[] {
  const planPrices = catalogue.planAddOnPrices?.[plan.id];
  if (!planPrices) return [];

  return catalogue.addOns
    .filter((a) => {
      if (a.unit !== unit) return false;
      if (!plan.allowedAddOnIds.includes(a.id)) return false;
      if (
        a.id === "addon_logs_10gb_6mo" ||
        a.id === "addon_log_fwd_10gb" ||
        /needs_confirmation/i.test(a.id) ||
        /needs_confirmation/i.test(a.name) ||
        /Storage for 6 Months/i.test(a.name) ||
        /Log Forwarding/i.test(a.name)
      ) {
        return false;
      }
      if (unit === "applog_gb") {
        const isAllowedLog =
          a.id === "addon_logs_10gb" ||
          a.id === "addon_logs_100gb" ||
          a.id === "addon_logs_1tb" ||
          /^(?:10|100|1)\s*(?:GB|TB)\s*Logs$/i.test(a.name.trim());
        if (!isAllowedLog) return false;
      }
      return planPrices[a.id] !== undefined && planPrices[a.id] !== null;
    })
    .map((a) => ({
      id: a.id,
      name: a.name,
      packSize: a.packSize,
      priceMinor: planPrices[a.id]!,
      unit,
    }));
}

function referenceCalculate(
  catalogue: CatalogueVersion,
  plan: Plan,
  demand: PricingDemand,
): { valid: boolean; totalMinor: number; lineItems: Array<{ desc: string; qty: number; totalRupees: number }> } {
  const units: DemandUnit[] = [
    "host_monitor",
    "network_component",
    "basic_monitor",
    "advanced_monitor",
    "rum_pageview",
    "applog_gb",
  ];

  for (const unit of units) {
    const requested = demand[unit] || 0;
    const included = plan.entitlements.find((e) => e.unit === unit)?.included ?? 0;
    if (requested > included) {
      const available = getAvailablePacks(catalogue, plan, unit);
      if (available.length === 0) {
        return { valid: false, totalMinor: 0, lineItems: [] };
      }
    }
  }

  const basePriceAnnualMinor = (plan.priceMonthlyAnnualBilled ?? plan.basePrice) * 12;
  let totalMinor = basePriceAnnualMinor;
  const lineItems: Array<{ desc: string; qty: number; totalRupees: number }> = [
    { desc: `${plan.name} base subscription`, qty: 1, totalRupees: Math.round(basePriceAnnualMinor / 100) },
  ];

  for (const unit of units) {
    const requested = demand[unit] || 0;
    const included = plan.entitlements.find((e) => e.unit === unit)?.included ?? 0;
    const needed = Math.max(0, requested - included);
    if (needed === 0) continue;

    const availablePacks = getAvailablePacks(catalogue, plan, unit);
    const result = solveIndependentMinCostCover(needed, availablePacks);
    if (result.costMinor === Infinity) {
      return { valid: false, totalMinor: 0, lineItems: [] };
    }

    totalMinor += result.costMinor;
    for (const [packId, qty] of result.packCounts) {
      const pack = availablePacks.find((p) => p.id === packId)!;
      lineItems.push({
        desc: `${pack.name} add-on pack (annual)`,
        qty,
        totalRupees: Math.round((pack.priceMinor * qty) / 100),
      });
    }
  }

  return { valid: true, totalMinor, lineItems };
}

// ---------------------------------------------------------------------------
// Item 3 Golden Assertions
// ---------------------------------------------------------------------------

test("Item 3 Reference Calculator: Acme T1 (Professional ₹3,05,425, Lite ₹3,53,305)", () => {
  const cat = loadActiveCatalogue();
  const pro = cat.plans.find((p) => p.name === "Professional")!;
  const lite = cat.plans.find((p) => p.name === "Lite")!;
  const demand: PricingDemand = {
    host_monitor: 50,
    network_component: 8,
    basic_monitor: 5,
    advanced_monitor: 2,
    applog_gb: 600,
    rum_pageview: 0,
  };

  const refPro = referenceCalculate(cat, pro, demand);
  assert.equal(refPro.valid, true);
  assert.equal(refPro.totalMinor, 30542500, "Acme T1 Professional total must be 3,05,425");
  const engPro = evaluateCandidate(cat, pro, demand);
  assert.equal(engPro.total, refPro.totalMinor);

  const refLite = referenceCalculate(cat, lite, demand);
  assert.equal(refLite.valid, true);
  assert.equal(refLite.totalMinor, 35330500, "Acme T1 Lite total must be 3,53,305");
  const engLite = evaluateCandidate(cat, lite, demand);
  assert.equal(engLite.total, refLite.totalMinor);
});

test("Item 3 Reference Calculator: Acme T2 (Professional ₹2,86,140, Lite ₹3,16,350)", () => {
  const cat = loadActiveCatalogue();
  const pro = cat.plans.find((p) => p.name === "Professional")!;
  const lite = cat.plans.find((p) => p.name === "Lite")!;
  const demand: PricingDemand = {
    host_monitor: 40,
    network_component: 0,
    basic_monitor: 5,
    advanced_monitor: 2,
    applog_gb: 600,
    rum_pageview: 0,
  };

  const refPro = referenceCalculate(cat, pro, demand);
  assert.equal(refPro.valid, true);
  assert.equal(refPro.totalMinor, 28614000, "Acme T2 Professional total must be 2,86,140");
  const engPro = evaluateCandidate(cat, pro, demand);
  assert.equal(engPro.total, refPro.totalMinor);

  const refLite = referenceCalculate(cat, lite, demand);
  assert.equal(refLite.valid, true);
  assert.equal(refLite.totalMinor, 31635000, "Acme T2 Lite total must be 3,16,350");
  const engLite = evaluateCandidate(cat, lite, demand);
  assert.equal(engLite.total, refLite.totalMinor);
});

test("Item 3 Reference Calculator: Case 2 Professional T1 (₹7,46,035) and T2 (₹5,74,370)", () => {
  const cat = loadActiveCatalogue();
  const pro = cat.plans.find((p) => p.name === "Professional")!;

  const demandT1: PricingDemand = {
    host_monitor: 80,
    network_component: 16,
    basic_monitor: 0,
    advanced_monitor: 10,
    rum_pageview: 1000000,
    applog_gb: 3000,
  };
  const refT1 = referenceCalculate(cat, pro, demandT1);
  assert.equal(refT1.valid, true);
  assert.equal(refT1.totalMinor, 74603500, "Case 2 T1 Professional total must be 7,46,035");
  const engT1 = evaluateCandidate(cat, pro, demandT1);
  assert.equal(engT1.total, refT1.totalMinor);

  const demandT2: PricingDemand = {
    host_monitor: 70,
    network_component: 16,
    basic_monitor: 0,
    advanced_monitor: 10,
    rum_pageview: 1000000,
    applog_gb: 1500,
  };
  const refT2 = referenceCalculate(cat, pro, demandT2);
  assert.equal(refT2.valid, true);
  assert.equal(refT2.totalMinor, 57437000, "Case 2 T2 Professional total must be 5,74,370");
  const engT2 = evaluateCandidate(cat, pro, demandT2);
  assert.equal(engT2.total, refT2.totalMinor);
});

test("Item 3 Reference Calculator: Case 3 (Lite ₹98,800, Professional ₹1,14,855)", () => {
  const cat = loadActiveCatalogue();
  const lite = cat.plans.find((p) => p.name === "Lite")!;
  const pro = cat.plans.find((p) => p.name === "Professional")!;

  const demand: PricingDemand = {
    host_monitor: 20,
    network_component: 4,
    basic_monitor: 6,
    advanced_monitor: 0,
    rum_pageview: 0,
    applog_gb: 50,
  };

  const refLite = referenceCalculate(cat, lite, demand);
  assert.equal(refLite.valid, true);
  assert.equal(refLite.totalMinor, 9880000, "Case 3 Lite total must be 98,800");
  const engLite = evaluateCandidate(cat, lite, demand);
  assert.equal(engLite.total, refLite.totalMinor);

  const refPro = referenceCalculate(cat, pro, demand);
  assert.equal(refPro.valid, true);
  assert.equal(refPro.totalMinor, 11485500, "Case 3 Professional total must be 1,14,855");
  const engPro = evaluateCandidate(cat, pro, demand);
  assert.equal(engPro.total, refPro.totalMinor);
});

test("Item 3 Property Test: 200 random small requirement sets comparing engine to reference for all plans", () => {
  const cat = loadActiveCatalogue();
  const plans = cat.plans.filter((p) => p.name === "Lite" || p.name === "Professional");

  for (let seed = 0; seed < 200; seed++) {
    const demand: PricingDemand = {
      host_monitor: Math.floor((seed * 37) % 65),
      network_component: Math.floor((seed * 19) % 25),
      basic_monitor: Math.floor((seed * 13) % 30),
      advanced_monitor: Math.floor((seed * 7) % 15),
      rum_pageview: (seed % 3 === 0) ? Math.floor((seed * 100000) % 2000000) : 0,
      applog_gb: Math.floor((seed * 53) % 800),
    };

    for (const plan of plans) {
      const ref = referenceCalculate(cat, plan, demand);
      const eng = evaluateCandidate(cat, plan, demand);

      assert.equal(
        eng.valid,
        ref.valid,
        `Validity mismatch on seed ${seed} plan ${plan.name}`,
      );
      if (eng.valid && ref.valid) {
        assert.equal(
          eng.total,
          ref.totalMinor,
          `Total mismatch on seed ${seed} plan ${plan.name}: engine=${eng.total} ref=${ref.totalMinor}`,
        );
      }
    }
  }
});

test("Item 4 Line Items: Sum of line items equals quote total for all six cases (both turns)", () => {
  const casesDemands: Array<{ name: string; demand: PricingDemand }> = [
    { name: "Case 1 T1", demand: { host_monitor: 50, network_component: 8, basic_monitor: 5, advanced_monitor: 2, applog_gb: 600, rum_pageview: 0 } },
    { name: "Case 1 T2", demand: { host_monitor: 40, network_component: 0, basic_monitor: 5, advanced_monitor: 2, applog_gb: 600, rum_pageview: 0 } },
    { name: "Case 2 T1", demand: { host_monitor: 80, network_component: 16, basic_monitor: 0, advanced_monitor: 10, applog_gb: 3000, rum_pageview: 1000000 } },
    { name: "Case 2 T2", demand: { host_monitor: 70, network_component: 16, basic_monitor: 0, advanced_monitor: 10, applog_gb: 1500, rum_pageview: 1000000 } },
    { name: "Case 3 T2", demand: { host_monitor: 20, network_component: 4, basic_monitor: 6, advanced_monitor: 0, applog_gb: 50, rum_pageview: 0 } },
    { name: "Case 4 T1", demand: { host_monitor: 25, network_component: 8, basic_monitor: 10, advanced_monitor: 0, applog_gb: 100, rum_pageview: 0 } },
    { name: "Case 4 T2", demand: { host_monitor: 35, network_component: 12, basic_monitor: 10, advanced_monitor: 0, applog_gb: 100, rum_pageview: 0 } },
    { name: "Case 5 T1", demand: { host_monitor: 50, network_component: 8, basic_monitor: 5, advanced_monitor: 2, applog_gb: 600, rum_pageview: 0 } },
    { name: "Case 5 T2", demand: { host_monitor: 50, network_component: 0, basic_monitor: 5, advanced_monitor: 2, applog_gb: 600, rum_pageview: 0 } },
    { name: "Case 6 T1", demand: { host_monitor: 15, network_component: 0, basic_monitor: 3, advanced_monitor: 0, applog_gb: 150, rum_pageview: 0 } },
    { name: "Case 6 T2", demand: { host_monitor: 25, network_component: 0, basic_monitor: 3, advanced_monitor: 0, applog_gb: 150, rum_pageview: 0 } },
  ];

  const cat = loadActiveCatalogue();
  for (const c of casesDemands) {
    const candidates = cat.plans.map((p) => evaluateCandidate(cat, p, c.demand));
    const ranked = rankOptions(candidates, c.demand, `q_test_${c.name}`);
    assert.ok(ranked.options.length > 0, `At least one option for ${c.name}`);
    for (const opt of ranked.options) {
      const sumOfLines = opt.lineItems.reduce((acc, item) => acc + item.lineTotal, 0);
      assert.equal(sumOfLines, opt.total, `Sum of line items must equal option total for ${c.name} plan ${opt.planName}`);
    }
  }
});
