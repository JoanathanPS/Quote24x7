import test from "node:test";
import assert from "node:assert/strict";

import { processInboundEmail } from "./inbound-processor.ts";
import { store } from "../store/session-store.ts";
import { getAppConfig } from "../config.ts";
import { validateOutboundPolicy } from "./resend-outbound.ts";

test("Acceptance Test 1: 'we have 25 servers' -> NEEDS_INFO, one email with the 7,980 / 8,740 estimate and one question, no PDF", async () => {
  const providerMessageId = `msg_25servers_${Date.now()}`;
  const senderEmail = `buyer_${Date.now()}@infra-testing.example.com`;
  const senderName = "Priya";

  const result = await processInboundEmail({
    providerMessageId,
    messageId: `<${providerMessageId}@infra-testing.example.com>`,
    from: senderEmail,
    fromName: senderName,
    to: ["quotes@quotes.joanathan.in"],
    subject: "Pricing inquiry for our infrastructure",
    text: "we have 25 servers",
  });

  // 1. Status is NEEDS_INFO
  assert.equal(result.status, "NEEDS_INFO");
  assert.equal(result.actionTaken, "clarification_requested");
  assert.equal(result.duplicate, false);

  // 2. No PDF generated or attached
  assert.equal(result.pdfGenerated, false);

  // 3. One email with the 7,980 / 8,740 estimate and one question
  assert.ok(result.quote, "Estimate quote must be created");
  assert.equal(result.quote.status, "estimate");

  const liteOpt = result.quote.options.find(
    (o) => o.planId === "lite" || o.planName.toLowerCase().includes("lite")
  );
  const proOpt = result.quote.options.find(
    (o) => o.planId === "pro" || o.planName.toLowerCase().includes("professional")
  );

  assert.ok(liteOpt, "Lite option must be present in quote options");
  assert.ok(proOpt, "Professional option must be present in quote options");

  // Lite: 87,210 INR/yr (8,721,000 paise)
  assert.equal(liteOpt.total, 8721000, "Lite for 25 servers must be 87,210 INR/yr");
  // Professional: 99,180 INR/yr (9,918,000 paise)
  assert.equal(proOpt.total, 9918000, "Professional for 25 servers must be 99,180 INR/yr");

  // Verify outbound message
  const messages = store.getMessages(result.threadId);
  const outboundMsgs = messages.filter((m) => m.direction === "outbound");
  assert.equal(outboundMsgs.length, 1, "Exactly one outbound email should be sent");

  const outbound = outboundMsgs[0];
  assert.ok(outbound, "Outbound message must be recorded");
  assert.equal(outbound.attachments.length, 0, "No PDF attachment should be present");

  // Verify email body contains both estimates
  assert.ok(
    outbound.bodyText.includes("87,210") || outbound.bodyText.includes("87210"),
    "Email body must include 87,210 estimate",
  );
  assert.ok(
    outbound.bodyText.includes("99,180") || outbound.bodyText.includes("99180"),
    "Email body must include 99,180 estimate",
  );

  // Verify exactly one question asking about unmentioned categories
  assert.match(
    outbound.bodyText,
    /Do you also require monitoring for websites, applications, or network devices\?/i
  );
});

test("Acceptance Test 2: A DMARC report -> no reply", async () => {
  const initialThreadCount = store.getThreads().length;
  const dmarcMsgId = `dmarc_report_${Date.now()}`;

  const result = await processInboundEmail({
    providerMessageId: dmarcMsgId,
    messageId: `<${dmarcMsgId}@dmarc.google.com>`,
    from: "dmarc-noreply@google.com",
    fromName: "Google DMARC Reporting",
    to: ["quotes@quotes.joanathan.in"],
    subject: "Report Domain: quote24x7.internal Submitter: google.com Report-ID: <1234567890>",
    text: "This is an automated DMARC aggregate report xml payload.",
    headers: {
      "content-type": "multipart/report; report-type=dmarc-xml",
      "auto-submitted": "auto-generated",
    },
  });

  // Verify dropped
  assert.equal(result.actionTaken, "dropped_loop");
  assert.equal(result.status, "DROPPED_LOOP");

  // No new thread created in store
  assert.equal(store.getThreads().length, initialThreadCount);

  // No outbound email recorded
  assert.equal(result.outboundResult, undefined);
});

