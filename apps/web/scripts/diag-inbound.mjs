/**
 * Diagnostic script — reads a Resend inbound payload JSON (as fetched by fetchInboundEmailContent)
 * and prints ONLY the header key names and values of Message-ID, In-Reply-To, References.
 * It never reads env values and prints no other headers.
 *
 * Usage:
 *   node diag-inbound.mjs --payload ./fixtures/resend_sample.json
 *   # or, without --payload, falls back to ./fixtures/resend_sample.json
 *
 * Output format (printed to stdout, nothing else):
 *   Message-ID: <value or "(not present)" >
 *   In-Reply-To: <value or "(not present)" >
 *   References: <value or "(not present)" >
 *
 * Then prints SQL to view message IDs and headers in Supabase.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

const ARGS = process.argv.slice(2);

// Determine payload file path
let payloadPath = ARGS.find((a, i) => a === "--payload" && ARGS[i + 1])
  ? ARGS[ARGS.indexOf("--payload") + 1]
  : null;

if (!payloadPath || !existsSync(payloadPath)) {
  // Default fallback fixture path relative to this script's directory
  const scriptDir = new URL(".", import.meta.url).pathname;
  payloadPath = path.join(scriptDir, "../fixtures/resend_sample.json").replace(/^\\.\./, "");
  if (!existsSync(payloadPath)) {
    console.error(`No payload file found at "${payloadPath}" and no default fixture exists.`);
    process.exit(1);
  }
}

// Read and parse JSON
let raw;
try {
  raw = await readFile(payloadPath, "utf-8");
} catch (e) {
  console.error(`Failed to read payload file: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(raw);
} catch (e) {
  console.error(`Invalid JSON in payload file: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

// The payload shape after fetchInboundEmailContent is a Record<string, any>;
// we only care about the top-level headers key.
const headers = payload.headers || {};

// Helper: find a header by its normalized key (case-insensitive)
function findHeader(headers, ...possibleKeys) {
  for (const key of Object.keys(headers)) {
    const kl = key.toLowerCase();
    for (const pk of possibleKeys) {
      if (kl === pk.toLowerCase()) return headers[key];
    }
  }
  return undefined;
}

// Extract RFC 2822 Message-ID value. The stored value may be
// a bare string "<msg_xxx@domain>" — that's what we want to display.
// If it's already wrapped, just output as-is.
function extractMessageId(value) {
  if (value === undefined) return "(not present)";
  // It may already be a Message-ID wrapped string like "<abc@def.com>"
  // or a bare id. We output whatever is stored.
  return String(value);
}

// Print ONLY the three header names and their exact stored values
// (nothing else — no body, no other headers, no env vars).
console.log("=== Header extraction (inbound payload JSON) ===");

// Message-ID
console.log(`Message-ID: ${extractMessageId(findHeader(headers, "message-id", "message_id"))}`);

// In-Reply-To
console.log(`In-Reply-To: ${extractMessageId(findHeader(headers, "in-reply-to", "In-Reply-To", "references"))}`);

// References (can be a string or array of strings)
const refsVal = findHeader(headers, "references", "References", "ref");
if (refsVal !== undefined) {
  const refsStr = Array.isArray(refsVal) ? refsVal.join(", ") : String(refsVal);
  console.log(`References: ${refsStr}`);
} else {
  console.log("References: (not present)");
}

// ----- SQL to view stored message IDs and headers in Supabase -----
// Run these queries once your migration 20261016160000_add_missing_columns.sql is pushed:
console.log("\n=== SQL to view stored message IDs & headers in Supabase ===");
console.log("-- last 10 email messages with headers");
console.log(`select id, occurred_at, direction, subject, provider_message_id, message_id_header, in_reply_to, references`);
console.log(`from public.email_messages`);
console.log(`order by occurred_at desc`);
console.log(`limit 10;`);

// Also show the threads that reference these messages
console.log(`\n-- last 5 threads with summary`);
console.log(`select id, provider_thread_id, subject, status, message_count, rounds_used, state, last_inbound_at, subject_canonical`);
console.log(`from public.email_threads`);
console.log(`order by last_inbound_at desc`);
console.log(`limit 5;`);

// If you need to see which aliases exist (for the new message_id_aliases table, see item 6):
console.log(`\n-- if message_id_aliases table exists`);
console.log(`select * from public.message_id_aliases limit 20;`);

// The column names below exist after migration 20261016160000_add_missing_columns.sql
// is pushed to your Supabase project:
console.log(`
\set VERBOSITY verbose
-- Verify the new columns are present:
select column_name from information_schema.columns
where table_name = 'email_messages'
order by ordinal_position;
`);