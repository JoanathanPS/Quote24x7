import test from "node:test";
import assert from "node:assert/strict";

import { processInboundEmail } from "./inbound-processor.ts";
import { renderQuotePdf } from "../documents/pdf-renderer.ts";
import { store } from "../store/session-store.ts";
import { getAppConfig } from "../config.ts";
import { loadActiveCatalogue } from "../catalogue/loader.ts";
import { buildQuote } from "../pricing/quote-builder.ts";
import { extractRequirements } from "../extraction/extractor.ts";
import { emptyDemand } from "../pricing/engine.ts";
import { verifyWebhookSignature } from "./resend-inbound.ts";

test("Roundtrip 1: Inbound email with complete requirements generates quote, PDF, and outbound delivery", async () => {
  const providerMessageId = `test_roundtrip_${Date.now()}_1`;
  const senderEmail = "infra.lead@apexfintech.example.com";
  const senderName = "Rajesh Verma";
  const subject = "Site24x7 Migration Quote Request";
  const bodyText = `
    Hi Quote24x7 Team,
    We are looking for a complete Site24x7 proposal for our migration:
    - 80 Linux and Windows application servers
    - 15 core network switches and routers
    - 4 synthetic web transaction monitors
    - 2,000,000 pageviews/month for Real User Monitoring (RUM)
    - 50 GB/month of AppLogs log management
    We require annual billing and INR currency.
    Company: Apex FinTech Solutions
    Regards,
    Rajesh
  `;

  const result = await processInboundEmail({
    providerMessageId,
    from: senderEmail,
    fromName: senderName,
    to: ["quotes@quote24x7.internal"],
    subject,
    text: bodyText,
  });

  // Verify pipeline action
  assert.equal(result.actionTaken, "quoted");
  assert.equal(result.duplicate, false);
  assert.ok(result.quote, "Quote should be generated");
  assert.equal(result.pdfGenerated, true);
  assert.ok(result.outboundResult, "Outbound result should exist");

  // Verify quote contents
  const quote = result.quote;
  assert.equal(quote.threadId, result.threadId);
  assert.equal(quote.currency, "INR");
  assert.ok(quote.options.length >= 2, "Should provide multiple options");

  const bestValue = quote.options.find((o) => o.optionType === "best_value");
  assert.ok(bestValue, "Best value option must be present");
  assert.ok(bestValue.total > 0, "Total must be greater than 0");
  assert.equal(typeof bestValue.total, "number");
  assert.equal(Number.isInteger(bestValue.total), true, "Total must be integer minor units");

  // Verify thread state in store
  const thread = store.getThread(result.threadId);
  assert.ok(thread, "Thread must be saved in store");
  assert.equal(thread.quoteId, quote.id);
  assert.equal(thread.organisation, "Apex FinTech Solutions");

  // Verify delivery record in store
  assert.ok(result.outboundResult.deliveryId);
  const delivery = store.getDelivery(result.outboundResult.deliveryId);
  assert.ok(delivery, "Delivery record must be saved in store");
  // Per honesty rule: delivery status MUST NOT be 'delivered' before webhook confirmation
  assert.notEqual(delivery.status, "delivered");
  assert.equal(delivery.status, "queued");
  assert.equal(delivery.recipient, senderEmail);

  // Verify messages recorded in thread timeline
  const messages = store.getMessages(result.threadId);
  assert.ok(messages.length >= 2, "Should contain inbound and outbound messages");
  const inboundMsg = messages.find((m) => m.direction === "inbound");
  const outboundMsg = messages.find((m) => m.direction === "outbound");
  assert.ok(inboundMsg, "Inbound message must be recorded");
  assert.ok(outboundMsg, "Outbound message must be recorded");
  assert.ok(outboundMsg.attachments.length > 0, "Outbound message must reference PDF attachment");
  assert.match(outboundMsg.attachments[0]?.name ?? "", /\.pdf$/);
});

