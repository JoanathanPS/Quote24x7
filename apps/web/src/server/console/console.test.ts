import test from "node:test";
import assert from "node:assert/strict";

import { store } from "../store/session-store.ts";

test("Phase 10 - Console: Health returns measured values without invented jargon", () => {
  store.ensureInitialized();
  const health = store.getHealth();

  // 1. Measured metrics presence
  assert.ok(health.countsByThreadState !== undefined, "Health must include countsByThreadState");
  assert.equal(typeof health.countsByThreadState, "object");
  assert.equal(typeof health.queueDepth, "number", "Health must include queueDepth");
  assert.equal(typeof health.stuckMessagesOver10m, "number", "Health must include stuckMessagesOver10m");
  assert.equal(typeof health.sendingEnabled, "boolean", "Health must report sendingEnabled flag");

  // 2. No invented jargon in component names or details
  for (const comp of health.components) {
    assert.equal(
      comp.name.includes("Vector PDF Proposal Renderer"),
      false,
      "Must not contain 'Vector PDF Proposal Renderer'"
    );
    assert.equal(
      comp.name.includes("capacity points"),
      false,
      "Must not contain 'capacity points'"
    );
    assert.equal(
      comp.name.includes("Mentor Discovery Questions"),
      false,
      "Must not contain 'Mentor Discovery Questions'"
    );
    assert.equal(
      comp.name.includes("Legal Guarantees"),
      false,
      "Must not contain 'Legal Guarantees'"
    );
  }
});

test("Phase 10 - Console: Measured metrics react correctly to thread state changes", () => {
  store.ensureInitialized();
  const initialHealth = store.getHealth();
  const initialReceived = initialHealth.countsByThreadState?.["received"] ?? 0;

  // Record a thread in received state
  store.saveThread({
    id: "th_console_test_1",
    provider: "resend",
    providerThreadId: "msg_console_1",
    senderEmail: "buyer@enterprise.in",
    senderName: "Enterprise Buyer",
    organisation: "Enterprise Co",
    subject: "Pricing inquiry",
    status: "received",
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

  const updatedHealth = store.getHealth();
  assert.equal(
    updatedHealth.countsByThreadState?.["received"],
    initialReceived + 1,
    "countsByThreadState must accurately reflect thread status"
  );
});
