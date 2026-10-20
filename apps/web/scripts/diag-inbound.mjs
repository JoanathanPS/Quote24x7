/**
 * Diagnostic for inbound email headers — read-only.
 *
 * Prints ONLY the header key names and the values of Message-ID, In-Reply-To,
 * and References, then prints SQL the user can run in Supabase to inspect the
 * stored rows and aliases. Never reads env values, never prints other headers,
 * writes nothing.
 *
 * Usage:
 *   # Live mode — pulls a real Resend inbound id
 *   npm run diag:inbound -- <resend_email_id>
 *   # Fixture mode (offline) — pass --payload <path>
 *   npm run diag:inbound -- --payload ./fixtures/resend_sample.json
 *
 * Output:
 *   Header key names that are allowed for this diagnostic (one per line).
 *   Message-ID:  <value or "(none)">
 *   In-Reply-To: <value or "(none)">
 *   References:  <value or "(none)">
 *   normalized Message-ID, then all RFC 2822 tokens deduped.
 *   SQL blocks that list stored inbound rows and aliases.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fetchInboundEmailContent } from "../src/server/email/resend-inbound.ts";
import { extractMessageIds, normalizeRfcMessageId } from "../src/server/email/rfc-message-id.ts";

// Header keys we are allowed to read or display. Anything else is filtered.
const PRINTABLE_HEADER_KEYS = [
  "message-id",
  "in-reply-to",
  "references",
  "from",
  "to",
  "subject",
  "date",
];

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

async function loadFixtureHeaders(payloadPath) {
  const raw = await readFile(payloadPath, "utf-8");
  const payload = JSON.parse(raw);
  const headers = payload.headers ?? {};
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [String(k).trim().toLowerCase(), v])
  );
}

async function loadLiveHeaders(emailId) {
  const fetched = await fetchInboundEmailContent(emailId);
  if (!fetched) {
    throw new Error(`No inbound fetched for id: ${emailId}`);
  }
  const headers = fetched.headers ?? {};
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [String(k).trim().toLowerCase(), v])
  );
}

async function main() {
  const ARGS = process.argv.slice(2);
  let mode = "live";
  let arg = "";

  if (ARGS[0] === "--payload") {
    mode = "fixture";
    arg = ARGS[1] ?? "";
    if (!arg || !existsSync(arg)) {
      console.error("Usage: npm run diag:inbound -- --payload <path-to-resend-payload.json>");
      process.exit(2);
    }
  } else {
    arg = String(ARGS[0] ?? "").trim();
    if (!arg) {
      console.error("Usage: npm run diag:inbound -- <resend_email_id>");
      console.error("   or: npm run diag:inbound -- --payload <path>");
      process.exit(2);
    }
  }

  const headers = mode === "fixture"
    ? await loadFixtureHeaders(arg)
    : await loadLiveHeaders(arg);

  console.log("[diag:inbound] header keys seen (allowed only):");
  for (const key of PRINTABLE_HEADER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(headers, key)) {
      console.log(`  ${key}`);
    }
  }

  const messageIdRaw = headers["message-id"] ?? "";
  const inReplyToRaw = headers["in-reply-to"] ?? "";
  const referencesRaw = headers["references"] ?? "";

  console.log("");
  console.log(`[diag:inbound] Message-ID:  ${messageIdRaw || "(none)"}`);
  console.log(`[diag:inbound] In-Reply-To: ${inReplyToRaw || "(none)"}`);
  console.log(`[diag:inbound] References:  ${referencesRaw || "(none)"}`);

  const normalizedMessageId = normalizeRfcMessageId(messageIdRaw);
  const tokens = [
    ...extractMessageIds(messageIdRaw),
    ...extractMessageIds(inReplyToRaw),
    ...extractMessageIds(referencesRaw),
  ];

  console.log("");
  console.log(`[diag:inbound] normalized Message-ID: ${normalizedMessageId ?? "(none)"}`);
  console.log(`[diag:inbound] chain tokens (deduped, ordered):`);
  if (tokens.length === 0) {
    console.log("  (none)");
  } else {
    const seen = new Set();
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      console.log(`  ${t}`);
    }
  }

  // SQL the user can paste into Supabase to inspect the stored message ids
  // and inbound headers for the latest thread, plus any aliases.
  const tokenList = Array.from(
    new Set([normalizedMessageId, ...tokens].filter(Boolean))
  );
  const idLiterals = tokenList.length > 0
    ? tokenList.map((t) => `'${escapeSqlString(t)}'`).join(", ")
    : "''";

  console.log("");
  console.log("[diag:inbound] Run this SQL in Supabase to inspect stored state:");
  console.log("");
  console.log("  -- last 10 inbound messages with their headers + match method");
  console.log("  select id, thread_id, occurred_at, direction,");
  console.log("         thread_match_method,");
  console.log("         message_id_header, in_reply_to, references");
  console.log("    from public.email_messages");
  console.log("   where direction = 'inbound'");
  console.log("   order by occurred_at desc nulls last");
  console.log("   limit 10;");
  console.log("");
  console.log("  -- aliases recorded for the message-ids we just observed");
  console.log("  select alias_message_id, canonical_message_id, thread_id,");
  console.log("         source, registered_at, last_seen_at, seen_count");
  console.log("    from public.message_id_aliases");
  console.log(`   where alias_message_id in (${idLiterals})`);
  console.log("   order by registered_at desc;");
  console.log("");
}

main().catch((err) => {
  console.error(`[diag:inbound] failed:`, err);
  process.exit(1);
});
