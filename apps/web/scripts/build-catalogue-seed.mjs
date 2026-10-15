#!/usr/bin/env node
/**
 * Builds the catalogue seed SQL from the verbatim PDF extraction.
 *
 * The extraction JSON is the reviewable artifact: a human can diff it against
 * the source screenshots. This script is the only thing that turns it into
 * SQL, so no figure is ever typed twice.
 *
 * It fails closed. Any dangling reference, malformed price or disagreement
 * between two source tabs about the same SKU aborts the build rather than
 * emitting a seed that would quietly misprice something.
 *
 *   node scripts/build-catalogue-seed.mjs
 *       --in  ../../catalogues/site24x7-in-2026-10/extraction.json
 *       --out supabase/seed-catalogue-in-2026-10.sql
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const here = path.dirname(fileURLToPath(import.meta.url));
const inPath = path.resolve(here, argOf("--in", "../../../catalogues/site24x7-in-2026-10/extraction.json"));
const outPath = path.resolve(here, argOf("--out", "../supabase/seed-catalogue-in-2026-10.sql"));

const problems = [];
const fail = (msg) => problems.push(msg);

const raw = readFileSync(inPath, "utf8");
const data = JSON.parse(raw);

/** Exact decimal-rupee string to integer paise. No floating point anywhere. */
function toPaise(value, where) {
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value)) {
    fail(`${where}: price must be a decimal-rupee string with at most 2 dp, got ${JSON.stringify(value)}`);
    return 0n;
  }
  const [whole, frac = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
}

const q = (s) => (s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined ? "null" : String(v));
const b = (v) => (v ? "true" : "false");

// ---------------------------------------------------------------- validation
const unitSet = new Set(data.units.map((u) => u.unit));
const sourceSet = new Set(data.sources.map((s) => s.id));
const familySet = new Set(data.families.map((f) => f.id));
const planSet = new Set(data.plans.map((p) => p.id));
const addOnSet = new Set(data.addOns.map((a) => a.id));

if (data.units.length !== unitSet.size) fail("duplicate unit keys");
if (data.plans.length !== planSet.size) fail("duplicate plan ids");
if (data.addOns.length !== addOnSet.size) fail("duplicate add-on ids");

for (const s of data.sources) {
  if (!["site24x7_public", "zoho_store"].includes(s.surface)) fail(`source ${s.id}: bad surface ${s.surface}`);
}

for (const p of data.plans) {
  if (!sourceSet.has(p.sourceId)) fail(`plan ${p.id}: unknown sourceId ${p.sourceId}`);
  if (!p.families?.length) fail(`plan ${p.id}: must belong to at least one family`);
  for (const f of p.families ?? []) if (!familySet.has(f)) fail(`plan ${p.id}: unknown family ${f}`);
  if (!p.quoteOnRequest && !p.priceMonthlyAnnualBilled) {
    fail(`plan ${p.id}: has no price and is not marked quoteOnRequest`);
  }
  const seen = new Set();
  for (const e of p.entitlements ?? []) {
    if (!unitSet.has(e.unit)) fail(`plan ${p.id}: entitlement on unknown unit ${e.unit}`);
    if (seen.has(e.unit)) {
      // Two tabs describing one SKU must agree; we refuse to pick a winner.
      fail(`plan ${p.id}: duplicate entitlement for unit ${e.unit} — sources disagree, resolve manually`);
    }
    seen.add(e.unit);
    if (!sourceSet.has(e.sourceId)) fail(`plan ${p.id}/${e.unit}: unknown sourceId ${e.sourceId}`);
    if (e.included !== null && (!Number.isInteger(e.included) || e.included < 0)) {
      fail(`plan ${p.id}/${e.unit}: included must be a non-negative integer or null`);
    }
  }
}

for (const a of data.addOns) {
  if (!a.grants?.length) fail(`add-on ${a.id}: must grant at least one unit`);
  for (const g of a.grants ?? []) {
    if (!unitSet.has(g.unit)) fail(`add-on ${a.id}: grants unknown unit ${g.unit}`);
    if (!Number.isInteger(g.quantity) || g.quantity <= 0) fail(`add-on ${a.id}/${g.unit}: quantity must be a positive integer`);
  }
}

