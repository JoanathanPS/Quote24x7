import assert from "node:assert/strict";
import test from "node:test";

import {
  extractRequirements,
  mergeRequirements,
  triageInboundEmail,
  isSufficientToQuote,
  buildClarificationQuestions,
  isSubstantiveEmail,
  INTAKE_UNITS,
} from "./extractor.ts";
import { processInboundEmail } from "../email/inbound-processor.ts";
import { store } from "../store/session-store.ts";

test("Triage: Categorizes inbound emails correctly", () => {
  assert.equal(isSubstantiveEmail("hi there"), false);
  assert.equal(isSubstantiveEmail("we have 10 servers"), true);
  // 1. Actionable RFQ
  assert.equal(
    triageInboundEmail("Pricing inquiry", "We have 25 Linux servers and 5 network switches."),
    "actionable_rfq",
  );
  assert.equal(
    triageInboundEmail("Quote needed", "Need to check uptime for 10 API endpoints"),
    "actionable_rfq",
  );

  // 2. Vague Inquiry
  assert.equal(
    triageInboundEmail("Site24x7 pricing", "Could you please send me your price list and brochure?"),
    "vague_inquiry",
  );

  // 3. Non-Substantive / Casual Acknowledgement
  assert.equal(triageInboundEmail("Hi", "hi"), "casual_acknowledgement");
  assert.equal(triageInboundEmail("Re: Quote", "Thanks!"), "casual_acknowledgement");
  assert.equal(triageInboundEmail("Re: Quote", "ok sounds good"), "casual_acknowledgement");
  assert.equal(triageInboundEmail("SEO services", "We offer SEO services to rank your site on Google"), "non_substantive");

  // Automated messages are dropped entirely
  assert.equal(triageInboundEmail("Out of office", "I am out of the office until Monday"), "ignored_automated");

  // 4. Unsupported
  assert.equal(
    triageInboundEmail("Reseller inquiry", "We want reseller discount and partner margins for our agency"),
    "unsupported",
  );
  assert.equal(
    triageInboundEmail("RFP submission", "Please find our attached RFP tender document for formal bidding"),
    "unsupported",
  );
  assert.equal(
    triageInboundEmail("US Pricing", "We are a US entity and need quotes in USD dollar pricing"),
    "unsupported",
  );
  assert.equal(
    triageInboundEmail("Feature request", "Can you build feature X for our proprietary hardware?"),
    "unsupported",
  );
});

test("Intake Units: Tracks exactly 6 units with stated, none, and unknown states", () => {
  // Test case 1: Only servers stated -> servers stated, other 5 unknown
  const res1 = extractRequirements({
    threadId: "th_intake_1",
    senderEmail: "dev@corp.example.com",
    senderName: "Dev",
    subject: "Server monitoring",
    bodyText: "we have 25 servers",
  });

  assert.equal(res1.intakeRequirements.host_monitor.state, "stated");
  assert.equal(res1.intakeRequirements.host_monitor.quantity, 25);
  assert.equal(res1.intakeRequirements.basic_monitor.state, "unknown");
  assert.equal(res1.intakeRequirements.advanced_monitor.state, "unknown");
  assert.equal(res1.intakeRequirements.network_component.state, "unknown");
  assert.equal(res1.intakeRequirements.rum_pageview.state, "unknown");
  assert.equal(res1.intakeRequirements.applog_gb.state, "unknown");
  assert.equal(res1.isComplete, false, "Must not be complete while 5 units are unknown");

  // Test case 2: 'just servers' -> servers stated, other 5 none
  const res2 = extractRequirements({
    threadId: "th_intake_2",
    senderEmail: "dev@corp.example.com",
    senderName: "Dev",
    subject: "Server monitoring",
    bodyText: "we have 25 servers, just servers",
  });

  assert.equal(res2.intakeRequirements.host_monitor.state, "stated");
  assert.equal(res2.intakeRequirements.host_monitor.quantity, 25);
  assert.equal(res2.intakeRequirements.basic_monitor.state, "none");
  assert.equal(res2.intakeRequirements.advanced_monitor.state, "none");
  assert.equal(res2.intakeRequirements.network_component.state, "none");
  assert.equal(res2.intakeRequirements.rum_pageview.state, "none");
  assert.equal(res2.intakeRequirements.applog_gb.state, "none");
  assert.equal(res2.isComplete, true, "Must be sufficient when all 6 are stated or none");
  assert.equal(isSufficientToQuote(res2.intakeRequirements), true);
});