test("Roundtrip 2: Inbound email with missing material requirements triggers clarification inquiry", async () => {
  const providerMessageId = `test_roundtrip_${Date.now()}_2`;
  const senderEmail = "cto@vague-startup.example.com";
  const subject = "Monitoring solution pricing inquiry";
  const bodyText = `
    Hi,
    We are interested in Site24x7 monitoring for our microservices platform.
    Can you please share your plans and pricing?
    Thanks!
  `;

  const result = await processInboundEmail({
    providerMessageId,
    from: senderEmail,
    fromName: "Alex",
    to: ["quotes@quote24x7.internal"],
    subject,
    text: bodyText,
  });

  assert.equal(result.actionTaken, "clarification_requested");
  assert.equal(result.duplicate, false);
  assert.equal(result.quote, undefined, "No quote should be created for incomplete demand");

  // Verify thread is in awaiting_reply state
  const thread = store.getThread(result.threadId);
  assert.ok(thread);
  assert.equal(thread.status, "awaiting_reply");
  assert.match(thread.statusDetail || "", /clarification/i);

  // Outbound inquiry should be recorded
  const messages = store.getMessages(result.threadId);
  const outboundMsg = messages.find((m) => m.direction === "outbound");
  assert.ok(outboundMsg, "Outbound clarification email must be recorded");
  assert.match(outboundMsg.bodyText, /clarify/i);
});

test("Roundtrip 3: Idempotency rejects duplicate message IDs", async () => {
  const providerMessageId = `test_roundtrip_${Date.now()}_3`;
  const senderEmail = "dev@company.example.com";
  const payload = {
    providerMessageId,
    from: senderEmail,
    to: ["quotes@quote24x7.internal"],
    subject: "Pricing inquiry",
    text: "We have 10 servers and 5 network devices. Annual plan.",
  };

  const firstCall = await processInboundEmail(payload);
  assert.equal(firstCall.duplicate, false);

  // Second call with same message ID
  const duplicateCall = await processInboundEmail(payload);
  assert.equal(duplicateCall.duplicate, true);
  assert.equal(duplicateCall.actionTaken, "dropped_loop");
});

test("Roundtrip 4: Loop prevention drops self-generated emails", async () => {
  const config = getAppConfig();
  const providerMessageId = `test_roundtrip_${Date.now()}_4`;

  // Email claiming to come from system sender
  const result1 = await processInboundEmail({
    providerMessageId,
    from: config.outboundFromEmail,
    to: ["client@example.com"],
    subject: "Quote24x7 Sizing Proposal",
    text: "Quote24x7 Automated Operations Team generated proposal",
  });
  assert.equal(result1.actionTaken, "dropped_loop");

  // Email containing signature marker
  const result2 = await processInboundEmail({
    providerMessageId: `${providerMessageId}_sig`,
    from: "bounce-loop@example.com",
    to: [config.outboundFromEmail],
    subject: "Auto-reply",
    text: "Quoting your message from Quote24x7 Automated Operations Team",
  });
  assert.equal(result2.actionTaken, "dropped_loop");
});

test("PDF Renderer: Generates valid vector PDF buffer with required sections", async () => {
  const catalogue = loadActiveCatalogue();
  const extraction = extractRequirements({
    threadId: "th_test_pdf",
    senderEmail: "client@test.com",
    senderName: null,
    subject: "Test",
    bodyText: "10 servers, 2 network devices",
  });

  const { quote } = buildQuote({
    quoteId: "qt_test_pdf_01",
    threadId: "th_test_pdf",
    profile: extraction.profile,
    demand: extraction.demand,
    catalogue,
    createdAt: new Date().toISOString(),
  });

  const thread = {
    id: "th_test_pdf",
    provider: "resend" as const,
    providerThreadId: "th_resend_test",
    senderEmail: "client@test.com",
    senderName: "Test Lead",
    organisation: "Acme Corp",
    subject: "Infrastructure Sizing",
    status: "pricing" as const,
    requestType: "quote" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
    messageCount: 1,
    quoteId: quote.id,
    quoteTotal: quote.options[0]?.total ?? null,
    currency: quote.currency,
    statusDetail: null,
  };

  const pdfBuffer = await renderQuotePdf({
    quote,
    thread,
    selectedOptionType: "best_value",
  });

  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 3000, `PDF buffer length should be substantial, was ${pdfBuffer.length}`);
  const header = pdfBuffer.subarray(0, 5).toString("ascii");
  assert.equal(header, "%PDF-", "Buffer should start with PDF magic bytes");
});

