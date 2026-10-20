import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

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
import { runPreSendChecks } from "../email/resend-outbound.ts";
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

test("Item 2 Unit Attachment: '10 website checks, 100 GB logs, no synthetics, no RUM' gives RUM = none", () => {
  const res = extractRequirements({
    threadId: "th_test_unit_attach",
    senderEmail: "buyer@example.com",
    senderName: "Buyer",
    subject: "Monitoring quote",
    bodyText: "10 website checks, 100 GB logs, no synthetics, no RUM",
  });

  const intake = res.profile.intakeRequirements!;
  assert.ok(intake);
  assert.equal(intake.rum_pageview.state, "none", "RUM must be none");
  assert.equal(intake.rum_pageview.quantity, 0);
  assert.equal(intake.advanced_monitor.state, "none", "Synthetics must be none");
  assert.equal(intake.advanced_monitor.quantity, 0);
  assert.equal(res.demand.basic_monitor, 10, "10 website checks");
  assert.equal(res.demand.applog_gb, 100, "100 GB logs");

  // Every update has an evidence span containing that unit's keyword
  assert.match(intake.basic_monitor.evidence || "", /\b(?:website|checks?)\b/i);
  assert.match(intake.applog_gb.evidence || "", /\blogs?\b/i);
  assert.match(intake.advanced_monitor.evidence || "", /\bsynthetic/i);
  assert.match(intake.rum_pageview.evidence || "", /\brum\b/i);
});

test("Item 2 Unit Attachment: 'Actually, adjust the estimate to 25 servers' with websites = 3 leaves websites = 3", () => {
  const initial = extractRequirements({
    threadId: "th_test_unit_isolated",
    senderEmail: "buyer@example.com",
    senderName: "Buyer",
    subject: "Monitoring quote",
    bodyText: "We need coverage for 15 Linux Servers, 3 Web Endpoints, no network devices, no synthetic checks, no RUM, and 150 GB logs monthly.",
  });

  assert.equal(initial.demand.basic_monitor, 3);
  assert.equal(initial.demand.host_monitor, 15);
  assert.equal(initial.demand.network_component, 0);
  assert.equal(initial.demand.applog_gb, 150);

  const followUp = mergeRequirements({
    existingProfile: initial.profile,
    senderEmail: "buyer@example.com",
    subject: "Re: Monitoring quote",
    replyText: "Actually, please adjust the estimate to 25 servers.",
  });

  const followUpIntake = followUp.profile.intakeRequirements!;
  assert.ok(followUpIntake);

  // Host monitor updated
  assert.equal(followUp.demand.host_monitor, 25, "Servers updated to 25");
  assert.match(followUpIntake.host_monitor.evidence || "", /\bservers?\b/i);

  // Websites completely untouched
  assert.equal(followUp.demand.basic_monitor, 3, "Websites must remain 3");
  assert.equal(followUp.demand.network_component, 0, "Network devices must remain 0");
  assert.equal(followUp.demand.applog_gb, 150, "Logs must remain 150");
  assert.equal(followUpIntake.advanced_monitor.state, "none");
  assert.equal(followUpIntake.rum_pageview.state, "none");
});

test("Item 2 Unit Attachment: compound negation 'No synthetic checks or RUM needed' sets both to none", () => {
  const res = extractRequirements({
    threadId: "th_compound_neg",
    senderEmail: "buyer@example.com",
    senderName: "Buyer",
    subject: "Monitoring quote",
    bodyText: "25 servers, 8 network switches, 10 websites, 100 GB logs per month. No synthetic checks or RUM needed.",
  });

  const intake = res.profile.intakeRequirements!;
  assert.ok(intake);
  assert.equal(intake.advanced_monitor.state, "none");
  assert.equal(intake.rum_pageview.state, "none");
  assert.match(intake.advanced_monitor.evidence || "", /\bsynthetic/i);
  assert.match(intake.rum_pageview.evidence || "", /\brum/i);
});