test("Intake Units: API endpoints count as basic monitors, multi-step synthetic as advanced, GB/day converts to monthly", () => {
  const res = extractRequirements({
    threadId: "th_intake_3",
    senderEmail: "arch@tech.example.com",
    senderName: "Architect",
    subject: "Full stack monitoring",
    bodyText: `
      We need monitoring for:
      - 50 Linux VMs
      - 20 API endpoints
      - 5 synthetic transaction checks
      - 10 network switches
      - 1M RUM pageviews
      - 2 GB/day logs
    `,
  });

  assert.equal(res.demand.host_monitor, 50);
  assert.equal(res.demand.basic_monitor, 20, "API endpoints count as basic monitors");
  assert.equal(res.demand.advanced_monitor, 5, "Synthetic checks count as advanced monitors");
  assert.equal(res.demand.network_component, 10);
  assert.equal(res.demand.rum_pageview, 1000000);
  assert.equal(res.demand.applog_gb, 60, "2 GB/day converts to 60 GB/month");
  assert.equal(res.isComplete, true);
});

test("Clarification Questions: Groups missing units into at most 3 clear numbered questions with no prices", () => {
  const unknownUnits = [...INTAKE_UNITS]; // all 6 unknown
  const questions = buildClarificationQuestions(unknownUnits);

  assert.ok(questions.length <= 3, `Expected at most 3 questions, got ${questions.length}`);
  assert.equal(questions.length, 3);
  assert.match(questions[0]!, /^1\.\s+How many servers/);
  assert.match(questions[1]!, /^2\.\s+How many websites, URLs, or API endpoints/);
  assert.match(questions[2]!, /^3\.\s+Do you require Real User Monitoring/);

  // Never mention any price figures or estimates
  for (const q of questions) {
    assert.equal(/\b(?:₹|INR|price|cost|quote|rupee|\d{3,})\b/i.test(q), false);
  }
});

test("Optional Grouped Questions: Extracts optional parameters without blocking sufficiency", () => {
  const res = extractRequirements({
    threadId: "th_opt",
    senderEmail: "admin@enterprise.example.com",
    senderName: "Admin",
    subject: "Enterprise Quote",
    bodyText: `
      We have 100 servers, 20 basic checks, 5 synthetic monitors, 10 switches, 2M RUM, 50 GB logs.
      We have a team of 15 users, require 60 days log retention, and need public status pages with anomaly detection.
    `,
  });

  assert.equal(res.isComplete, true);
  assert.equal(res.optionalParameters.usersOver10, true);
  assert.equal(res.optionalParameters.logRetentionOver30Days, true);
  assert.equal(res.optionalParameters.statusPages, true);
  assert.equal(res.optionalParameters.anomalyDetection, true);
});

test("Substantive vs Non-Substantive: 'thanks' does not consume round or increment nonproductive streak", async () => {
  const senderEmail = `client_${Date.now()}@nonsub.example.com`;

  // Turn 1: 25 servers (incomplete requirements -> clarification requested)
  const turn1 = await processInboundEmail({
    providerMessageId: `msg_${Date.now()}_1`,
    from: senderEmail,
    to: ["quotes@quotes.joanathan.in"],
    subject: "Server monitoring",
    text: "we have 25 servers",
  });

  assert.equal(turn1.status, "NEEDS_INFO");
  const threadAfterTurn1 = store.getThread(turn1.threadId);
  assert.ok(threadAfterTurn1);
  assert.equal(threadAfterTurn1.roundsUsed, 1);
  assert.equal(threadAfterTurn1.nonproductiveStreak, 0);

  // Turn 2: Non-substantive "thanks"
  const turn2 = await processInboundEmail({
    providerMessageId: `msg_${Date.now()}_2`,
    from: senderEmail,
    to: ["quotes@quotes.joanathan.in"],
    subject: `Re: Server monitoring [Ref: #${turn1.threadId}]`,
    text: "thanks!",
  });

  assert.equal(turn2.status, "NEEDS_INFO");
  const threadAfterTurn2 = store.getThread(turn1.threadId);
  assert.ok(threadAfterTurn2);
  // Round and streak must NOT increment on non-substantive email
  assert.equal(threadAfterTurn2.roundsUsed, 1, "Non-substantive message must not consume a round");
  assert.equal(threadAfterTurn2.nonproductiveStreak, 0, "Non-substantive message must not increment streak");
});