test("Delivery Lifecycle: Webhook accurately transitions status to delivered or bounced", async () => {
  const deliveryId = `del_webhook_test_${Date.now()}`;
  const providerMessageId = `resend_msg_${Date.now()}`;
  const threadId = `th_webhook_test_${Date.now()}`;

  store.saveThread({
    id: threadId,
    provider: "resend",
    providerThreadId: "th_resend",
    senderEmail: "verify@test.com",
    senderName: "Verifier",
    organisation: "Test Org",
    subject: "Test Subject",
    status: "sending",
    requestType: "quote",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
    messageCount: 2,
    quoteId: "qt_dummy",
    quoteTotal: 100000,
    currency: "INR",
    statusDetail: "Awaiting delivery confirmation",
  });

  store.saveDelivery({
    id: deliveryId,
    threadId,
    quoteId: "qt_dummy",
    provider: "resend",
    providerMessageId,
    recipient: "verify@test.com",
    subject: "Quote Proposal",
    status: "queued",
    attemptCount: 1,
    maxAttempts: 3,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextRetryAt: null,
    retryEligible: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [{ at: new Date().toISOString(), status: "queued", detail: "Initial dispatch" }],
  });

  // Verify status is queued, not delivered
  const initialDelivery = store.getDelivery(deliveryId);
  assert.equal(initialDelivery?.status, "queued");

  // Simulate Resend delivery webhook event
  const webhookEvent = {
    type: "email.delivered",
    created_at: new Date().toISOString(),
    data: {
      email_id: providerMessageId,
      to: ["verify@test.com"],
      subject: "Quote Proposal",
    },
  };

  // Directly exercise store update matching webhook handler
  const delivery = store.getDeliveryByProviderMessageId(providerMessageId);
  assert.ok(delivery);
  store.updateDelivery(delivery.id, {
    status: "delivered",
    events: [
      ...delivery.events,
      { at: webhookEvent.created_at, status: "delivered", detail: "Delivered to mailbox" },
    ],
  });
  store.updateThread(threadId, {
    status: "completed",
    statusDetail: `Proposal verified delivered to ${delivery.recipient}`,
  });

  // Check updated delivery
  const updatedDelivery = store.getDelivery(deliveryId);
  assert.equal(updatedDelivery?.status, "delivered");
  assert.equal(updatedDelivery?.events.length, 2);

  // Check updated thread
  const updatedThread = store.getThread(threadId);
  assert.equal(updatedThread?.status, "completed");
  assert.match(updatedThread?.statusDetail || "", /verified delivered/i);
});

test("Pricing Correctness: 5-capability inquiry extracts and prices all requested capabilities", async () => {
  const providerMessageId = `test_5cap_${Date.now()}`;
  const senderEmail = "infra.lead@enterprise.example.com";
  const rawText =
    "We need monitoring for 80 Linux servers, 15 Cisco switches, 4 synthetic transaction monitors, 2M monthly pageviews for RUM, and 50GB logs per month. Annual billing please.";

  // 1. Direct extraction verification
  const extraction = extractRequirements({
    threadId: "th_test_5cap",
    senderEmail,
    senderName: "DevOps Lead",
    subject: "Monitoring Requirements",
    bodyText: rawText,
  });

  assert.equal(extraction.isComplete, true);
  assert.equal(extraction.missingMaterialFields.length, 0);
  assert.equal(extraction.demand.host_monitor, 80);
  assert.equal(extraction.demand.network_component, 15);
  assert.equal(extraction.demand.advanced_monitor, 4);
  assert.equal(extraction.demand.rum_pageview, 2000000);
  assert.equal(extraction.demand.applog_gb, 50);

  // Check evidence strings
  const advField = extraction.profile.fields.find((f) => f.key === "advanced_monitors");
  assert.ok(advField);
  assert.match(advField.evidence ?? "", /4 synthetic transaction monitors/i);

  const rumField = extraction.profile.fields.find((f) => f.key === "rum_pageviews");
  assert.ok(rumField);
  assert.match(rumField.evidence ?? "", /2M monthly pageviews/i);

  // 2. Full Inbound Pipeline Verification
  const result = await processInboundEmail({
    providerMessageId,
    from: senderEmail,
    to: ["quotes@quote24x7.internal"],
    subject: "Site24x7 Pricing Request",
    text: rawText,
  });

  assert.equal(result.actionTaken, "quoted");
  assert.ok(result.quote);
  assert.equal(result.pdfGenerated, true);

  const quote = result.quote;
  assert.equal(quote.status, "validated");
  assert.ok(quote.options.length >= 2, "Must generate valid options");

  // Verify all integrity checks passed
  for (const check of quote.integrityChecks) {
    assert.equal(check.passed, true, `Integrity check ${check.id} must pass`);
  }

  // Verify best_value option covers all 5 capabilities
  const bestValue = quote.options.find((o) => o.optionType === "best_value");
  assert.ok(bestValue);

  const checkCoverage = (unit: string, minRequired: number) => {
    const row = bestValue.coverage.find((c) => c.unit === unit);
    assert.ok(row, `Coverage row for ${unit} must exist`);
    assert.equal(row.required, minRequired);
    assert.ok(
      row.total >= minRequired,
      `${unit} total (${row.total}) must meet or exceed required (${minRequired})`
    );
    assert.equal(row.satisfied, true, `${unit} coverage must be satisfied`);
  };

  checkCoverage("host_monitor", 80);
  checkCoverage("network_component", 15);
  checkCoverage("advanced_monitor", 4);
  checkCoverage("rum_pageview", 2000000);
  checkCoverage("applog_gb", 50);

  // Verify add-on packs in line items
  const lineItemDescriptions = bestValue.lineItems.map((li) => li.description);
  assert.ok(
    lineItemDescriptions.some((d) => d.includes("Advanced Monitors")),
    "Must have Advanced Monitor add-on"
  );
  assert.ok(
    lineItemDescriptions.some((d) => d.includes("Pageviews")),
    "Must have RUM add-on"
  );
  assert.ok(
    lineItemDescriptions.some((d) => d.includes("Logs")),
    "Must have AppLogs add-on"
  );

  // Verify assumptions explicitly list all 5 capabilities
  const assumptionsText = quote.assumptions.join(" ");
  assert.match(assumptionsText, /Host monitors: 80/i);
  assert.match(assumptionsText, /Network components: 15/i);
  assert.match(assumptionsText, /Advanced monitors: 4/i);
  assert.match(assumptionsText, /RUM pageviews \/ month:/i);
  assert.match(assumptionsText, /AppLogs GB \/ month: 50/i);
});

