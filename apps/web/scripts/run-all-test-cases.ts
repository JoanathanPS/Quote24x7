import fs from "node:fs/promises";
import path from "node:path";
import { processInboundEmail } from "../src/server/email/inbound-processor.ts";
import { store } from "../src/server/store/session-store.ts";

const ATTACHMENTS_DIR = path.resolve(process.cwd(), "test-attachments");

interface TestCase {
  id: string;
  name: string;
  sender: string;
  senderName: string;
  subject: string;
  attachmentFiles: string[];
  initialBody: string;
  followupBody: string;
}

const TEST_CASES: TestCase[] = [
  {
    id: "case-1",
    name: "Case 1: Standard PDF Document Intake",
    sender: "alex.mercer@acmecorp.com",
    senderName: "Alex Mercer",
    subject: "Quote Request: Production Infrastructure Monitoring (PDF Scope)",
    attachmentFiles: ["Case-1-Production-Infrastructure.pdf"],
    initialBody: [
      "Hi Site24x7 Team,",
      "",
      "Please review the attached PDF document containing our current infrastructure inventory and sizing breakdown.",
      "We are looking for an annual quote with tier-appropriate add-ons for our servers, network gear, and log aggregation.",
      "No other monitoring needed.",
      "",
      "Best regards,",
      "Alex Mercer",
      "DevOps Lead, Acme Corp",
    ].join("\n"),
    followupBody: "40 servers instead of 50, no network devices\n\nThanks,\nAlex Mercer",
  },
  {
    id: "case-2",
    name: "Case 2: Enterprise DOCX Specification",
    sender: "marcus.vance@globallogistics.example.com",
    senderName: "Marcus Vance",
    subject: "RFP: Enterprise Architecture Monitoring Spec (DOCX)",
    attachmentFiles: ["Case-2-Enterprise-Architecture-Spec.docx"],
    initialBody: [
      "Hello Site24x7 Team,",
      "",
      "Attached is our enterprise architecture specification for IT monitoring.",
      "Please provide an itemized annual proposal.",
      "No basic website checks needed outside the synthetic monitors.",
      "",
      "Regards,",
      "Marcus Vance",
      "Infrastructure Architect, Global Logistics Technologies",
    ].join("\n"),
    followupBody: "We need 70 servers instead of 80, and reduce log ingestion to 1,500 GB per month.\n\nRegards,\nMarcus Vance",
  },
  {
    id: "case-3",
    name: "Case 3: Server Inventory CSV (Partial Scope -> Clarification -> Quote)",
    sender: "priya.nair@cloudscale.io",
    senderName: "Priya Nair",
    subject: "Server Monitoring Sizing Request (CSV Attached)",
    attachmentFiles: ["Case-3-Server-Inventory.csv"],
    initialBody: [
      "Hi Team,",
      "",
      "Please find attached our current server inventory CSV with 20 production nodes.",
      "Can you send us pricing for monitoring these?",
      "",
      "Thanks,",
      "Priya Nair",
      "DevOps, CloudScale",
    ].join("\n"),
    followupBody: [
      "Hi,",
      "",
      "To clarify our full scope: we have 4 network switches, 6 public websites, no synthetic checks, no RUM, and 50 GB logs monthly.",
      "",
      "Thanks,",
      "Priya Nair",
    ].join("\n"),
  },
  {
    id: "case-4",
    name: "Case 4: Hardware Devices Multi-Sheet Excel (XLSX)",
    sender: "david.chen@fintechcore.com",
    senderName: "David Chen",
    subject: "Infrastructure Monitoring Evaluation (Excel Attached)",
    attachmentFiles: ["Case-4-Hardware-Devices-Inventory.xlsx"],
    initialBody: [
      "Hello Site24x7 Team,",
      "",
      "Please find our infrastructure hardware inventory attached in the Excel sheet (25 servers, 8 network switches).",
      "No synthetic checks or RUM needed, 100 GB logs per month, 10 websites.",
      "",
      "Best regards,",
      "David Chen",
      "VP Infrastructure, FinTech Core",
    ].join("\n"),
    followupBody: "Could you update this estimate to 35 servers and 12 network devices instead?\n\nThanks,\nDavid Chen",
  },
  {
    id: "case-5",
    name: "Case 5: Multi-Attachment Scope (PDF Spec + CSV Server Roster)",
    sender: "sarah.jenkins@nexussystems.com",
    senderName: "Sarah Jenkins",
    subject: "Consolidated Quote Request: Infra Scope (PDF) + Server List (CSV)",
    attachmentFiles: ["Case-1-Production-Infrastructure.pdf", "Case-3-Server-Inventory.csv"],
    initialBody: [
      "Hi Site24x7 Team,",
      "",
      "We are submitting both our scope summary PDF and our detailed server roster CSV for unified quoting.",
      "No other monitoring needed.",
      "",
      "Best,",
      "Sarah Jenkins",
      "IT Procurement, Nexus Systems",
    ].join("\n"),
    followupBody: "Please remove all network devices from this quote.\n\nThanks,\nSarah Jenkins",
  },
  {
    id: "case-6",
    name: "Case 6: Edge Case — Scanned / Image-Only PDF (Graceful Fallback)",
    sender: "robert.taylor@legacyops.org",
    senderName: "Robert Taylor",
    subject: "Quote Request: Scanned PO Document (Image Only Test)",
    attachmentFiles: ["Case-5-Scanned-Image-Only.pdf"],
    initialBody: [
      "Hi,",
      "",
      "We are attaching our scanned purchase requisition PDF.",
      "In case the scan is low-contrast: we need coverage for 15 Linux Servers, 3 Web Endpoints, no network devices, no synthetic checks, no RUM, and 150 GB logs monthly.",
      "",
      "Thanks,",
      "Robert Taylor",
      "Operations Lead, LegacyOps",
    ].join("\n"),
    followupBody: "Actually, please adjust the estimate to 25 servers.\n\nThanks,\nRobert Taylor",
  },
];