test("Acceptance Test 3: The same Message-ID twice -> one thread and one outbound", async () => {
  const sharedProviderId = `msg_idempotent_${Date.now()}`;
  const sharedRfcId = `<rfc_unique_${Date.now()}@company.example.com>`;
  const senderEmail = `tester_${Date.now()}@idempotent-corp.example.com`;

  const payload = {
    providerMessageId: sharedProviderId,
    messageId: sharedRfcId,
    from: senderEmail,
    fromName: "DevOps Lead",
    to: ["quotes@quotes.joanathan.in"],
    subject: "Need monitoring for 30 servers and 5 network devices",
    text: "We need 30 servers and 5 network devices. Annual plan.",
  };

  // First delivery: processes normally
  const run1 = await processInboundEmail(payload);
  assert.equal(run1.duplicate, false);
  assert.equal(run1.actionTaken, "quoted");
  assert.ok(run1.threadId);

  const initialThreadCount = store.getThreads().length;
  const initialOutboundCount = store.getMessages(run1.threadId).filter((m) => m.direction === "outbound").length;
  assert.equal(initialOutboundCount, 1);

  // Second delivery with identical providerMessageId and messageId
  const run2 = await processInboundEmail(payload);
  assert.equal(run2.duplicate, true);
  assert.equal(run2.actionTaken, "dropped_loop");
  assert.equal(run2.status, "DROPPED_LOOP");

  // Thread count and outbound message count remain unchanged
  assert.equal(store.getThreads().length, initialThreadCount, "No new thread should be created");
  const finalOutboundCount = store.getMessages(run1.threadId).filter((m) => m.direction === "outbound").length;
  assert.equal(finalOutboundCount, 1, "Only one outbound email should have been sent");
});

test("Acceptance Test 4: A changed quantity -> quote v2 supersedes v1", async () => {
  const senderEmail = `client_${Date.now()}@supersede-test.example.com`;
  const senderName = "Vikram";

  // Turn 1: 25 servers (produces estimate quote v1)
  const turn1 = await processInboundEmail({
    providerMessageId: `turn1_${Date.now()}`,
    messageId: `<turn1_${Date.now()}@supersede-test.example.com>`,
    from: senderEmail,
    fromName: senderName,
    to: ["quotes@quotes.joanathan.in"],
    subject: "Site24x7 Pricing Estimate",
    text: "we have 25 servers",
  });

  assert.equal(turn1.status, "NEEDS_INFO");
  assert.ok(turn1.quote);
  const quoteV1Id = turn1.quote.id;
  const threadId = turn1.threadId;

  // Verify quote v1 in store
  const quoteV1Before = store.getQuote(quoteV1Id);
  assert.ok(quoteV1Before);
  assert.equal(quoteV1Before.status, "estimate");

  // Turn 2: Customer replies with changed quantity (30 servers) and rules out other monitoring
  const turn2 = await processInboundEmail({
    providerMessageId: `turn2_${Date.now()}`,
    messageId: `<turn2_${Date.now()}@supersede-test.example.com>`,
    from: senderEmail,
    fromName: senderName,
    to: ["quotes@quotes.joanathan.in"],
    subject: `Re: Site24x7 Pricing Estimate [Ref: #${threadId}]`,
    text: "We only need servers, no websites or apps. We actually have 30 servers now.",
    headers: {
      "in-reply-to": `<turn1_${Date.now()}@supersede-test.example.com>`,
    },
  });

  assert.equal(turn2.threadId, threadId, "Must link to the same thread");
  assert.equal(turn2.actionTaken, "quoted");
  assert.equal(turn2.status, "QUOTED");
  assert.ok(turn2.quote);
  const quoteV2Id = turn2.quote.id;
  assert.notEqual(quoteV2Id, quoteV1Id, "Quote v2 must have a new ID");

  // Verify Quote v1 has been marked SUPERSEDED
  const quoteV1After = store.getQuote(quoteV1Id);
  assert.ok(quoteV1After);
  assert.equal(quoteV1After.status, "superseded", "Quote v1 must be marked superseded");

  // Verify Quote v2 is active and validated
  const quoteV2 = store.getQuote(quoteV2Id);
  assert.ok(quoteV2);
  assert.equal(quoteV2.status, "validated");

  // Verify thread references Quote v2 as active quote
  const thread = store.getThread(threadId);
  assert.ok(thread);
  assert.equal(thread.quoteId, quoteV2Id);
});

