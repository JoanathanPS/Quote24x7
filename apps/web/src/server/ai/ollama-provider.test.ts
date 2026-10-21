import test from "node:test";
import assert from "node:assert/strict";

import {
  createOllamaClient,
  extractCleanJson,
  ollamaProvider,
  pingOllama,
} from "./ollama-provider.ts";
import { store } from "../store/session-store.ts";
import { decideNextAction, type SalesEngineerInput } from "./sales-engineer.ts";
import { loadActiveCatalogue } from "../catalogue/loader.ts";
import type { AiProvider, AiProviderResult } from "./gemini-provider.ts";
import type { EmailThread } from "@/types/domain";

test("Ollama Provider: creates OpenAI client with local baseURL and placeholder apiKey", () => {
  const client = createOllamaClient();
  assert.ok(client, "OpenAI client instance should be created");
  assert.equal(client.apiKey, "ollama-local-key");
  assert.equal(client.baseURL, "http://localhost:11434/v1");
  assert.equal(ollamaProvider.name, "ollama");
});

test("Ollama Provider: extractCleanJson strips markdown fences and surrounding text", () => {
  const markdownWrapped = `
Here is your JSON quotation sizing:
\`\`\`json
{
  "recommendedPlanId": "web_uptime",
  "action": "prepare_quote",
  "quantities": {
    "basic_monitor": 25
  }
}
\`\`\`
Hope this helps!
`;
  const cleaned = extractCleanJson(markdownWrapped);
  assert.ok(!cleaned.startsWith("Here is your"), "Should strip leading conversational text");
  assert.ok(!cleaned.includes("```"), "Should strip markdown fences");
  const parsed = JSON.parse(cleaned);
  assert.equal(parsed.recommendedPlanId, "web_uptime");
  assert.equal(parsed.action, "prepare_quote");
  assert.equal(parsed.quantities.basic_monitor, 25);
});

test("Ollama Provider: extractCleanJson handles pure JSON directly", () => {
  const pureJson = '{"action":"ask_follow_up","missingRequirements":["host_monitor"]}';
  assert.equal(extractCleanJson(pureJson), pureJson);
});

test("Ollama Provider: pingOllama handles unreachable engine gracefully with helpful message", async () => {
  // Pinging non-existent port
  const res = await pingOllama("http://localhost:59999/v1");
  assert.equal(res.ok, false);
  assert.equal(res.configuredModel, "llama3.2:1b");
  assert.ok(
    res.error?.includes("not running") || res.error?.includes("ECONNREFUSED") || res.error?.includes("fetch failed"),
    `Expected connection failure message, got: ${res.error}`,
  );
});

test("Sales Engineer: records source 'ollama' when Ollama provider is selected", async () => {
  const catalogue = loadActiveCatalogue();
  const thread = {
    id: "th_test_ollama",
    subject: "Need server monitoring quote",
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
    status: "quoted" as const,
    customerId: "cust_test",
  } as unknown as EmailThread;

  const input: SalesEngineerInput = {
    thread,
    latestMessageText: "We need to monitor 20 Linux servers and 5 public URLs. No logs, no synthetics, no network devices.",
    cumulativeText: "We need to monitor 20 Linux servers and 5 public URLs. No logs, no synthetics, no network devices.",
    priorMessages: [],
    existingProfile: undefined,
    catalogue,
    senderEmail: "daniel@example.com",
    senderName: "Daniel",
    subject: "Need server monitoring quote",
  };

  // Mock Ollama provider that outputs valid decision
  const mockOllamaProvider: AiProvider = {
    name: "ollama",
    async generateDecision(): Promise<AiProviderResult> {
      return {
        ok: true,
        decision: {
          action: "prepare_quote",
          customerSummary: "Customer needs monitoring for 20 Linux servers and 5 public URLs with zero other services.",
          identifiedNeeds: ["Server monitoring", "Website monitoring"],
          knownRequirements: [
            { unit: "host_monitor", quantity: 20, basis: "stated", evidence: "20 Linux servers", confidence: 1.0 },
            { unit: "basic_monitor", quantity: 5, basis: "stated", evidence: "5 public URLs", confidence: 1.0 },
          ],
          missingRequirements: [],
          assumptions: [],
          recommendedProductCategories: ["infrastructure_monitoring", "website_monitoring"],
          referencedPlanIds: ["infra_professional"],
          followUpQuestions: [],
          humanReviewReasons: [],
          reasoningSummary: "Customer explicitly stated 20 servers and 5 URLs with all other units explicitly closed.",
          confidence: 0.95,
          conversationalResponse: null,
        },
        model: "llama3.2:1b",
        latencyMs: 120,
        attempts: 1,
      };
    },
  };

  const decision = await decideNextAction(input, mockOllamaProvider);

  assert.equal(decision.record.source, "ollama", "Decision source must be recorded as 'ollama'");
  assert.equal(decision.record.model, "llama3.2:1b");
  assert.equal(decision.action, "prepare_quote");
  assert.equal(decision.extraction.demand.host_monitor, 20);
  assert.equal(decision.extraction.demand.basic_monitor, 5);
});

test("Session Store: switches active AI provider between Groq, Ollama, Gemini, and Rules", () => {
  store.setActiveAiProvider("groq");
  assert.equal(store.getActiveAiProvider(), "groq");

  store.setActiveAiProvider("ollama");
  assert.equal(store.getActiveAiProvider(), "ollama");

  store.setActiveAiProvider("gemini");
  assert.equal(store.getActiveAiProvider(), "gemini");

  store.setActiveAiProvider("rules");
  assert.equal(store.getActiveAiProvider(), "rules");

  // Restore default
  store.setActiveAiProvider("groq");
});