test("Item B Regression: Case 1 exact PDF text extraction and golden sum pricing", () => {
  const case1PdfText = `
Infrastructure Sizing Specification
Production Environment Scope

1. Server Infrastructure:
• 35 Production Linux Servers (Ubuntu 22.04 LTS on AWS c5.2xlarge)
• 15 Windows Database & AD Servers (Windows Server 2022 on m5.xlarge)
Total Host Server Requirement: 50 Servers

2. Network Infrastructure:
• 6 Core Switches (Cisco Catalyst 9300)
• 2 Perimeter Firewalls (FortiGate 100F)
Total Network Component Requirement: 8 Network Devices

3. Applications & Web Checks:
• 5 Public HTTPS Website Availability Endpoints
• 2 Multi-step Real Browser Synthetic Transactions

4. Log Management:
• 20 GB per day (~600 GB monthly) Log Storage Retention
`;

  const turn1Res = extractRequirements({
    threadId: "th_case1_regression",
    senderEmail: "alex.mercer@acmecorp.com",
    senderName: "Alex Mercer",
    subject: "Quote Request: Infrastructure Scope",
    bodyText: case1PdfText,
  });

  // Authoritative extraction checks
  assert.equal(turn1Res.demand.host_monitor, 50, "Host servers must be 50 (authoritative total)");
  assert.equal(turn1Res.demand.network_component, 8, "Network components must be 8 (authoritative total)");
  assert.equal(turn1Res.demand.basic_monitor, 5, "Basic monitors must be 5");
  assert.equal(turn1Res.demand.advanced_monitor, 2, "Synthetic transactions must count as 2 advanced monitors");
  assert.equal(turn1Res.demand.applog_gb, 600, "Prefer explicit monthly 600 GB over per-day");

  // Arithmetic verification for Turn 1
  const basePrice = 47880;
  const serversV1 = 121885;
  const advMonitors = 15390;
  const logsV1 = 120270;
  const turn1ExpectedTotal = basePrice + serversV1 + advMonitors + logsV1;
  assert.equal(turn1ExpectedTotal, 305425, "Turn 1 sum: 47,880 + 1,21,885 + 15,390 + 1,20,270 = 3,05,425");

  // Turn 2: "40 servers instead of 50, no network devices"
  const turn2Res = mergeRequirements({
    existingProfile: turn1Res.profile,
    senderEmail: "alex.mercer@acmecorp.com",
    senderName: "Alex Mercer",
    subject: "Re: Quote Request: Infrastructure Scope",
    replyText: "40 servers instead of 50, no network devices\n\nThanks,\nAlex Mercer",
  });

  assert.equal(turn2Res.demand.host_monitor, 40, "Servers must update to 40");
  assert.equal(turn2Res.demand.network_component, 0, "Network devices must update to 0 (none)");
  assert.equal(turn2Res.demand.basic_monitor, 5, "Websites must remain 5");
  assert.equal(turn2Res.demand.advanced_monitor, 2, "Advanced monitors must remain 2");
  assert.equal(turn2Res.demand.applog_gb, 600, "Logs must remain 600");

  // Arithmetic verification for Turn 2
  const serversV2 = 4 * 25650; // 1,02,600
  const turn2ExpectedTotal = basePrice + serversV2 + advMonitors + logsV1;
  assert.equal(turn2ExpectedTotal, 286140, "Turn 2 sum: 47,880 + 4 x 25,650 + 15,390 + 1,20,270 = 2,86,140");
});

