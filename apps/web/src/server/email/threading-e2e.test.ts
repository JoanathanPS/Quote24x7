/**
 * Item 7 — Email threading end-to-end tests with a FakeResendProvider.
 *
 * These tests prove that the chain guarantees (single Gmail thread per buyer
 * conversation, RFC 2822 thread tokens, no provider UUID leaks) hold across a
 * realistic 9-turn conversation and across five targeted edge cases.
 *
 * The fake Resend client replaces the live HTTP SDK for the duration of each
 * test. It emits real RFC 2822 message-ids on `emails.get()` so the dispatcher's
 * "fetch the real id" path runs end-to-end without a network call. Every test
 * ends with `uninstallFakeResendProvider()` so test isolation is structural, not
 * reliant on order.
 *
 * Determinism:
 *   - The AI provider is disabled in tests (DISABLE_AI + isTestRuntime gates).
 *     All decisions come from the deterministic rules engine.
 *   - Threads/messages are scoped with `Date.now()` ids and reset between tests
 *     via `store.reset()`.
 *   - No network, no Supabase, no Gemini calls.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { processInboundEmail } from "./inbound-processor.ts";
import { store } from "../store/session-store.ts";
import {
  buildThreadingHeaders,
  resolveThreadSubject,
} from "./resend-outbound.ts";
import { extractMessageIds, normalizeRfcMessageId } from "./rfc-message-id.ts";
import {
  installFakeResendProvider,
  uninstallFakeResendProvider,
  getFakeSentMessages,
  type FakeSendRecord,
} from "./fake-resend-provider.ts";

const RFC_TOKEN_RE = /^<[^<>\s]+@[^<>\s]+>$/;

function makeRfcId(label: string, n: number): string {
  return `<${label}.${n}.${Date.now()}@buyer.example.com>`;
}

function makeProviderId(label: string, n: number): string {
  return `provider_${label}_${n}_${Date.now()}`;
}

function assertAllHeadersRfcToken(records: FakeSendRecord[]): void {
  for (const rec of records) {
    const headers = rec.headers ?? {};
    for (const [name, value] of Object.entries(headers)) {
      const tokens = extractMessageIds(value);
      assert.ok(
        tokens.length > 0,
        `Outbound ${rec.id} header ${name} must contain at least one <local@domain> token, got: ${value}`
      );
      for (const tok of tokens) {
        assert.match(
          tok,
          RFC_TOKEN_RE,
          `Outbound ${rec.id} header ${name} produced invalid token ${tok}`
        );
      }
    }
  }
}

function assertNoProviderUuidInHeaders(records: FakeSendRecord[]): void {
  for (const rec of records) {
    const headers = rec.headers ?? {};
    for (const [name, value] of Object.entries(headers)) {
      for (const raw of String(value).split(/\s+/)) {
        if (raw.length === 0) continue;
        const looksLikeProviderId = !raw.startsWith("<") && !raw.includes("@");
        assert.equal(
          looksLikeProviderId,
          false,
          `Outbound ${rec.id} header ${name} contains non-RFC token "${raw}"`
        );
      }
    }
  }
}

function reset(): void {
  store.reset();
}

test("FakeResendProvider seam produces real RFC message-ids and dispatches end-to-end", async (t) => {
  reset();
  installFakeResendProvider();
  t.after(() => uninstallFakeResendProvider());

  const result = await processInboundEmail({
    providerMessageId: makeProviderId("seam", 1),
    messageId: makeRfcId("seam", 1),
    from: `seam_${Date.now()}@example.com`,
    fromName: "Seam Tester",
    to: ["quotes@quotes.joanathan.in"],
    subject: "Seam check",
    text: "20 Linux servers, 3 websites, no other monitoring, annual billing.",
  });

  assert.equal(result.actionTaken, "quoted");
  const sent = getFakeSentMessages();
  assert.ok(sent.length >= 1, "fake should have received at least one send");

  const out = store
    .getMessages(result.threadId)
    .find((m) => m.direction === "outbound");
  assert.ok(out);
  assert.ok(
    out.messageIdHeader,
    "outbound messageIdHeader must be set after dispatch in live-mode fake"
  );
  assert.match(out.messageIdHeader!, RFC_TOKEN_RE);
  assert.equal(out.messageIdHeader, sent[0]!.messageId);
});

test("FakeResendProvider 9-turn scripted conversation: single thread, identical subjects, valid chain tokens", async (t) => {
  reset();
  installFakeResendProvider();
  t.after(() => uninstallFakeResendProvider());

  const senderEmail = `conv9_${Date.now()}@example.com`;
  const originalSubject = "Quote for Site24x7 monitoring";

  async function inbound(opts: {
    providerN: number;
    rfcN: number;
    text: string;
    inReplyToRfc?: string;
    referencesChain?: string[];
    subjectOverride?: string;
  }) {
    const subject = opts.subjectOverride ?? `Re: ${originalSubject}`;
    return processInboundEmail({
      providerMessageId: makeProviderId("c9", opts.providerN),
      messageId: makeRfcId("c9", opts.rfcN),
      from: senderEmail,
      fromName: "Buyer",
      to: ["quotes@quotes.joanathan.in"],
      subject,
      text: opts.text,
      headers: {
        "In-Reply-To": opts.inReplyToRfc ?? "",
        References: (opts.referencesChain ?? []).join(" "),
      },
    });
  }

  // Turn 1
  const turn1 = await inbound({
    providerN: 1,
    rfcN: 1,
    text: "Hello, we need Site24x7 monitoring for 20 Linux servers. What would this cost us?",
  });
  const threadId = turn1.threadId;
  const firstOutbound = getFakeSentMessages()[0];
  assert.ok(firstOutbound, "first turn should have produced an outbound");
  const firstOutboundRfc = firstOutbound.messageId;

  // Turn 2
  const turn2 = await inbound({
    providerN: 2,
    rfcN: 2,
    text: "We also need monitoring for 3 websites. No other capabilities right now. Annual billing.",
    inReplyToRfc: firstOutboundRfc,
    referencesChain: [makeRfcId("c9", 1), firstOutboundRfc],
  });
  assert.equal(turn2.threadId, threadId);

  const secondOutbound = getFakeSentMessages().slice(-1)[0]!;

  // Turn 3
  const turn3 = await inbound({
    providerN: 3,
    rfcN: 3,
    text: "Annual is fine. Please send the quote.",
    inReplyToRfc: secondOutbound.messageId,
    referencesChain: [
      makeRfcId("c9", 1),
      firstOutboundRfc,
      makeRfcId("c9", 2),
      secondOutbound.messageId,
    ],
  });
  assert.equal(turn3.threadId, threadId);

  const thirdOutbound = getFakeSentMessages().slice(-1)[0]!;

  // Turn 4: change request (more servers)
  const turn4 = await inbound({
    providerN: 4,
    rfcN: 4,
    text: "Actually we miscounted; please revise to 30 servers instead of 20.",
    inReplyToRfc: thirdOutbound.messageId,
    referencesChain: [],
  });
  assert.equal(turn4.threadId, threadId);

  // Turn 5: discount ask
  const turn5 = await inbound({
    providerN: 5,
    rfcN: 5,
    text: "Can you offer a 10% discount if we sign this quarter?",
    subjectOverride: `Re: ${originalSubject}`,
  });
  assert.equal(turn5.threadId, threadId);

  // Turn 6: buyer accepts
  const turn6 = await inbound({
    providerN: 6,
    rfcN: 6,
    text: "I accept the revised quote. Please proceed.",
    subjectOverride: `Re: ${originalSubject}`,
  });
  assert.equal(turn6.threadId, threadId);

  // ===== Invariants =====

  const allThreads = store.getThreads();
  const buyerThreads = allThreads.filter((t) => t.senderEmail.includes("conv9_"));
  assert.equal(buyerThreads.length, 1, "buyer must be on exactly one thread");

  const outboundMessages = store
    .getMessages(threadId)
    .filter((m) => m.direction === "outbound");
  assert.ok(outboundMessages.length >= 1);
  for (const m of outboundMessages) {
    assert.equal(
      m.subject,
      `Re: ${originalSubject}`,
      `every outbound subject must be "Re: <original>"; got ${m.subject}`
    );
  }

  const sent = getFakeSentMessages();
  assert.ok(sent.length >= 1);
  assertAllHeadersRfcToken(sent);

  for (const rec of sent) {
    const headers = rec.headers ?? {};
    const tokenList: string[] = [
      ...extractMessageIds(headers["In-Reply-To"]),
      ...extractMessageIds(headers["References"]),
    ];
    for (const tok of tokenList) {
      assert.match(tok, RFC_TOKEN_RE, `chain token must be <local@domain>: ${tok}`);
    }
  }

  assertNoProviderUuidInHeaders(sent);

  const inboundMessages = store
    .getMessages(threadId)
    .filter((m) => m.direction === "inbound");
  for (let i = 0; i < inboundMessages.length; i++) {
    const m = inboundMessages[i]!;
    if (i === 0) {
      assert.equal(m.threadMatchMethod, "new");
    } else {
      assert.ok(
        m.threadMatchMethod && m.threadMatchMethod !== "new",
        `inbound #${i + 1} must record a non-"new" threadMatchMethod, got ${m.threadMatchMethod}`
      );
    }
  }
});

test("Alias fallback: buyer echoes an id we did not send, still resolves", async (t) => {
  reset();
  installFakeResendProvider();
  t.after(() => uninstallFakeResendProvider());

  const senderEmail = `alias_${Date.now()}@example.com`;
  const originalSubject = "Alias fallback check";

  const turn1 = await processInboundEmail({
    providerMessageId: makeProviderId("alias", 1),
    messageId: makeRfcId("alias", 1),
    from: senderEmail,
    fromName: "Buyer",
    to: ["quotes@quotes.joanathan.in"],
    subject: originalSubject,
    text: "We need 10 servers, no other monitoring, annual.",
  });
  const threadId = turn1.threadId;

  const clientAlteredId = `<altered.${Date.now()}@client.example.com>`;
  const turn2 = await processInboundEmail({
    providerMessageId: makeProviderId("alias", 2),
    messageId: `<forwarded.${Date.now()}@buyer.example.com>`,
    from: senderEmail,
    fromName: "Buyer",
    to: ["quotes@quotes.joanathan.in"],
    subject: `Re: ${originalSubject}`,
    text: "Confirming the same. Please proceed.",
    headers: {
      "In-Reply-To": clientAlteredId,
      References: clientAlteredId,
    },
  });
  assert.equal(
    turn2.threadId,
    threadId,
    "buyer reply with a forwarded Message-ID must still resolve to the same thread"
  );

  const inbound2 = store
    .getMessages(threadId)
    .filter((m) => m.direction === "inbound")
    .slice(-1)[0]!;
  assert.ok(inbound2.threadMatchMethod);
  assert.ok(inbound2.threadMatchMethod !== "new");

  for (const sent of getFakeSentMessages()) {
    const hdrs = sent.headers ?? {};
    const tokens = [
      ...extractMessageIds(hdrs["In-Reply-To"]),
      ...extractMessageIds(hdrs["References"]),
    ];
    for (const tok of tokens) {
      assert.match(tok, RFC_TOKEN_RE);
    }
  }
});

test("Subject fallback: inbound with no In-Reply-To and a Re: subject still attaches", async (t) => {
  reset();
  installFakeResendProvider();
  t.after(() => uninstallFakeResendProvider());

  const senderEmail = `subj_${Date.now()}@example.com`;
  const subject = "Subject fallback scenario";

  const turn1 = await processInboundEmail({
    providerMessageId: makeProviderId("subj", 1),
    messageId: makeRfcId("subj", 1),
    from: senderEmail,
    fromName: "Buyer",
    to: ["quotes@quotes.joanathan.in"],
    subject,
    text: "Hi, we need monitoring for 25 Linux servers, no other capabilities, annual billing.",
  });
  const threadId = turn1.threadId;

  const turn2 = await processInboundEmail({
    providerMessageId: makeProviderId("subj", 2),
    messageId: makeRfcId("subj", 2),
    from: senderEmail,
    fromName: "Buyer",
    to: ["quotes@quotes.joanathan.in"],
    subject: `Re: ${subject}`,
    text: "Please send the quote. Same details as before.",
    headers: {
      "In-Reply-To": "",
      References: "",
    },
  });
  assert.equal(
    turn2.threadId,
    threadId,
    "buyer with only a Re: subject (no In-Reply-To) must attach via subject fallback"
  );

  const inbound2 = store
    .getMessages(threadId)
    .filter((m) => m.direction === "inbound")
    .slice(-1)[0]!;
  assert.ok(inbound2.threadMatchMethod);
  assert.ok(
    inbound2.threadMatchMethod === "subject_fallback" ||
      inbound2.threadMatchMethod === "in_reply_to" ||
      inbound2.threadMatchMethod === "alias",
    `expected subject_fallback/in_reply_to/alias, got ${inbound2.threadMatchMethod}`
  );
});

test("Header parsing never throws on array, missing, mixed-case, or malformed values", async (t) => {
  reset();
  installFakeResendProvider();
  t.after(() => uninstallFakeResendProvider());

  const senderEmail = `hdrs_${Date.now()}@example.com`;
  const subject = "Header fuzz scenario";

  await processInboundEmail({
    providerMessageId: makeProviderId("hdrs", 1),
    messageId: makeRfcId("hdrs", 1),
    from: senderEmail,
    fromName: "Buyer",
    to: ["quotes@quotes.joanathan.in"],
    subject,
    text: "20 Linux servers, no other monitoring, annual.",
  });

  const garbageInputs: Array<{
    label: string;
    headers: Record<string, string | string[]> | undefined;
  }> = [
    {
      label: "lowercase in-reply-to with mixed case",
      headers: {
        "in-reply-to": makeRfcId("hdrs", 9),
        references: "<x@y>",
      },
    },
    {
      label: "array values",
      headers: {
        "In-Reply-To": [makeRfcId("hdrs", 10), "garbage"],
        References: [makeRfcId("hdrs", 11)],
      },
    },
    {
      label: "missing headers entirely",
      headers: undefined,
    },
    {
      label: "malformed tokens in values",
      headers: {
        "In-Reply-To": "not-a-token <half@ <also-not a@b",
        References: "<@> <a@b> <@@>",
      },
    },
    {
      label: "empty / null mix",
      headers: {
        "In-Reply-To": "",
        References: [""],
      },
    },
  ];

  let pid = 2;
  for (const g of garbageInputs) {
    const result = await processInboundEmail({
      providerMessageId: makeProviderId("hdrs", pid++),
      messageId: makeRfcId("hdrs", 100 + pid),
      from: senderEmail,
      fromName: "Buyer",
      to: ["quotes@quotes.joanathan.in"],
      subject: `Re: ${subject}`,
      text: `Test ${g.label} reply. Same details: 20 servers, annual.`,
      headers: g.headers,
    });
    assert.ok(result, `garbage input "${g.label}" must not throw`);
    for (const sent of getFakeSentMessages()) {
      const hdrs = sent.headers ?? {};
      for (const value of Object.values(hdrs)) {
        for (const tok of extractMessageIds(value)) {
          assert.match(
            tok,
            RFC_TOKEN_RE,
            `outbound header token must be valid RFC even after garbage input "${g.label}": ${tok}`
          );
        }
      }
    }
  }
});

test("No provider UUID leaks into any outbound header across a multi-turn thread", async (t) => {
  reset();
  installFakeResendProvider();
  t.after(() => uninstallFakeResendProvider());

  const senderEmail = `noleak_${Date.now()}@example.com`;
  const subject = "No-UUID leak scenario";

  await processInboundEmail({
    providerMessageId: makeProviderId("noleak", 1),
    messageId: makeRfcId("noleak", 1),
    from: senderEmail,
    fromName: "Buyer",
    to: ["quotes@quotes.joanathan.in"],
    subject,
    text: "Hello, need 20 Linux servers.",
  });

  await processInboundEmail({
    providerMessageId: makeProviderId("noleak", 2),
    messageId: makeRfcId("noleak", 2),
    from: senderEmail,
    fromName: "Buyer",
    to: ["quotes@quotes.joanathan.in"],
    subject: `Re: ${subject}`,
    text: "We also need 3 websites. No other monitoring. Annual.",
    headers: {
      "In-Reply-To": makeRfcId("noleak", 1),
      References: makeRfcId("noleak", 1),
    },
  });

  const sent = getFakeSentMessages();
  assert.ok(sent.length >= 1);
  assertAllHeadersRfcToken(sent);
  assertNoProviderUuidInHeaders(sent);

  for (const rec of sent) {
    assert.equal(
      rec.subject,
      `Re: ${subject}`,
      `outbound subject must be canonical; got ${rec.subject}`
    );
  }
});

test("Sender with one awaiting_reply thread continues it; a different sender opens a new thread", async (t) => {
  reset();
  installFakeResendProvider();
  t.after(() => uninstallFakeResendProvider());

  const senderA = `await_a_${Date.now()}@example.com`;
  const senderB = `await_b_${Date.now()}@example.com`;
  const subject = "Awaiting reply scenario";

  const turn1 = await processInboundEmail({
    providerMessageId: makeProviderId("await", 1),
    messageId: makeRfcId("await", 1),
    from: senderA,
    fromName: "Sender A",
    to: ["quotes@quotes.joanathan.in"],
    subject,
    text: "Hello, we need 10 servers and 5 websites. Tell me the cost.",
  });
  const threadId = turn1.threadId;

  const turn2A = await processInboundEmail({
    providerMessageId: makeProviderId("await", 2),
    messageId: makeRfcId("await", 2),
    from: senderA,
    fromName: "Sender A",
    to: ["quotes@quotes.joanathan.in"],
    subject: "A new unrelated subject",
    text: "Sorry, sent too soon. The question is about logs as well.",
    headers: undefined,
  });
  assert.equal(
    turn2A.threadId,
    threadId,
    "sender with one awaiting_reply thread must continue it even on a fresh subject"
  );

  const turn2B = await processInboundEmail({
    providerMessageId: makeProviderId("await", 3),
    messageId: makeRfcId("await", 3),
    from: senderB,
    fromName: "Sender B",
    to: ["quotes@quotes.joanathan.in"],
    subject,
    text: "Hi, we also need monitoring for our servers.",
  });
  assert.notEqual(
    turn2B.threadId,
    threadId,
    "a different sender must not be confused with sender A's thread"
  );

  for (const thread of store.getThreads()) {
    for (const m of store.getMessages(thread.id)) {
      if (m.direction !== "outbound") continue;
      assert.ok(
        m.subject.startsWith("Re: "),
        `outbound subject must be "Re: <something>"; got ${m.subject}`
      );
    }
  }
});

test("resolveThreadSubject strips every existing Re: and returns exactly one", () => {
  assert.equal(
    resolveThreadSubject("Site24x7 plan options"),
    "Re: Site24x7 plan options"
  );
  assert.equal(
    resolveThreadSubject("Re: Site24x7 plan options"),
    "Re: Site24x7 plan options"
  );
  assert.equal(
    resolveThreadSubject("Fwd: Re: RE: Site24x7 plan options"),
    "Re: Site24x7 plan options"
  );
});

test("resolveThreadSubject never embeds internal ids (#th_/#qt_) or suffixes", () => {
  const cases = [
    "Site24x7 plan options",
    "Re: Site24x7 plan options",
    "Site24x7 plan options [Ref: #th_abc123]",
    "Site24x7 plan options - Clarification Needed [Ref: #qt_xyz789]",
    "RE: Site24x7 plan options [Ref: #th_xyz] - Quote Sent",
  ];
  for (const c of cases) {
    const out = resolveThreadSubject(c);
    assert.equal(out, `Re: Site24x7 plan options`, `for input "${c}", got "${out}"`);
    assert.ok(!out.includes("#th_"), `Ref tag leaked into ${out}`);
    assert.ok(!out.includes("#qt_"), `Ref tag leaked into ${out}`);
    assert.ok(!/Clarification\s*Needed/i.test(out), `suffix leaked into ${out}`);
    assert.ok(!/Quote\s*Sent/i.test(out), `suffix leaked into ${out}`);
  }
});

test("buildThreadingHeaders against an outbound that already has a real RFC id", () => {
  reset();
  const threadId = `th_chain_${Date.now()}`;
  store.saveThread({
    id: threadId,
    provider: "resend",
    providerThreadId: threadId,
    senderEmail: "buyer@chain.example.com",
    senderName: "Buyer",
    organisation: null,
    subject: "Chain test",
    status: "awaiting_reply",
    requestType: "quote",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
    messageCount: 1,
    quoteId: null,
    quoteTotal: null,
    currency: "INR",
    statusDetail: null,
  });

  const inboundRfc = `<inb1.${Date.now()}@buyer.example.com>`;
  store.addMessage({
    id: `msg_${Date.now()}_1`,
    threadId,
    providerMessageId: `prov_${Date.now()}_1`,
    messageIdHeader: inboundRfc,
    direction: "inbound",
    fromAddress: "buyer@chain.example.com",
    fromName: "Buyer",
    toAddresses: ["quotes@quotes.joanathan.in"],
    subject: "Chain test",
    bodyText: "20 servers, no other monitoring.",
    occurredAt: new Date().toISOString(),
    deliveryId: null,
    securityNotes: [],
    attachments: [],
  });

  const headers = buildThreadingHeaders(threadId);
  assert.equal(headers.inReplyTo, inboundRfc);
  assert.equal(headers.references, inboundRfc);
  assert.equal(headers.headers["Message-ID"], undefined);
  assert.equal(headers.headers["In-Reply-To"], inboundRfc);
  assert.equal(headers.headers["References"], inboundRfc);
});

test("extractMessageIds rejects provider UUIDs and other non-tokens", () => {
  const uuid = "7e410824-1234-4d5e-9f00-abc123";
  assert.deepEqual(extractMessageIds(uuid), []);
  assert.deepEqual(extractMessageIds(""), []);
  assert.deepEqual(extractMessageIds(undefined), []);
  assert.deepEqual(extractMessageIds(null), []);
  assert.deepEqual(
    extractMessageIds(`<a@b> <c@d> <${uuid}>`),
    ["<a@b>", "<c@d>"],
    "provider UUID without @ must be dropped"
  );
});

test("normalizeRfcMessageId wraps bare local@domain tokens and rejects the rest", () => {
  assert.equal(normalizeRfcMessageId("<a@b>"), "<a@b>");
  assert.equal(normalizeRfcMessageId("a@b"), "<a@b>");
  assert.equal(normalizeRfcMessageId("7e410824-no-at"), null);
  assert.equal(normalizeRfcMessageId(""), null);
  assert.equal(normalizeRfcMessageId("just-text"), null);
});

test("Threading: Inbound with In-Reply-To matching our outbound RFC Message-ID resolves to in_reply_to, unrelated ID falls back to subject_fallback", async (t) => {
  reset();
  installFakeResendProvider();
  t.after(() => uninstallFakeResendProvider());

  const senderEmail = `rfc_thread_${Date.now()}@testcorp.example.com`;
  const subject = "Infrastructure Quote Sizing";

  // Turn 1: Initial inbound inquiry
  const turn1 = await processInboundEmail({
    providerMessageId: makeProviderId("rfc_test", 1),
    messageId: makeRfcId("rfc_test", 1),
    from: senderEmail,
    fromName: "DevOps Lead",
    to: ["quotes@quotes.joanathan.in"],
    subject,
    text: "We need monitoring for 20 servers. No other monitoring needed.",
  });

  assert.equal(turn1.actionTaken, "quoted");
  const thread = store.getThread(turn1.threadId);
  assert.ok(thread);

  // Retrieve our outbound message and its real RFC Message-ID
  const messages = store.getMessages(turn1.threadId);
  const outbound1 = messages.find((m) => m.direction === "outbound");
  assert.ok(outbound1, "Outbound quote email must be recorded");
  assert.ok(outbound1.messageIdHeader, "Outbound message must carry a real RFC Message-ID");
  const ourOutboundRfcId = outbound1.messageIdHeader;

  // Scenario A: Follow-up carrying our exact outbound RFC Message-ID in In-Reply-To
  const turn2A = await processInboundEmail({
    providerMessageId: makeProviderId("rfc_test", 2),
    messageId: makeRfcId("rfc_test", 2),
    from: senderEmail,
    fromName: "DevOps Lead",
    to: ["quotes@quotes.joanathan.in"],
    subject: `Re: ${subject}`,
    headers: {
      "in-reply-to": ourOutboundRfcId,
      references: ourOutboundRfcId,
    },
    text: "Adjust to 25 servers please.",
  });

  assert.equal(turn2A.threadId, turn1.threadId, "Must match existing thread");
  const msgsAfterA = store.getMessages(turn1.threadId);
  const inbound2A = msgsAfterA.find((m) => m.providerMessageId.includes("rfc_test.2") || m.providerMessageId.includes("rfc_test_2"));
  assert.ok(inbound2A);
  assert.equal(inbound2A.threadMatchMethod, "in_reply_to", "Matching our outbound RFC Message-ID must resolve via in_reply_to");

  // Scenario B: Follow-up from same sender with UNRELATED/bogus In-Reply-To falls back to subject_fallback
  const turn2B = await processInboundEmail({
    providerMessageId: makeProviderId("rfc_test", 3),
    messageId: makeRfcId("rfc_test", 3),
    from: senderEmail,
    fromName: "DevOps Lead",
    to: ["quotes@quotes.joanathan.in"],
    subject: `Re: ${subject}`,
    headers: {
      "in-reply-to": "<completely-unrelated-id@randomdomain.com>",
      references: "<completely-unrelated-id@randomdomain.com>",
    },
    text: "Actually make it 30 servers.",
  });

  assert.equal(turn2B.threadId, turn1.threadId, "Must match existing thread via subject fallback");
  const msgsAfterB = store.getMessages(turn1.threadId);
  const inbound2B = msgsAfterB.find((m) => m.providerMessageId.includes("rfc_test.3") || m.providerMessageId.includes("rfc_test_3"));
  assert.ok(inbound2B);
  assert.equal(inbound2B.threadMatchMethod, "subject_fallback", "Unrelated In-Reply-To must gracefully fall back to subject_fallback");
});