async function runScenario(tc: TestCase) {
  console.log(`\n================================================================================`);
  console.log(`RUNNING: ${tc.name}`);
  console.log(`================================================================================`);

  // Load attachments
  const attachments = [];
  for (const filename of tc.attachmentFiles) {
    const filePath = path.join(ATTACHMENTS_DIR, filename);
    const buffer = await fs.readFile(filePath);
    attachments.push({
      filename,
      contentType: filename.endsWith(".pdf")
        ? "application/pdf"
        : filename.endsWith(".docx")
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : filename.endsWith(".csv")
        ? "text/csv"
        : filename.endsWith(".xlsx")
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/plain",
      content: buffer,
      sizeBytes: buffer.length,
    });
  }

  // --- 1. INITIAL INBOUND EMAIL ---
  const initialPayload = {
    providerMessageId: `msg_${tc.id}_init_${Date.now()}`,
    from: tc.sender,
    fromName: tc.senderName,
    to: ["quotes@quotes.joanathan.in"],
    subject: tc.subject,
    text: tc.initialBody,
    attachments,
  };

  console.log(`\n--- Step 1: Processing Initial Email from ${tc.senderName} <${tc.sender}> ---`);
  const initResult = await processInboundEmail(initialPayload);

  console.log(`Action Taken: ${initResult.actionTaken}`);
  console.log(`Thread ID: ${initResult.threadId}`);

  // Fetch initial outbound email
  const threadMsgs1 = store.getMessages(initResult.threadId);
  const outbound1 = [...threadMsgs1].reverse().find((m) => m.direction === "outbound");

  if (initResult.quote) {
    const q1 = initResult.quote;
    const bv1 = q1.options.find((o) => o.optionType === "best_value") || q1.options[0];
    console.log(`Initial Quote ID: ${q1.id} (Version ${q1.version || 1})`);
    console.log(`Plan: ${bv1?.planName} | Total: ₹${((bv1?.total || 0) / 100).toLocaleString("en-IN")}`);
    console.log(`Line Items:`);
    for (const li of bv1?.lineItems || []) {
      console.log(`  - ${li.description} | Qty: ${li.quantity} | Total: ₹${(li.lineTotal / 100).toLocaleString("en-IN")}`);
    }
  } else if (initResult.actionTaken === "clarification_requested") {
    console.log(`Clarification Requested (Partial Scope):`);
    const prof = store.getProfile(initResult.threadId);
    for (const q of prof?.pendingQuestions || []) {
      console.log(`  ? ${q}`);
    }
  }

  if (outbound1) {
    console.log(`\n[INITIAL OUTBOUND DISPATCHED EMAIL]`);
    console.log(`Subject: ${outbound1.subject}`);
    console.log(`Body:\n${outbound1.bodyText.trim()}`);
  }

  // --- 2. FOLLOW-UP REPLY IN SAME THREAD ---
  console.log(`\n--- Step 2: Processing Buyer Follow-up in Thread ${initResult.threadId} ---`);
  const followupPayload = {
    providerMessageId: `msg_${tc.id}_followup_${Date.now()}`,
    from: tc.sender,
    fromName: tc.senderName,
    to: ["quotes@quotes.joanathan.in"],
    subject: `Re: ${tc.subject}`,
    headers: {
      "in-reply-to": outbound1?.providerMessageId || `<msg_${Date.now()}@quote24x7.com>`,
      references: outbound1?.providerMessageId || `<msg_${Date.now()}@quote24x7.com>`,
    },
    text: tc.followupBody,
  };

  const followResult = await processInboundEmail(followupPayload);
  console.log(`Follow-up Action Taken: ${followResult.actionTaken}`);

  const threadMsgs2 = store.getMessages(initResult.threadId);
  const outbound2 = [...threadMsgs2].reverse().find((m) => m.direction === "outbound" && m.id !== outbound1?.id);

  if (followResult.quote) {
    const q2 = followResult.quote;
    const bv2 = q2.options.find((o) => o.optionType === "best_value") || q2.options[0];
    console.log(`Follow-up Quote ID: ${q2.id} (Version ${q2.version || 2})`);
    console.log(`Plan: ${bv2?.planName} | Total: ₹${((bv2?.total || 0) / 100).toLocaleString("en-IN")}`);
    console.log(`Line Items:`);
    for (const li of bv2?.lineItems || []) {
      console.log(`  - ${li.description} | Qty: ${li.quantity} | Total: ₹${(li.lineTotal / 100).toLocaleString("en-IN")}`);
    }

    if (initResult.quote) {
      const storedV1 = store.getQuote(initResult.quote.id);
      console.log(`V1 Quote (${initResult.quote.id}) Status: ${storedV1?.status} (supersededBy: ${storedV1?.supersededBy})`);
    }
  }

  if (outbound2) {
    console.log(`\n[FOLLOW-UP OUTBOUND DISPATCHED EMAIL]`);
    console.log(`Subject: ${outbound2.subject}`);
    console.log(`Body:\n${outbound2.bodyText.trim()}`);
  }
}

async function main() {
  await store.ensureInitializedAsync();
  console.log("================================================================================");
  console.log("EXECUTING ALL TEST CASES WITH ATTACHMENTS & FOLLOW-UPS");
  console.log("================================================================================");

  for (const tc of TEST_CASES) {
    await runScenario(tc);
  }

  console.log("\n================================================================================");
  console.log("ALL TEST CASES EXECUTED SUCCESSFULLY");
  console.log("================================================================================");
}

main().catch(console.error);