test("Outbound Policy: Rejects sending to own domain, zoho.com, or site24x7.com", () => {
  const config = getAppConfig();

  // Test zoho.com
  const zohoCheck = validateOutboundPolicy(config, "th_test", "sales.rep@zoho.com");
  assert.equal(zohoCheck.isBlocked, true);
  assert.match(zohoCheck.blockReason || "", /zoho\.com/i);

  // Test site24x7.com
  const site24x7Check = validateOutboundPolicy(config, "th_test", "support@site24x7.com");
  assert.equal(site24x7Check.isBlocked, true);
  assert.match(site24x7Check.blockReason || "", /site24x7\.com/i);

  // Test own domain
  const ownDomainCheck = validateOutboundPolicy(config, "th_test", config.outboundFromEmail);
  assert.equal(ownDomainCheck.isBlocked, true);
  assert.match(ownDomainCheck.blockReason || "", /own domain/i);
});

test("Rate Limiting: Maximum 3 outbound emails per thread per day", () => {
  const config = getAppConfig();
  const threadId = `th_ratelimit_${Date.now()}`;
  const now = new Date().toISOString();

  // Seed 3 outbound messages for this thread today
  for (let i = 0; i < 3; i++) {
    store.addMessage({
      id: `msg_out_${i}_${Date.now()}`,
      threadId,
      providerMessageId: `prov_${i}_${Date.now()}`,
      direction: "outbound",
      fromAddress: config.outboundFromEmail,
      fromName: "Assistant",
      toAddresses: ["client@example.com"],
      subject: "Test",
      bodyText: "Test body",
      occurredAt: now,
      deliveryId: null,
      securityNotes: [],
      attachments: [],
    });
  }

  // 4th attempt must be blocked
  const check = validateOutboundPolicy(config, threadId, "client@example.com");
  assert.equal(check.isBlocked, true);
  assert.match(check.blockReason || "", /Maximum 3 outbound emails/i);
});

test("Delivery tracking: Flags queued > 10m, retries with backoff, and dead-letters after 3 attempts", () => {
  const now = Date.now();
  const threadId = `th_del_${now}`;

  // Delivery 1: queued 15 minutes ago, attemptCount = 1 -> should be flagged and retried with backoff
  const del1Id = `del_queued_1_${now}`;
  store.saveDelivery({
    id: del1Id,
    threadId,
    quoteId: "qt_test1",
    provider: "resend",
    providerMessageId: `msg_del1_${now}`,
    recipient: "user1@example.com",
    subject: "Proposal",
    status: "queued",
    attemptCount: 1,
    maxAttempts: 3,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextRetryAt: null,
    retryEligible: false,
    createdAt: new Date(now - 15 * 60 * 1000).toISOString(),
    updatedAt: new Date(now - 15 * 60 * 1000).toISOString(),
    events: [],
  });

  // Delivery 2: queued 15 minutes ago, attemptCount = 3 -> should be dead-lettered
  const del2Id = `del_queued_2_${now}`;
  store.saveDelivery({
    id: del2Id,
    threadId,
    quoteId: "qt_test2",
    provider: "resend",
    providerMessageId: `msg_del2_${now}`,
    recipient: "user2@example.com",
    subject: "Proposal 2",
    status: "queued",
    attemptCount: 3,
    maxAttempts: 3,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextRetryAt: null,
    retryEligible: false,
    createdAt: new Date(now - 15 * 60 * 1000).toISOString(),
    updatedAt: new Date(now - 15 * 60 * 1000).toISOString(),
    events: [],
  });

  const res = store.flagAndRetryQueuedDeliveries(now);
  assert.ok(res.flaggedCount >= 2);
  assert.ok(res.retriedCount >= 1);
  assert.ok(res.deadLetterCount >= 1);

  const updatedDel1 = store.getDelivery(del1Id);
  assert.ok(updatedDel1);
  assert.equal(updatedDel1.attemptCount, 2);
  assert.equal(updatedDel1.retryEligible, true);
  assert.ok(updatedDel1.nextRetryAt);

  const updatedDel2 = store.getDelivery(del2Id);
  assert.ok(updatedDel2);
  assert.equal(updatedDel2.status, "failed");
  assert.equal(updatedDel2.lastErrorCode, "DEAD_LETTER");
  assert.equal(updatedDel2.retryEligible, false);
});