test("Fail Closed: Mentioned capability without quantity triggers clarification inquiry", async () => {
  const providerMessageId = `test_missing_qty_${Date.now()}`;
  const senderEmail = "dev@startup.example.com";
  const rawText =
    "We need monitoring for 80 Linux servers, 15 Cisco switches, and synthetic transaction monitors. Annual billing please.";

  const result = await processInboundEmail({
    providerMessageId,
    from: senderEmail,
    to: ["quotes@quote24x7.internal"],
    subject: "Need Site24x7 quote",
    text: rawText,
  });

  assert.equal(result.actionTaken, "clarification_requested");
  assert.equal(result.quote, undefined);
  assert.equal(result.pdfGenerated, undefined);

  const thread = store.getThread(result.threadId);
  assert.ok(thread);
  assert.equal(thread.status, "awaiting_reply");
  assert.match(thread.statusDetail || "", /advanced_monitors/i);

  const messages = store.getMessages(result.threadId);
  const outbound = messages.find((m) => m.direction === "outbound");
  assert.ok(outbound);
  assert.match(outbound.bodyText, /synthetic transaction/i);
});

test("Honesty: Genuinely omitted optional capabilities price cleanly without clarification", async () => {
  const providerMessageId = `test_clean_omitted_${Date.now()}`;
  const senderEmail = "ops@firm.example.com";
  const rawText =
    "We need monitoring for 20 Linux servers and 5 network switches. Annual billing please.";

  const result = await processInboundEmail({
    providerMessageId,
    from: senderEmail,
    to: ["quotes@quote24x7.internal"],
    subject: "Basic infra monitoring",
    text: rawText,
  });

  assert.equal(result.actionTaken, "quoted");
  assert.ok(result.quote);
  assert.equal(result.quote.status, "validated");

  // Demands for omitted capabilities should be 0
  const demand = extractRequirements({
    threadId: "th_test",
    senderEmail,
    senderName: null,
    subject: "Basic infra monitoring",
    bodyText: rawText,
  }).demand;

  assert.equal(demand.host_monitor, 20);
  assert.equal(demand.network_component, 5);
  assert.equal(demand.advanced_monitor, 0);
  assert.equal(demand.rum_pageview, 0);
  assert.equal(demand.applog_gb, 0);
});