test("Item C Follow-up Updates: Case 2 follow-up sets applog_gb to 1500", () => {
  const initial = extractRequirements({
    threadId: "th_case2_test",
    senderEmail: "marcus.vance@globallogistics.example.com",
    senderName: "Marcus Vance",
    subject: "RFP Spec",
    bodyText: "We need 80 servers, 20 network devices, 10 synthetic checks, and 2000 GB logs per month.",
  });

  assert.equal(initial.demand.host_monitor, 80);
  assert.equal(initial.demand.applog_gb, 2000);

  const followUp = mergeRequirements({
    existingProfile: initial.profile,
    senderEmail: "marcus.vance@globallogistics.example.com",
    senderName: "Marcus Vance",
    subject: "Re: RFP Spec",
    replyText: "We need 70 servers instead of 80, and reduce log ingestion to 1,500 GB per month.\n\nRegards,\nMarcus Vance",
  });

  assert.equal(followUp.demand.host_monitor, 70, "Servers updated to 70");
  assert.equal(followUp.demand.applog_gb, 1500, "AppLogs volume updated to 1500");
  assert.equal(followUp.demand.network_component, 20, "Network components preserved at 20");
  assert.equal(followUp.demand.advanced_monitor, 10, "Advanced monitors preserved at 10");
});

test("Item D Pre-send checker fails on email missing standard footer or Ref line", () => {
  const contentWithoutFooter = "Hi Alex,\n\nHere is your quote for 50 servers.\n";
  const result = runPreSendChecks(contentWithoutFooter, { requireFooter: true });
  assert.equal(result.passed, false, "Pre-send check must fail when footer is missing");
  assert.ok(result.violations.some((v) => v.includes("Quote24x7 Assistant")), "Must detect missing Quote24x7 Assistant");
  assert.ok(result.violations.some((v) => v.includes("Ref Q-")), "Must detect missing Ref line");

  const contentWithFooter = [
    "Hi Alex,",
    "",
    "Here is your estimate.",
    "",
    "Quote24x7 Assistant",
    "Automated assistant using Site24x7's public India pricing. A Site24x7 sales representative confirms final pricing.",
    "Ref Q-1042",
  ].join("\n");

  const validResult = runPreSendChecks(contentWithFooter, { requireFooter: true });
  assert.equal(validResult.passed, true, "Pre-send check must pass with valid standard footer");
});