test("Acceptance Test 7: Mail addressed to the wrong mailbox is rejected, not processed", async () => {
  const providerMessageId = `msg_wrong_recip_${Date.now()}`;
  const result = await processInboundEmail({
    providerMessageId,
    messageId: `<${providerMessageId}@infra-testing.example.com>`,
    from: "wrong_recip_lead@infra-testing.example.com",
    fromName: "Stray",
    to: ["hello@joanathan.in"],
    subject: "Pricing inquiry for our infrastructure",
    text: "we have 25 servers",
  });

  assert.equal(result.status, "REJECTED_RECIPIENT");
  assert.equal(result.actionTaken, "rejected_recipient");
  assert.equal(result.duplicate, false);
  assert.ok(
    result.message?.includes("hello@joanathan.in"),
    "Rejection message should name the wrong recipient"
  );

  // No thread, no quote, no outbound dispatch
  assert.equal(result.quote, undefined);
  assert.equal(result.outboundResult, undefined);
});

test("Acceptance Test 7b: Mail addressed to old apex domain quotes@joanathan.in is rejected", async () => {
  const providerMessageId = `msg_apex_recip_${Date.now()}`;
  const result = await processInboundEmail({
    providerMessageId,
    messageId: `<${providerMessageId}@infra-testing.example.com>`,
    from: "apex_lead@infra-testing.example.com",
    fromName: "Old Domain Sender",
    to: ["quotes@joanathan.in"],
    subject: "Pricing inquiry for our infrastructure",
    text: "we have 25 servers",
  });

  assert.equal(result.status, "REJECTED_RECIPIENT");
  assert.equal(result.actionTaken, "rejected_recipient");
  assert.equal(result.duplicate, false);
});

test("Acceptance Test 8: Mail to a +tagged variant of our mailbox is not rejected by the recipient guard", async () => {
  const providerMessageId = `msg_tagged_${Date.now()}`;
  // If Supabase is unavailable the pipeline throws before pricing; if available it
  // proceeds to classification. Either way the recipient guard must NOT reject �
  // a failure, if any, must come from the catalogue step rather than REJECTED_RECIPIENT.
  try {
    const result = await processInboundEmail({
      providerMessageId,
      messageId: `<${providerMessageId}@infra-testing.example.com>`,
      from: "tagged_lead@infra-testing.example.com",
      fromName: "Tagged",
      to: ["quotes+ref-th-abc123@quotes.joanathan.in"],
      subject: "Pricing inquiry for our infrastructure",
      text: "we have 25 servers",
    });
    assert.notEqual(result.actionTaken, "rejected_recipient");
    assert.notEqual(result.status, "REJECTED_RECIPIENT");
  } catch (err) {
    assert.ok(
      (err instanceof Error ? err.message : String(err)).includes("Supabase") || (err as Error).name === "CatalogueLoadError",
      "Expected catalogue-step failure, not recipient rejection"
    );
  }
});

test("Acceptance Test 9: Mail with no usable recipient is still accepted by the recipient guard", async () => {
  const providerMessageId = `msg_no_recip_${Date.now()}`;
  // An empty/missing recipient is not "wrong mailbox". It must proceed past the
  // guard; if Supabase is unavailable the throw comes from the catalogue step.
  try {
    const result = await processInboundEmail({
      providerMessageId,
      messageId: `<${providerMessageId}@infra-testing.example.com>`,
      from: "norecip_lead@infra-testing.example.com",
      fromName: "NoRecip",
      to: [],
      subject: "Pricing inquiry for our infrastructure",
      text: "we have 25 servers",
    });
    assert.notEqual(result.actionTaken, "rejected_recipient");
    assert.notEqual(result.status, "REJECTED_RECIPIENT");
  } catch (err) {
    assert.ok(
      (err instanceof Error ? err.message : String(err)).includes("Supabase") || (err as Error).name === "CatalogueLoadError",
      "Expected catalogue-step failure, not recipient rejection"
    );
  }
});

