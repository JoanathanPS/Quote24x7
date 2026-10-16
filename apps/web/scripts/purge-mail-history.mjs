#!/usr/bin/env node
/**
 * Purges all email/quote history: threads, messages, requirement profiles,
 * quotes, deliveries, AI decisions and the idempotency log, from both Supabase
 * and the local file-backed stores.
 *
 * Catalogue tables are never touched.
 *
 * Reports counts, then deletes, then re-counts to prove the result.
 *
 *   node --env-file=.env.local scripts/purge-mail-history.mjs --dry-run
 *   node --env-file=.env.local scripts/purge-mail-history.mjs --confirm
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const dryRun = !args.includes("--confirm");

// Child tables first. Most cascade from email_threads, but deleting explicitly
// also clears any row orphaned by an earlier partial delete.
const TABLES = [
  "email_messages",
  "requirement_profiles",
  "quotes",
  "deliveries",
  "ai_decisions",
  "processed_messages",
  "email_threads",
];

const EMPTY_STORE = {
  threads: [],
  messages: [],
  profiles: [],
  quotes: [],
  deliveries: [],
  processedMessageIds: [],
  aiDecisions: [],
  outboundSendingPaused: false,
};

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const LOCAL_STORES = [
  { file: path.join(webRoot, ".data", "session-store.json"), shape: EMPTY_STORE },
  { file: path.join(webRoot, ".data", "dryrun-store.json"), shape: { threads: [], messages: [], profiles: [], quotes: [], deliveries: [] } },
  { file: path.join(webRoot, "src", "server", "fixtures", "baseline-store.json"), shape: EMPTY_STORE },
];

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  console.error("Run: node --env-file=.env.local scripts/purge-mail-history.mjs --confirm");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

async function counts() {
  const out = {};
  for (const table of TABLES) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
    out[table] = error ? `error: ${error.message}` : count;
  }
  return out;
}

function show(label, map) {
  console.log(`\n${label}`);
  let total = 0;
  for (const [table, count] of Object.entries(map)) {
    console.log(`  ${table.padEnd(22)} ${count}`);
    if (typeof count === "number") total += count;
  }
  console.log(`  ${"TOTAL".padEnd(22)} ${total}`);
  return total;
}

const before = await counts();
const totalBefore = show("Supabase rows before:", before);

console.log("\nLocal stores:");
for (const { file } of LOCAL_STORES) {
  if (!existsSync(file)) {
    console.log(`  ${path.relative(webRoot, file).padEnd(46)} (absent)`);
    continue;
  }
  let summary = "unreadable";
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const n = ["threads", "messages", "profiles", "quotes", "deliveries", "aiDecisions", "processedMessageIds"]
      .reduce((acc, k) => acc + (Array.isArray(parsed[k]) ? parsed[k].length : 0), 0);
    summary = `${n} record(s)`;
  } catch { /* leave as unreadable */ }
  console.log(`  ${path.relative(webRoot, file).padEnd(46)} ${summary}`);
}

if (dryRun) {
  console.log("\nDRY RUN — nothing deleted. Re-run with --confirm to purge.\n");
  process.exit(0);
}

console.log("\nPurging Supabase…");
for (const table of TABLES) {
  // PostgREST requires a filter on delete; this one matches every row.
  const { error } = await db.from(table).delete().not("id", "is", null);
  if (error && table === "processed_messages") {
    // No `id` column on this table: it is keyed by provider_message_id.
    const retry = await db.from(table).delete().not("provider_message_id", "is", null);
    console.log(`  ${table.padEnd(22)} ${retry.error ? `FAILED: ${retry.error.message}` : "cleared"}`);
  } else {
    console.log(`  ${table.padEnd(22)} ${error ? `FAILED: ${error.message}` : "cleared"}`);
  }
}

console.log("\nResetting local stores…");
for (const { file, shape } of LOCAL_STORES) {
  if (!existsSync(file)) {
    console.log(`  ${path.relative(webRoot, file).padEnd(46)} (absent, skipped)`);
    continue;
  }
  writeFileSync(file, JSON.stringify(shape, null, 2) + "\n", "utf8");
  console.log(`  ${path.relative(webRoot, file).padEnd(46)} reset to empty`);
}

const after = await counts();
const totalAfter = show("Supabase rows after:", after);

console.log(
  totalAfter === 0
    ? `\nPurge complete. ${totalBefore} row(s) removed; every mail table is empty.\n`
    : `\nWARNING: ${totalAfter} row(s) remain. Review the failures above.\n`,
);
process.exit(totalAfter === 0 ? 0 : 1);