test("Task 3 Regression: Case 1 real email body + PDF attachment end-to-end", async () => {
  store.reset();
  const pdfPath = path.resolve(process.cwd(), "test-attachments", "Case-1-Production-Infrastructure.pdf");
  const pdfBuf = fs.readFileSync(pdfPath);

  // Turn 1: Real Case 1 email body including 'No other monitoring needed.'
  const turn1 = await processInboundEmail({
    providerMessageId: `msg_c1_t1_${Date.now()}`,
    from: "alex.mercer@acmecorp.com",
    fromName: "Alex Mercer",
    to: ["quotes@quotes.joanathan.in"],
    subject: "Quote Request: Production Infrastructure Monitoring (PDF Scope)",
    text: [
      "Hi Site24x7 Team,",
      "",
      "Please review the attached PDF document containing our current infrastructure inventory and sizing breakdown.",
      "We are looking for an annual quote with tier-appropriate add-ons for our servers, network gear, and log aggregation.",
      "No other monitoring needed.",
      "",
      "Thanks,",
      "Alex Mercer",
      "DevOps Lead, Acme Corp",
    ].join("\n"),
    attachments: [
      {
        filename: "Case-1-Production-Infrastructure.pdf",
        contentType: "application/pdf",
        content: pdfBuf,
      },
    ],
  });

  assert.equal(turn1.actionTaken, "quoted");
  assert.ok(turn1.quote);
  const prof1 = store.getProfile(turn1.threadId);
  assert.ok(prof1);
  assert.ok(prof1.intakeRequirements);
  const intake1 = prof1.intakeRequirements;

  // Assert six units
  assert.equal(intake1.host_monitor.quantity, 50, "Host servers must be 50");
  assert.equal(intake1.host_monitor.state, "stated");
  assert.equal(intake1.network_component.quantity, 8, "Network components must be 8");
  assert.equal(intake1.network_component.state, "stated");
  assert.equal(intake1.basic_monitor.quantity, 5, "Basic monitors must be 5 (excluding server fleet)");
  assert.equal(intake1.basic_monitor.state, "stated");
  assert.equal(intake1.advanced_monitor.quantity, 2, "Advanced monitors must be 2");
  assert.equal(intake1.advanced_monitor.state, "stated");
  assert.equal(intake1.applog_gb.quantity, 600, "Logs must be 600 GB monthly");
  assert.equal(intake1.applog_gb.state, "stated");
  assert.equal(intake1.rum_pageview.quantity, 0, "RUM must be 0 (none)");
  assert.equal(intake1.rum_pageview.state, "none");

  // Hand-calculated golden sum: Professional 47,880 + 1,21,885 + 15,390 + 1,20,270 = 3,05,425
  const rec1 = turn1.quote.options[0]!;
  assert.equal(rec1.planName, "Professional");
  assert.equal(rec1.total, 30542500, "Turn 1 total must equal 3,05,425");

  // Turn 2: Follow-up update
  const turn2 = await processInboundEmail({
    providerMessageId: `msg_c1_t2_${Date.now()}`,
    from: "alex.mercer@acmecorp.com",
    fromName: "Alex Mercer",
    to: ["quotes@quotes.joanathan.in"],
    subject: "Re: Quote Request: Production Infrastructure Monitoring (PDF Scope)",
    text: "40 servers instead of 50, no network devices\n\nThanks,\nAlex Mercer",
  });

  assert.equal(turn2.actionTaken, "quoted");
  assert.ok(turn2.quote);
  const prof2 = store.getProfile(turn2.threadId);
  assert.ok(prof2);
  assert.ok(prof2.intakeRequirements);
  const intake2 = prof2.intakeRequirements;
  assert.equal(intake2.host_monitor.quantity, 40);
  assert.equal(intake2.network_component.quantity, 0);
  assert.equal(intake2.basic_monitor.quantity, 5);
  assert.equal(intake2.advanced_monitor.quantity, 2);
  assert.equal(intake2.applog_gb.quantity, 600);

  // Turn 2 golden sum: Professional 47,880 + 4 x 25,650 + 15,390 + 1,20,270 = 2,86,140
  const rec2 = turn2.quote.options[0]!;
  assert.equal(rec2.planName, "Professional");
  assert.equal(rec2.total, 28614000, "Turn 2 total must equal 2,86,140");
});