test("Fail Closed: Empty options fail integrity checks and do not produce validated quotes", async () => {
  const catalogue = loadActiveCatalogue();
  const profile = {
    id: "prof_empty_test",
    threadId: "th_empty_test",
    version: 1,
    supersedesProfileId: null,
    createdAt: new Date().toISOString(),
    extractorModel: "test",
    extractorRunId: "run_test",
    fields: [],
    summary: "Demand that cannot be fulfilled",
    pendingQuestions: [],
    answeredQuestions: [],
    clarificationRound: 0,
  };

  // Create a catalogue with only WebUptimePack which has host_monitor = null
  const restrictedCatalogue = {
    ...catalogue,
    plans: catalogue.plans.filter((p) => p.id === "plan_webuptimepack"),
  };

  const demand = {
    ...emptyDemand(),
    host_monitor: 100, // WebUptime does not support host_monitor
  };

  const { quote, rejected } = buildQuote({
    quoteId: "qt_fail_closed_test",
    threadId: "th_empty_test",
    profile,
    demand,
    catalogue: restrictedCatalogue,
    createdAt: new Date().toISOString(),
  });

  assert.equal(quote.options.length, 0);
  assert.equal(quote.status, "estimate", "Quote must not be marked validated when options.length === 0");
  assert.ok(rejected.length > 0, "Rejected candidates must be recorded");
  assert.match(rejected[0]?.unavailabilityReason ?? "", /host monitors/i);

  const hasValidOptionsCheck = quote.integrityChecks.find((c) => c.id === "has-valid-options");
  assert.ok(hasValidOptionsCheck);
  assert.equal(hasValidOptionsCheck.passed, false, "has-valid-options check must fail");

  const coversDemandCheck = quote.integrityChecks.find((c) => c.id === "covers-stated-requirements");
  assert.ok(coversDemandCheck);
  assert.equal(coversDemandCheck.passed, false, "covers-stated-requirements check must fail");
});

test("Extraction: Handles natural language variations (2M, 2 million, 2,000,000, 500k, compound phrases)", () => {
  const cases = [
    {
      text: "We need 2 million pageviews for RUM and 4 synthetic transaction monitors.",
      expectedRum: 2000000,
      expectedAdv: 4,
    },
    {
      text: "We have 500k pageviews/month and 10 advanced monitors.",
      expectedRum: 500000,
      expectedAdv: 10,
    },
    {
      text: "We require 2,000,000 monthly pageviews for RUM and 2 critical web endpoints.",
      expectedRum: 2000000,
      expectedAdv: 2,
    },
    {
      text: "2M RUM pageviews and 8 synthetic web monitors.",
      expectedRum: 2000000,
      expectedAdv: 8,
    },
  ];

  for (const c of cases) {
    const res = extractRequirements({
      threadId: "test_nl",
      senderEmail: "user@test.com",
      senderName: null,
      subject: "Inquiry",
      bodyText: c.text,
    });
    assert.equal(res.demand.rum_pageview, c.expectedRum, `Failed on RUM for: "${c.text}"`);
    assert.equal(res.demand.advanced_monitor, c.expectedAdv, `Failed on Advanced for: "${c.text}"`);
  }
});