test("Yield Checks: 2 consecutive non-productive replies parks thread as needs_review and sends final email", async () => {
  const senderEmail = `client_${Date.now()}@yield2.example.com`;

  // Turn 1: Initial vague inquiry
  const turn1 = await processInboundEmail({
    providerMessageId: `msg_${Date.now()}_y1`,
    from: senderEmail,
    to: ["quotes@quotes.joanathan.in"],
    subject: "Monitoring quote",
    text: "I want monitoring for our company",
  });
  assert.equal(turn1.actionTaken, "clarification_requested");

  // Turn 2: Non-productive conversational reply 1 (stalling without numbers)
  // This message provides no actionable info, so AI may send clarification or escalate
  const turn2 = await processInboundEmail({
    providerMessageId: `msg_${Date.now()}_y2`,
    from: senderEmail,
    to: ["quotes@quotes.joanathan.in"],
    subject: `Re: Monitoring quote [Ref: #${turn1.threadId}]`,
    text: "We are still discussing with our internal team and will let you know.",
  });
  // Accept either clarification_requested (AI asks again) or unsupported (AI escalates due to vagueness)
  assert.ok(
    turn2.actionTaken === "clarification_requested" || turn2.actionTaken === "unsupported",
    `Expected clarification_requested or unsupported, got ${turn2.actionTaken}`
  );
  const thread2 = store.getThread(turn1.threadId);
  assert.ok(thread2);
  assert.ok((thread2.nonproductiveStreak ?? 0) >= 1, "Nonproductive streak should be at least 1");

  // Turn 3: Non-productive conversational reply 2
  const turn3 = await processInboundEmail({
    providerMessageId: `msg_${Date.now()}_y3`,
    from: senderEmail,
    to: ["quotes@quotes.joanathan.in"],
    subject: `Re: Monitoring quote [Ref: #${turn1.threadId}]`,
    text: "Still waiting on executive approval, check later.",
  });

  assert.equal(turn3.actionTaken, "unsupported");
  const thread3 = store.getThread(turn1.threadId);
  assert.ok(thread3);
  assert.equal(thread3.state, "needs_review", "Thread must be parked in needs_review");
  assert.equal(thread3.state, "needs_review", "Thread must be parked in needs_review");

  // Verify final email was sent with link to pricing page
  const messages = store.getMessages(turn1.threadId);
  const lastOutbound = messages.filter((m) => m.direction === "outbound").pop();
  assert.ok(lastOutbound);
  assert.match(lastOutbound.bodyText, /site24x7\.in\/pricing\.html/i);
});

test("Requirement merging: Prior values are preserved when not overridden", () => {
  const req1 = extractRequirements({
    threadId: "th_test_merge",
    senderEmail: "buyer@example.com",
    senderName: null,
    subject: "Monitoring quote",
    bodyText: "I have 10 servers.",
  });
  assert.equal(req1.demand.host_monitor, 10);
  assert.equal(req1.demand.network_component, 0);

  const merged = mergeRequirements({
    existingProfile: req1.profile,
    senderEmail: "buyer@example.com",
    subject: "Re: Monitoring quote",
    replyText: "Also need 5 network switches.",
  });
  assert.equal(merged.demand.host_monitor, 10);
  assert.equal(merged.demand.network_component, 5);
});