let priceRowCount = 0;
for (const [planId, packs] of Object.entries(data.planAddOnPrices)) {
  if (!planSet.has(planId)) fail(`planAddOnPrices: unknown plan ${planId}`);
  for (const [addOnId, rupees] of Object.entries(packs)) {
    if (!addOnSet.has(addOnId)) fail(`planAddOnPrices[${planId}]: unknown add-on ${addOnId}`);
    toPaise(rupees, `planAddOnPrices[${planId}][${addOnId}]`);
    priceRowCount += 1;
  }
}

// Every add-on must be priced on at least one plan, or it is dead data.
for (const a of data.addOns) {
  const priced = Object.values(data.planAddOnPrices).some((packs) => a.id in packs);
  if (!priced) fail(`add-on ${a.id}: not priced on any plan — remove it or add its price`);
}

if (problems.length) {
  console.error(`\nCatalogue extraction is invalid (${problems.length} problem(s)):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\nNo seed written.\n");
  process.exit(1);
}

// ------------------------------------------------------------------- emit
const contentHash = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
const c = data.catalogue;
const out = [];
const w = (s = "") => out.push(s);

w("-- ==============================================================================");
w(`-- Quote24x7 catalogue seed - ${c.id} (${c.version})`);
w("--");
w("-- GENERATED FILE. Do not edit by hand.");
w("--   source:    catalogues/site24x7-in-2026-10/extraction.json");
w("--   generator: apps/web/scripts/build-catalogue-seed.mjs");
w("--");
w(`-- Price authority: ${c.priceAuthority}`);
w(`-- Quote basis:     ${c.quoteBasis}`);
w("-- All money is stored in paise as bigint.");
w("--");
w("-- Run supabase/schema.sql first, then this file.");
w("-- ==============================================================================");
w();
w("begin;");
w();
w("-- Idempotent: clear this catalogue version, then re-seed. Cascades handle children.");
w(`delete from public.catalogue_versions where id = ${q(c.id)};`);
w();

w("-- Billable units");
w("insert into public.catalogue_units (unit, label, short_unit, is_demand_unit) values");
w(data.units.map((u) => `  (${q(u.unit)}, ${q(u.label)}, ${q(u.shortUnit)}, ${b(u.isDemandUnit)})`).join(",\n") + "\non conflict (unit) do update set label = excluded.label, short_unit = excluded.short_unit, is_demand_unit = excluded.is_demand_unit;");
w();

w("-- Catalogue version");
w("insert into public.catalogue_versions (id, version, market, currency, status, quote_basis, price_authority, content_hash, effective_from, activated_at, notes) values");
w(`  (${q(c.id)}, ${q(c.version)}, ${q(c.market)}, ${q(c.currency)}, ${q(c.status)}, ${q(c.quoteBasis)}, ${q(c.priceAuthority)}, ${q(contentHash)}, ${q(c.effectiveFrom)}, now(), ${q(JSON.stringify(c.notes))}::jsonb);`);
w();

w("-- Sources (provenance)");
w("insert into public.catalogue_sources (id, catalogue_version_id, title, locator, url, surface, retrieved_at, verification_status, caveats) values");
w(data.sources.map((s) =>
  `  (${q(s.id)}, ${q(c.id)}, ${q(s.title)}, ${q(s.locator)}, ${q(s.url)}, ${q(s.surface)}, ${q(s.retrievedAt)}, ${q(s.verificationStatus)}, ${q(JSON.stringify(s.caveats ?? []))}::jsonb)`
).join(",\n") + ";");
w();

w("-- Plan families (the four public pricing tabs)");
w("insert into public.catalogue_plan_families (id, catalogue_version_id, name, tab_label, display_order) values");
w(data.families.map((f) => `  (${q(f.id)}, ${q(c.id)}, ${q(f.name)}, ${q(f.tabLabel)}, ${n(f.displayOrder)})`).join(",\n") + ";");
w();

w("-- Plans. price_* columns hold published figures only; the annual contract");
w("-- value is computed by the pricing engine and recorded in the quote trace.");
w("insert into public.catalogue_plans (id, catalogue_version_id, name, store_name, summary, price_monthly_annual_billed, price_month_to_month, quote_on_request, price_is_floor, polling_frequency, monitoring_locations, support_tier, store_price_monthly_annual_billed, source_id, display_order) values");
w(data.plans.map((p) => {
  const base = p.priceMonthlyAnnualBilled ? toPaise(p.priceMonthlyAnnualBilled, p.id) : null;
  const m2m = p.priceMonthToMonth ? toPaise(p.priceMonthToMonth, p.id) : null;
  const store = p.storePriceMonthlyAnnualBilled ? toPaise(p.storePriceMonthlyAnnualBilled, p.id) : null;
  return `  (${q(p.id)}, ${q(c.id)}, ${q(p.name)}, ${q(p.storeName)}, ${q(p.summary)}, ${n(base)}, ${n(m2m)}, ${b(p.quoteOnRequest)}, ${b(p.priceIsFloor)}, ${q(p.pollingFrequency)}, ${n(p.monitoringLocations)}, ${q(p.supportTier)}, ${n(store)}, ${q(p.sourceId)}, ${n(p.displayOrder)})`;
}).join(",\n") + ";");
w();

w("-- Plan/family membership. Lite, Professional and Enterprise each sit under");
w("-- both Infrastructure and All-in-One at an identical published price.");
w("insert into public.catalogue_plan_family_members (plan_id, family_id, display_order) values");
w(data.plans.flatMap((p) => p.families.map((f) => `  (${q(p.id)}, ${q(f)}, ${n(p.displayOrder)})`)).join(",\n") + ";");
w();

const entRows = data.plans.flatMap((p) =>
  (p.entitlements ?? []).map((e) => `  (${q(p.id)}, ${q(e.unit)}, ${n(e.included)}, ${q(e.label)}, ${q(e.sourceId)})`)
);
w("-- Plan entitlements. null included = capability not offered on the plan;");
w("-- 0 = offered but nothing bundled, so it requires an add-on.");
w("insert into public.catalogue_plan_entitlements (plan_id, unit, included, label, source_id) values");
w(entRows.join(",\n") + ";");
w();

w("-- Add-on packs (identity only, no price)");
w("insert into public.catalogue_addons (id, catalogue_version_id, name, billing_period, display_order) values");
w(data.addOns.map((a, i) => `  (${q(a.id)}, ${q(c.id)}, ${q(a.name)}, ${q(a.billingPeriod)}, ${i + 1})`).join(",\n") + ";");
w();

w("-- Add-on grants. Compound packs such as '500K Pageviews & 5 sites' grant two");
w("-- units for one price, which is therefore never apportioned between them.");
w("insert into public.catalogue_addon_grants (addon_id, unit, quantity) values");
w(data.addOns.flatMap((a) => a.grants.map((g) => `  (${q(a.id)}, ${q(g.unit)}, ${n(g.quantity)})`)).join(",\n") + ";");
w();

const priceRows = [];
for (const [planId, packs] of Object.entries(data.planAddOnPrices)) {
  const billingOf = new Map(data.addOns.map((a) => [a.id, a.billingPeriod]));
  for (const [addOnId, rupees] of Object.entries(packs)) {
    priceRows.push(`  (${q(planId)}, ${q(addOnId)}, ${toPaise(rupees, `${planId}/${addOnId}`)}, ${q(billingOf.get(addOnId))}, ${q("src_store_addon_prices")})`);
  }
}
w("-- Plan/add-on prices. The same pack costs different amounts on different");
w("-- plans, so there is one row per (plan, add-on) and no global price.");
w("-- A zero here is a real published price, not a missing value.");
w("insert into public.catalogue_plan_addon_prices (plan_id, addon_id, price, billing_period, source_id) values");
w(priceRows.join(",\n") + ";");
w();
w("commit;");
w();

writeFileSync(outPath, out.join("\n"), "utf8");

console.log(`Catalogue seed written: ${path.relative(process.cwd(), outPath)}`);
console.log(`  content hash      ${contentHash}`);
console.log(`  units             ${data.units.length}`);
console.log(`  sources           ${data.sources.length}`);
console.log(`  families          ${data.families.length}`);
console.log(`  plans             ${data.plans.length}`);
console.log(`  entitlements      ${entRows.length}`);
console.log(`  add-on packs      ${data.addOns.length}`);
console.log(`  plan/add-on rows  ${priceRowCount}`);