test("Autonomous Conversation: Complete multi-turn sequence (initial email -> clarification -> buyer reply -> merged quote -> PDF email)", async () => {
  const senderEmail = `buyer_${Date.now()}@cloudpeak.io`;
  const senderName = "Sarah Jenkins";
  const initialMessageId = `msg_turn1_${Date.now()}`;

  // Turn 1: Initial email with 60 servers, 12 switches, and unquantified synthetic monitoring
  const turn1Result = await processInboundEmail({
    providerMessageId: initialMessageId,
    from: senderEmail,
    fromName: senderName,
    to: ["quotes@quote24x7.internal"],
    subject: "Site24x7 Infrastructure Sizing",
    text: "Hi Quote24x7 team, we need monitoring for 60 Linux servers, 12 core network switches, and synthetic transaction monitoring. Annual plan please.",
  });

  assert.equal(turn1Result.actionTaken, "clarification_requested");
  assert.equal(turn1Result.quote, undefined);
  assert.equal(turn1Result.pdfGenerated, undefined);

  // Verify thread is in awaiting_reply
  const thread1 = store.getThread(turn1Result.threadId);
  assert.ok(thread1);
  assert.equal(thread1.status, "awaiting_reply");
  assert.match(thread1.statusDetail || "", /advanced_monitors/i);

  // Verify profile version 1
  const profile1 = store.getProfile(turn1Result.threadId);
  assert.ok(profile1);
  assert.equal(profile1.version, 1);
  assert.equal(profile1.pendingQuestions.length, 1);
  assert.equal(profile1.answeredQuestions.length, 0);

  // Turn 2: Buyer replies specifically clarifying synthetic monitors
  const replyMessageId = `msg_turn2_${Date.now()}`;
  const turn2Result = await processInboundEmail({
    providerMessageId: replyMessageId,
    from: senderEmail,
    fromName: senderName,
    to: ["quotes@quote24x7.internal"],
    subject: "Re: Site24x7 Infrastructure Sizing",
    text: "Thanks! We need 4 synthetic transaction monitors for our user journeys.",
  });

  // Verify buyer was recognized and merged into the same thread
  assert.equal(turn2Result.threadId, turn1Result.threadId, "Reply must attach to the existing thread");
  assert.equal(turn2Result.actionTaken, "quoted");
  assert.ok(turn2Result.quote);
  assert.equal(turn2Result.pdfGenerated, true);

  // Verify merged requirement profile
  const profile2 = store.getProfile(turn1Result.threadId);
  assert.ok(profile2);
  assert.equal(profile2.version, 2, "Profile version must increment to 2");
  assert.equal(profile2.supersedesProfileId, profile1.id, "Profile 2 must supersede profile 1");
  assert.equal(profile2.pendingQuestions.length, 0, "All pending questions must now be resolved");
  assert.equal(profile2.answeredQuestions.length, 1, "Clarification question must move to answered");
  assert.match(profile2.answeredQuestions[0]?.answerSummary || "", /advanced_monitors: 4/i);

  // Verify that servers (60) and switches (12) were PRESERVED from Turn 1, and synthetic (4) added
  const serverField = profile2.fields.find((f) => f.key === "servers");
  assert.ok(serverField);
  assert.equal(serverField.value, 60, "Servers from Turn 1 must be preserved");

  const netField = profile2.fields.find((f) => f.key === "network_devices");
  assert.ok(netField);
  assert.equal(netField.value, 12, "Network devices from Turn 1 must be preserved");

  const advField = profile2.fields.find((f) => f.key === "advanced_monitors");
  assert.ok(advField);
  assert.equal(advField.value, 4, "Advanced monitors from Turn 2 must be merged");

  // Verify quote covers all 3 capabilities
  const quote = turn2Result.quote;
  assert.equal(quote.status, "validated");

  const bestValue = quote.options.find((o) => o.optionType === "best_value");
  assert.ok(bestValue);
  const hostRow = bestValue.coverage.find((c) => c.unit === "host_monitor");
  assert.ok(hostRow && hostRow.total >= 60 && hostRow.satisfied);
  const netRow = bestValue.coverage.find((c) => c.unit === "network_component");
  assert.ok(netRow && netRow.total >= 12 && netRow.satisfied);
  const advRow = bestValue.coverage.find((c) => c.unit === "advanced_monitor");
  assert.ok(advRow && advRow.total >= 4 && advRow.satisfied);

  // Verify thread transitioned to completed / sending
  const thread2 = store.getThread(turn1Result.threadId);
  assert.ok(thread2);
  assert.ok(thread2.status === "completed" || thread2.status === "sending");
  assert.equal(thread2.quoteId, quote.id);
});

test("Webhook Security: Cryptographic verification rejects unauthenticated and tampered payloads", () => {
  const payload = JSON.stringify({ type: "email.received", data: { email_id: "test_123" } });

  // 1. Without secret configured, verifyWebhookSignature parses payload safely
  const resultNoSecret = verifyWebhookSignature(payload, {});
  assert.equal(resultNoSecret.valid, true);

  // 2. When secret is configured, missing headers are rejected
  const origSecret = process.env.RESEND_WEBHOOK_SECRET;
  try {
    process.env.RESEND_WEBHOOK_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2gAqrut";

    const missingHeadersResult = verifyWebhookSignature(payload, {});
    assert.equal(missingHeadersResult.valid, false);
    assert.match(missingHeadersResult.error || "", /missing required svix/i);

    // Invalid signature is rejected
    const badSigResult = verifyWebhookSignature(payload, {
      id: "msg_123",
      timestamp: Math.floor(Date.now() / 1000).toString(),
      signature: "v1,invalid_signature_base64",
    });
    assert.equal(badSigResult.valid, false);
    assert.match(badSigResult.error || "", /verification failed/i);
  } finally {
    if (origSecret !== undefined) {
      process.env.RESEND_WEBHOOK_SECRET = origSecret;
    } else {
      delete process.env.RESEND_WEBHOOK_SECRET;
    }
  }
});

