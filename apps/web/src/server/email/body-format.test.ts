import test from "node:test";
import assert from "node:assert/strict";
import { formatEmailBody } from "./body-format.ts";

// The text/plain part Gmail produced for a real inbound request: hard-wrapped
// at 78 columns, and each bullet rendered as a lone "-" then a blank line.
const GMAIL_LIST_EMAIL = [
  "Hi,",
  "",
  "Please provide the best possible pricing for the following exact",
  "requirements:",
  "",
  "   -",
  "",
  "   Servers / Virtual hosts to monitor: 25",
  "   -",
  "",
  "   Basic ping / port / website uptime checks: 40",
  "   -",
  "",
  "   Synthetic transaction / Advanced web monitors: 8",
  "   -",
  "",
  "   Expected monthly RUM pageviews: 500,000",
  "   -",
  "",
  "   Expected monthly AppLogs volume: 10 GB (30-day retention)",
  "   -",
  "",
  "   Preferred billing: Annual",
  "",
  "Please share a clear quotation.",
  "",
  "Thanks,",
].join("\r\n");

test("Body format: Gmail's lone bullet markers become one list, wrapped lines rejoin", () => {
  const { blocks, quoted } = formatEmailBody(GMAIL_LIST_EMAIL);

  assert.deepEqual(blocks, [
    { type: "paragraph", text: "Hi," },
    {
      type: "paragraph",
      text: "Please provide the best possible pricing for the following exact requirements:",
    },
    {
      type: "list",
      ordered: false,
      items: [
        "Servers / Virtual hosts to monitor: 25",
        "Basic ping / port / website uptime checks: 40",
        "Synthetic transaction / Advanced web monitors: 8",
        "Expected monthly RUM pageviews: 500,000",
        "Expected monthly AppLogs volume: 10 GB (30-day retention)",
        "Preferred billing: Annual",
      ],
    },
    { type: "paragraph", text: "Please share a clear quotation." },
    { type: "paragraph", text: "Thanks," },
  ]);
  assert.equal(quoted, null);
});

test("Body format: short deliberate line breaks (sign-offs) are kept", () => {
  const { blocks } = formatEmailBody("Thanks,\nDeepak\nAcme Ltd");
  assert.deepEqual(blocks, [{ type: "paragraph", text: "Thanks,\nDeepak\nAcme Ltd" }]);
});

test("Body format: quoted reply history is separated from the new text", () => {
  const reply = [
    "We have 30 servers now, not 25.",
    "",
    "On Thu, 16 Oct 2026 at 09:30, Quote24x7 Assistant <quotes@quotes.joanathan.in>",
    "wrote:",
    "",
    "> Hi there,",
    "> Thank you for reaching out.",
  ].join("\n");

  const { blocks, quoted } = formatEmailBody(reply);
  assert.deepEqual(blocks, [{ type: "paragraph", text: "We have 30 servers now, not 25." }]);
  assert.ok(quoted?.startsWith("On Thu, 16 Oct 2026"));
  assert.ok(quoted?.includes("> Thank you for reaching out."));
});

test("Body format: numbered items and wrapped item continuations", () => {
  const text = [
    "Requirements:",
    "1. 25 Linux servers running our billing platform across two regions and",
    "   a DR site",
    "2. 3 websites",
  ].join("\n");

  const { blocks } = formatEmailBody(text);
  assert.deepEqual(blocks, [
    { type: "paragraph", text: "Requirements:" },
    {
      type: "list",
      ordered: true,
      items: [
        "25 Linux servers running our billing platform across two regions and a DR site",
        "3 websites",
      ],
    },
  ]);
});

test("Body format: a message that is only quoted text is shown, not hidden", () => {
  const { blocks, quoted } = formatEmailBody("> just a quote");
  assert.equal(quoted, null);
  assert.deepEqual(blocks, [{ type: "paragraph", text: "> just a quote" }]);
});

test("Body format: quotation table is parsed into structured table block and not garbled", () => {
  const rawEmail = [
    "Item | Qty | What it covers | Per year",
    "--------------------------------------------------------------------------------",
    "Professional plan (₹3,990.00/mo x 12months) | 1 | Base entitlements | ₹47,880.00",
    "2 Advanced Monitors add-on pack (annual) | 2 | 2 per pack x 1 | ₹15,390.00",
    "10 Host monitors add-on pack (annual) | 40 | 10 per pack x 4 | ₹1,02,600.00",
    "10 GB Logs Storage for 6 Months add-on pack (annual) | 600 | 10 per pack x 60 | ₹57,000.00",
    "--------------------------------------------------------------------------------",
    "Total | | | ₹2,22,870.00",
    "",
    "Add-on rates reflect the plan-specific per-year pricing from the Zoho Store.",
    "",
    "Your official quotation document (PDF) is attached: Site24x7-estimate-qt_1792488259465.pdf",
  ].join("\n");

  const { blocks } = formatEmailBody(rawEmail);

  assert.equal(blocks.length, 3);
  assert.equal(blocks[0]!.type, "table");

  if (blocks[0]!.type === "table") {
    assert.deepEqual(blocks[0]!.headers, ["Item", "Qty", "What it covers", "Per year"]);
    assert.equal(blocks[0]!.rows.length, 5);
    assert.deepEqual(blocks[0]!.rows[0], [
      "Professional plan (₹3,990.00/mo x 12months)",
      "1",
      "Base entitlements",
      "₹47,880.00",
    ]);
    assert.deepEqual(blocks[0]!.rows[1], [
      "2 Advanced Monitors add-on pack (annual)",
      "2",
      "2 per pack x 1",
      "₹15,390.00",
    ]);
    assert.deepEqual(blocks[0]!.rows[2], [
      "10 Host monitors add-on pack (annual)",
      "40",
      "10 per pack x 4",
      "₹1,02,600.00",
    ]);
    assert.deepEqual(blocks[0]!.rows[3], [
      "10 GB Logs Storage for 6 Months add-on pack (annual)",
      "600",
      "10 per pack x 60",
      "₹57,000.00",
    ]);
    assert.deepEqual(blocks[0]!.rows[4], ["Total", "", "", "₹2,22,870.00"]);
  }

  assert.deepEqual(blocks[1], {
    type: "paragraph",
    text: "Add-on rates reflect the plan-specific per-year pricing from the Zoho Store.",
  });
  assert.deepEqual(blocks[2], {
    type: "paragraph",
    text: "Your official quotation document (PDF) is attached: Site24x7-estimate-qt_1792488259465.pdf",
  });
});

test("Body format: markdown table with pipe separator line", () => {
  const md = [
    "| Feature | Status |",
    "| --- | --- |",
    "| Monitoring | Active |",
    "| Billing | Annual |",
  ].join("\n");

  const { blocks } = formatEmailBody(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.type, "table");
  if (blocks[0]!.type === "table") {
    assert.deepEqual(blocks[0]!.headers, ["Feature", "Status"]);
    assert.deepEqual(blocks[0]!.rows, [
      ["Monitoring", "Active"],
      ["Billing", "Annual"],
    ]);
  }
});
