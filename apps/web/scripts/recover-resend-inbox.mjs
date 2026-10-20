#!/usr/bin/env node
/**
 * Recovery script: Re-syncs inbound emails from Resend into Supabase and SessionStore.
 * Avoids re-dispatching duplicate outbound emails by temporarily pausing live dispatch.
 */

import { fetchInboundEmailContent } from "../src/server/email/resend-inbound.ts";
import { processInboundEmail } from "../src/server/email/inbound-processor.ts";
import { store } from "../src/server/store/session-store.ts";
import { getAppConfig } from "../src/server/config.ts";
import { getSupabaseClient, deleteProcessedMessageFromSupabase } from "../src/server/db/supabase.ts";

async function main() {
  await store.ensureInitializedAsync();
  const config = getAppConfig();
  const supabase = getSupabaseClient();

  if (!config.resendApiKey) {
    console.error("RESEND_API_KEY is not set.");
    process.exit(1);
  }

  console.log("Fetching inbound emails from Resend...");
  const res = await fetch("https://api.resend.com/emails/receiving", {
    headers: { Authorization: `Bearer ${config.resendApiKey}` },
  });

  if (!res.ok) {
    console.error(`Resend API returned status ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const list = await res.json();
  const items = list.data || [];
  console.log(`Found ${items.length} total inbound emails in Resend.`);

  // Filter for emails to quotes@quotes.joanathan.in or from test accounts
  const targetEmails = items
    .filter((item) => {
      const toStr = Array.isArray(item.to) ? item.to.join(",") : String(item.to || "");
      const fromStr = String(item.from || "").toLowerCase();
      // Only process quote requests or replies sent to quotes mailbox or user's email
      const isTarget =
        toStr.includes("quotes@quotes.joanathan.in") ||
        fromStr.includes("mrmousingh1@gmail.com") ||
        fromStr.includes("joanathanps2006@gmail.com") ||
        fromStr.includes("deepakram") ||
        fromStr.includes("kdeepakramk@gmail.com");

      // Exclude DMARC / bounce / automated reports
      const isDmarc = (item.subject || "").toLowerCase().includes("report domain:") || fromStr.includes("dmarc");
      return isTarget && !isDmarc;
    })
    // Sort chronological: oldest first so threads and replies build in order
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  console.log(`Identified ${targetEmails.length} relevant customer emails to sync.`);

  // Clean slate: purge partial or corrupted previous sync
  console.log("Purging previous email state for clean backfill...");
  await store.clearAll();

  // Pause outbound dispatch so we don't send duplicate emails to user
  store.setOutboundSendingPaused(true);

  try {
    for (const item of targetEmails) {
      console.log(`\nProcessing: ${item.id} | From: ${item.from} | Subject: "${item.subject}" | At: ${item.created_at}`);

      // Clear processed_messages claims so it can reprocess
      if (item.id) {
        await deleteProcessedMessageFromSupabase(item.id);
      }
      if (item.message_id) {
        await deleteProcessedMessageFromSupabase(item.message_id);
      }

      // Fetch full content
      const fetched = await fetchInboundEmailContent(item.id);
      if (!fetched) {
        console.warn(`  Failed to fetch content for ${item.id}, skipping.`);
        continue;
      }

      const result = await processInboundEmail({
        providerMessageId: fetched.id,
        messageId: fetched.messageId || null,
        from: fetched.from,
        fromName: fetched.fromName || null,
        to: fetched.to,
        subject: fetched.subject,
        text: fetched.text,
        html: fetched.html,
        headers: fetched.headers || null,
        receivedAt: fetched.receivedAt || item.created_at,
        attachments: fetched.attachments,
      });

      console.log(`  Result: action=${result.actionTaken}, threadId=${result.threadId}`);
    }

    await store.flushPendingWrites();
    console.log("\nAll pending database writes flushed.");

    if (supabase) {
      const { data: dbThreads } = await supabase.from("email_threads").select("id, sender_email, subject, status, created_at");
      const { data: dbMessages } = await supabase.from("email_messages").select("id, thread_id, from_address, subject");
      console.log(`\nSupabase email_threads count: ${dbThreads?.length || 0}`);
      console.log(JSON.stringify(dbThreads, null, 2));
      console.log(`Supabase email_messages count: ${dbMessages?.length || 0}`);
    }
  } finally {
    store.setOutboundSendingPaused(false);
  }
}

main().catch((err) => {
  console.error("Recovery failed:", err);
  process.exit(1);
});