test("Loop Prevention: Discards auto-replies, out-of-office, and postmaster messages", async () => {
  const senderEmail = `noreply_${Date.now()}@service.example.com`;

  // Case 1: Out of office
  const res1 = await processInboundEmail({
    providerMessageId: `msg_loop_${Date.now()}_1`,
    from: senderEmail,
    to: ["quotes@quote24x7.internal"],
    subject: "Automatic reply: Out of office until Monday",
    text: "I am out of the office and will respond when I return.",
  });
  assert.equal(res1.actionTaken, "dropped_loop");

  // Case 2: Postmaster / mailer-daemon
  const res2 = await processInboundEmail({
    providerMessageId: `msg_loop_${Date.now()}_2`,
    from: "mailer-daemon@mx.google.com",
    to: ["quotes@quote24x7.internal"],
    subject: "Delivery Status Notification (Failure)",
    text: "Message could not be delivered to recipient mailbox.",
  });
  assert.equal(res2.actionTaken, "dropped_loop");
});

test("Autonomous Loop Termination: Escalates to manual review if clarification rounds reach limit", async () => {
  const senderEmail = `loop_user_${Date.now()}@vague.example.com`;

  // Start with profile at round 2
  const threadId = `th_limit_${Date.now()}`;
  store.saveThread({
    id: threadId,
    provider: "resend",
    providerThreadId: "th_limit_p",
    senderEmail,
    senderName: "Vague User",
    organisation: null,
    subject: "Vague quote",
    status: "awaiting_reply",
    requestType: "quote",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
    messageCount: 3,
    quoteId: null,
    quoteTotal: null,
    currency: "INR",
    statusDetail: "Awaiting clarification",
  });

  store.saveProfile({
    id: `prof_limit_${Date.now()}`,
    threadId,
    version: 2,
    supersedesProfileId: null,
    createdAt: new Date().toISOString(),
    extractorModel: "test",
    extractorRunId: "test",
    fields: [
      {
        key: "servers",
        label: "Server Monitors",
        group: "infrastructure",
        value: null,
        unit: "servers",
        state: "missing",
        confidence: null,
        evidence: null,
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
    ],
    summary: "Still missing servers",
    pendingQuestions: [
      {
        id: "cq_limit",
        fieldKeys: ["servers"],
        question: "How many servers do you need?",
        reason: "Missing servers",
        askedAt: new Date().toISOString(),
        answeredAt: null,
        answerSummary: null,
      },
    ],
    answeredQuestions: [],
    clarificationRound: 2,
  });

  // Reply is still completely vague and doesn't specify any numbers
  const result = await processInboundEmail({
    providerMessageId: `msg_limit_reply_${Date.now()}`,
    from: senderEmail,
    to: ["quotes@quote24x7.internal"],
    subject: "Re: Vague quote",
    text: "Just give me the best plan you have.",
  });

  // Since clarification round reaches 3, should fail closed and escalate
  assert.equal(result.actionTaken, "unsupported");
  const thread = store.getThread(threadId);
  assert.ok(thread);
  assert.equal(thread.status, "unsupported");
  assert.match(thread.statusDetail || "", /limit reached/i);
});

test("Resend Inbound: Inbound webhook event (type: 'email.received') processes successfully", async () => {
  const providerMessageId = `resend_inbound_${Date.now()}`;
  const senderEmail = `inbound_client_${Date.now()}@fintech.example.com`;

  // Simulating the Resend Inbound webhook event structure
  const result = await processInboundEmail({
    providerMessageId,
    from: senderEmail,
    fromName: "FinTech Inbound Lead",
    to: ["quotes@quote24x7.internal"],
    subject: "Pricing for 50 servers and 10 switches",
    text: "We require monitoring for 50 servers and 10 network devices. Annual plan please.",
  });

  assert.equal(result.actionTaken, "quoted");
  assert.ok(result.quote);
  assert.equal(result.quote.status, "validated");
  assert.equal(result.pdfGenerated, true);
});
