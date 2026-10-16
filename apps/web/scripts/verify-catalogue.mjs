#!/usr/bin/env node
/**
 * Verifies the seeded catalogue against the live Supabase project.
 *
 * Read-only. Mirrors supabase/verify-catalogue.sql so the same assertions can be
 * run from CI or a terminal instead of pasted into the SQL editor.
 *
 *   node --env-file=.env.local scripts/verify-catalogue.mjs
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Try: node --env-file=.env.local scripts/verify-catalogue.mjs");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
const ok = (label, detail = "") => console.log(`  OK    ${label}${detail ? `  ${detail}` : ""}`);
const bad = (label, detail = "") => { failures += 1; console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`); };

const EXPECTED_COUNTS = {
  catalogue_units: 22,
  catalogue_sources: 6,
  catalogue_plan_families: 4,
  catalogue_plans: 8,
  catalogue_plan_family_members: 11,
  catalogue_plan_entitlements: 45,
  catalogue_addons: 87,
  catalogue_addon_grants: 99,
  catalogue_plan_addon_prices: 176,
};

console.log("\nRow counts");
for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) bad(table.padEnd(30), `query failed: ${error.message}`);
  else if (count === expected) ok(table.padEnd(30), `${count}`);
  else bad(table.padEnd(30), `expected ${expected}, got ${count}`);
}

console.log("\nActive catalogue");
{
  const { data, error } = await db.from("catalogue_versions")
    .select("id, version, status, quote_basis, price_authority, content_hash")
    .eq("market", "IN").eq("currency", "INR").eq("status", "active");
  if (error) bad("active version query", error.message);
  else if (data.length !== 1) bad("exactly one active IN/INR catalogue", `got ${data.length}`);
  else {
    const v = data[0];
    ok("exactly one active IN/INR catalogue", `${v.id} (${v.version})`);
    v.quote_basis === "annual_from_monthly_x12" ? ok("quote_basis", v.quote_basis) : bad("quote_basis", v.quote_basis);
    v.price_authority === "site24x7_public" ? ok("price_authority", v.price_authority) : bad("price_authority", v.price_authority);
  }
}

console.log("\nPlan-scoped pricing: 500 Basic Monitors (one pack, three prices)");
{
  const { data, error } = await db.from("catalogue_plan_addon_prices")
    .select("price, catalogue_plans(name)").eq("addon_id", "addon_basic_500").order("price");
  const expected = { "Enterprise Plus Web": 28158000, Professional: 46170000, Enterprise: 73872000 };
  if (error) bad("500 Basic Monitors query", error.message);
  else if (data.length !== 3) bad("three distinct plan prices", `got ${data.length}`);
  else {
    for (const row of data) {
      const name = row.catalogue_plans?.name;
      const want = expected[name];
      Number(row.price) === want
        ? ok(`${name.padEnd(20)}`, `${Number(row.price)} paise`)
        : bad(`${name}`, `expected ${want}, got ${row.price}`);
    }
    new Set(data.map((r) => Number(r.price))).size === 3
      ? ok("all three prices differ")
      : bad("all three prices differ", "duplicate prices found");
  }
}

console.log("\nSource disagreements (public price is quoted; store kept for reference)");
{
  const { data, error } = await db.from("catalogue_plans")
    .select("name, price_monthly_annual_billed, store_price_monthly_annual_billed")
    .not("store_price_monthly_annual_billed", "is", null);
  if (error) bad("disagreement query", error.message);
  else {
    const diff = data.filter((p) => Number(p.price_monthly_annual_billed) !== Number(p.store_price_monthly_annual_billed));
    diff.length === 3 ? ok("exactly three plans disagree") : bad("exactly three plans disagree", `got ${diff.length}`);
    for (const p of diff.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`        ${p.name.padEnd(16)} quoted ${(Number(p.price_monthly_annual_billed) / 100).toFixed(2).padStart(10)}   store ${(Number(p.store_price_monthly_annual_billed) / 100).toFixed(2).padStart(10)}`);
    }
  }
}

console.log("\nIntegrity");
{
  const [{ data: addons }, { data: priced }, { data: grants }] = await Promise.all([
    db.from("catalogue_addons").select("id"),
    db.from("catalogue_plan_addon_prices").select("addon_id"),
    db.from("catalogue_addon_grants").select("addon_id"),
  ]);
  const pricedSet = new Set((priced ?? []).map((r) => r.addon_id));
  const grantSet = new Set((grants ?? []).map((r) => r.addon_id));
  const unpriced = (addons ?? []).filter((a) => !pricedSet.has(a.id)).map((a) => a.id);
  const grantless = (addons ?? []).filter((a) => !grantSet.has(a.id)).map((a) => a.id);
  unpriced.length === 0 ? ok("every add-on is priced on at least one plan") : bad("unpriced add-ons", unpriced.join(", "));
  grantless.length === 0 ? ok("every add-on grants at least one unit") : bad("grantless add-ons", grantless.join(", "));
}

console.log("\nZero is a real published price");
{
  const { data, error } = await db.from("catalogue_plan_addon_prices")
    .select("price, catalogue_plans(name), catalogue_addons(name)").eq("price", 0);
  if (error) bad("zero-price query", error.message);
  else if (data.length !== 2) bad("two zero-priced rows on Enterprise", `got ${data.length}`);
  else {
    ok("two zero-priced rows survived the load");
    for (const r of data) console.log(`        ${r.catalogue_plans?.name} / ${r.catalogue_addons?.name} = 0`);
  }
}

console.log("\nAlert Credits are per-credit and plan-scoped");
{
  const { data, error } = await db.from("catalogue_plan_addon_prices")
    .select("price, billing_period, catalogue_plans(name)").eq("addon_id", "addon_alert_credit").order("price", { ascending: false });
  if (error) bad("alert credit query", error.message);
  else {
    const want = { "Web Uptime": 2850, "Enterprise Plus Web": 1900 };
    for (const r of data) {
      const name = r.catalogue_plans?.name;
      Number(r.price) === want[name] && r.billing_period === "per_credit"
        ? ok(`${name.padEnd(20)}`, `${(Number(r.price) / 100).toFixed(2)} per credit`)
        : bad(`${name}`, `got ${r.price} / ${r.billing_period}`);
    }
  }
}

console.log("\nQuote-on-request tiers (must never be auto-totalled)");
{
  const { data, error } = await db.from("catalogue_plans")
    .select("name, price_monthly_annual_billed, quote_on_request, price_is_floor").eq("quote_on_request", true);
  if (error) bad("quote_on_request query", error.message);
  else {
    data.length === 2 ? ok("two quote-on-request plans") : bad("two quote-on-request plans", `got ${data.length}`);
    for (const p of data) {
      console.log(`        ${p.name.padEnd(16)} ${(Number(p.price_monthly_annual_billed) / 100).toFixed(2).padStart(10)}/mo  floor=${p.price_is_floor}`);
    }
  }
}

console.log(failures === 0 ? "\nAll catalogue checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