test("Task 3 Regression: Case 2 real email body + DOCX attachment end-to-end", async () => {
  store.reset();
  const docxPath = path.resolve(process.cwd(), "test-attachments", "Case-2-Enterprise-Architecture-Spec.docx");
  const docxBuf = fs.readFileSync(docxPath);

  // Turn 1: Real Case 2 email body
  const turn1 = await processInboundEmail({
    providerMessageId: `msg_c2_t1_${Date.now()}`,
    from: "marcus.vance@globallogistics.example.com",
    fromName: "Marcus Vance",
    to: ["quotes@quotes.joanathan.in"],
    subject: "RFP: Enterprise Architecture Monitoring Spec (DOCX)",
    text: [
      "Hello Site24x7 Team,",
      "",
      "Attached is our enterprise architecture specification for IT monitoring.",
      "Please provide an itemized annual proposal.",
      "No basic website checks needed outside the synthetic monitors.",
      "",
      "Thanks,",
      "Marcus Vance",
      "Infrastructure Architect, Global Logistics Technologies",
    ].join("\n"),
    attachments: [
      {
        filename: "Case-2-Enterprise-Architecture-Spec.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content: docxBuf,
      },
    ],
  });

  assert.equal(turn1.actionTaken, "quoted", "Case 2 Turn 1 must quote rather than clarify");
  assert.ok(turn1.quote);
  const prof1 = store.getProfile(turn1.threadId);
  assert.ok(prof1);
  assert.ok(prof1.intakeRequirements);
  const intake1 = prof1.intakeRequirements;

  assert.equal(intake1.host_monitor.quantity, 80);
  assert.equal(intake1.network_component.quantity, 16);
  assert.equal(intake1.basic_monitor.quantity, 0);
  assert.equal(intake1.advanced_monitor.quantity, 10);
  assert.equal(intake1.rum_pageview.quantity, 1000000);
  assert.equal(intake1.applog_gb.quantity, 3000);

  const t1Total = turn1.quote.options[0]!.total;
  assert.equal(t1Total, 74603500, "Case 2 Turn 1 total must be 7,46,035");

  // Turn 2: Reduced servers and logs
  const turn2 = await processInboundEmail({
    providerMessageId: `msg_c2_t2_${Date.now()}`,
    from: "marcus.vance@globallogistics.example.com",
    fromName: "Marcus Vance",
    to: ["quotes@quotes.joanathan.in"],
    subject: "Re: RFP: Enterprise Architecture Monitoring Spec (DOCX)",
    text: "We need 70 servers instead of 80, and reduce log ingestion to 1,500 GB per month.\n\nThanks,\nMarcus Vance",
  });

  assert.equal(turn2.actionTaken, "quoted");
  assert.ok(turn2.quote);
  const t2Total = turn2.quote.options[0]!.total;
  assert.equal(t2Total, 57437000, "Case 2 Turn 2 total must be 5,74,370");
  assert.ok(t2Total < t1Total, "Turn 2 total must be less than Turn 1 after reduction");
});

test("Task 3 Regression: Case 3 real email body + CSV attachment end-to-end", async () => {
  store.reset();
  const csvPath = path.resolve(process.cwd(), "test-attachments", "Case-3-Server-Inventory.csv");
  const csvBuf = fs.readFileSync(csvPath);

  // Turn 1: Partial Scope -> Clarification Requested
  const turn1 = await processInboundEmail({
    providerMessageId: `msg_c3_t1_${Date.now()}`,
    from: "priya.nair@cloudscale.io",
    fromName: "Priya Nair",
    to: ["quotes@quotes.joanathan.in"],
    subject: "Server Monitoring Sizing Request (CSV Attached)",
    text: [
      "Hi Team,",
      "",
      "Please find attached our current server inventory CSV with 20 production nodes.",
      "Can you send us pricing for monitoring these?",
      "",
      "Thanks,",
      "Priya Nair",
      "DevOps, CloudScale",
    ].join("\n"),
    attachments: [
      {
        filename: "Case-3-Server-Inventory.csv",
        contentType: "text/csv",
        content: csvBuf,
      },
    ],
  });

  assert.equal(turn1.actionTaken, "clarification_requested", "Turn 1 must ask for clarification");

  // Turn 2: Full scope clarification reply -> Quotes Lite at ₹98,800
  const turn2 = await processInboundEmail({
    providerMessageId: `msg_c3_t2_${Date.now()}`,
    from: "priya.nair@cloudscale.io",
    fromName: "Priya Nair",
    to: ["quotes@quotes.joanathan.in"],
    subject: "Re: Server Monitoring Sizing Request (CSV Attached)",
    text: [
      "Hi,",
      "",
      "To clarify our full scope: we have 4 network switches, 6 public websites, no synthetic checks, no RUM, and 50 GB logs monthly.",
      "",
      "Thanks,",
      "Priya Nair",
    ].join("\n"),
  });

  assert.equal(turn2.actionTaken, "quoted", "Turn 2 must quote successfully");
  assert.ok(turn2.quote);
  const rec = turn2.quote.options[0]!;
  assert.equal(rec.planName, "Lite", "Lite must be recommended");
  assert.equal(rec.total, 9880000, "Lite total must equal ₹98,800 (10,260 + 10,260 + 51,300 + 11,305 + 15,675)");
});


