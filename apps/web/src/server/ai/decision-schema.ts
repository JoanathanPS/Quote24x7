import { z } from "zod";

import type { ProductCategory } from "@/types/domain";
import { DEMAND_UNITS } from "../pricing/engine.ts";

/**
 * Structured output contract for the AI sales engineer.
 *
 * This Zod schema is the single source of truth. It is used twice:
 *
 *  1. Converted to JSON Schema and handed to Gemini as `responseJsonSchema`,
 *     so the model is constrained at generation time.
 *  2. Applied to the parsed response, so a model that ignores or drifts from
 *     the schema cannot reach the rest of the application.
 *
 * Nothing commercial lives here. The model reports quantities, gaps and
 * reasoning; it has no field in which to express a price, a discount, a pack
 * size or a total. Those belong to the deterministic engine, so the model
 * cannot influence them even with a perfectly valid response.
 */

/** Monitoring categories the model may recommend. Validated against the catalogue afterwards. */
export const PRODUCT_CATEGORIES = [
  "infrastructure_monitoring",
  "website_monitoring",
  "synthetic_monitoring",
  "application_performance_monitoring",
  "real_user_monitoring",
  "log_management",
  "network_monitoring",
  "msp",
] as const satisfies readonly ProductCategory[];

/**
 * Upper bounds on model-supplied quantities.
 *
 * These are sanity limits, not commercial limits: they stop a hallucinated or
 * injected quantity (10^12 servers) from reaching the pricing engine and
 * producing an absurd total. A genuine request above a bound is not refused —
 * it is routed to human review, where a person can confirm the number.
 */
export const QUANTITY_BOUNDS: Record<(typeof DEMAND_UNITS)[number], number> = {
  basic_monitor: 200_000,
  advanced_monitor: 50_000,
  host_monitor: 100_000,
  network_component: 100_000,
  rum_pageview: 10_000_000_000,
  applog_gb: 1_000_000,
};

const demandUnitSchema = z.enum(DEMAND_UNITS);

const knownRequirementSchema = z.object({
  unit: demandUnitSchema.describe("Which billable Site24x7 unit this quantity refers to."),
  quantity: z
    .number()
    .int()
    .min(0)
    .describe("Whole number of units. Convert TB to GB and '2 million' to 2000000 before answering."),
  basis: z
    .enum(["stated", "inferred"])
    .describe("'stated' if the customer gave this number; 'inferred' if you derived it from their description."),
  evidence: z
    .string()
    .max(400)
    .describe("Short verbatim quote from the customer's email that supports this quantity."),
  confidence: z.number().min(0).max(1).describe("How confident you are in this quantity."),
});

const missingRequirementSchema = z.object({
  unit: demandUnitSchema.describe("The unit whose quantity is unknown."),
  whyItMatters: z
    .string()
    .max(300)
    .describe("One sentence on how this gap changes the configuration or the price."),
  blocksPricing: z
    .boolean()
    .describe(
      "True only if a quote cannot be produced without it. False if the customer implied they do not need this capability at all.",
    ),
});

export const aiDecisionSchema = z.object({
  action: z
    .enum(["ask_follow_up", "prepare_quote", "human_review"])
    .describe(
      "ask_follow_up: a materially price-affecting quantity is unknown. prepare_quote: enough is known to size a configuration. human_review: the request needs a human (commercial terms, unsupported product, contradictory or implausible requirements).",
    ),
  customerSummary: z
    .string()
    .min(1)
    .max(600)
    .describe("Two or three sentences describing this customer's environment and goal, in plain business language."),
  identifiedNeeds: z
    .array(z.string().max(200))
    .max(12)
    .describe("The monitoring needs you identified, phrased for the customer."),
  knownRequirements: z
    .array(knownRequirementSchema)
    .max(12)
    .describe("Every quantity you know, whether stated outright or inferred. Omit units the customer does not need."),
  missingRequirements: z
    .array(missingRequirementSchema)
    .max(12)
    .default([])
    .describe("Quantities that are genuinely unknown. Never list a unit that already appears in knownRequirements."),
  assumptions: z
    .array(z.string().max(300))
    .max(10)
    .default([])
    .describe("Assumptions you made that the customer should be able to check and correct."),
  recommendedProductCategories: z
    .array(z.enum(PRODUCT_CATEGORIES))
    .max(8)
    .default([])
    .describe("Monitoring categories this customer needs. Only categories the supplied catalogue supports."),
  referencedPlanIds: z
    .array(z.string().max(80))
    .max(6)
    .default([])
    .describe("Plan ids from the supplied catalogue that look like a fit. Advisory only; the pricing engine ranks plans itself."),
  followUpQuestions: z
    .array(z.string().max(300))
    .max(4)
    .default([])
    .describe(
      "Only questions whose answers change the configuration or price. Empty unless action is ask_follow_up. Never ask for anything already in knownRequirements or in the conversation history. Never ask for a budget.",
    ),
  reasoningSummary: z
    .string()
    .min(1)
    .max(900)
    .describe("A concise, auditable explanation of why you chose this action. Conclusions, not deliberation."),
  confidence: z.number().min(0).max(1).describe("Your overall confidence in this decision."),
  humanReviewReasons: z
    .array(z.string().max(300))
    .max(6)
    .default([])
    .describe("Why a human is needed. Empty unless action is human_review."),
  conversationalResponse: z
    .string()
    .max(800)
    .nullable()
    .optional()
    .describe(
      "If the customer asked a general or product question (e.g. 'What is the use of your product?', 'What does Site24x7 do?'), provide a direct, friendly 1-3 sentence explanation here. Null or omitted if they did not ask any questions.",
    ),
});

export type AiDecisionOutput = z.infer<typeof aiDecisionSchema>;

/**
 * JSON Schema handed to Gemini.
 *
 * Two classes of keyword are removed:
 *
 *  - Keywords the Gemini API rejects outright in a response schema
 *    (`$schema`, `additionalProperties`).
 *  - Value constraints that make constrained decoding infeasible. Gemini
 *    compiles a response schema into a state machine, and numeric bounds in
 *    particular explode it — `z.number().int()` alone emits a 53-bit
 *    minimum/maximum pair. Sending those produces:
 *    "The specified schema produces a constraint that has too many states for
 *    serving."
 *
 * Dropping them costs nothing: `type`, `enum`, `required` and the per-field
 * descriptions still shape generation, and `aiDecisionSchema` re-applies every
 * bound to the response before it can reach the application. The constraints
 * are enforced, just on the way in rather than during decoding.
 */
export function buildResponseJsonSchema(): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(aiDecisionSchema, { target: "draft-7" }) as Record<string, unknown>;
  return stripUnsupportedKeywords(jsonSchema) as Record<string, unknown>;
}

const UNSUPPORTED_KEYWORDS = new Set([
  // Rejected by the API in a response schema.
  "$schema",
  "additionalProperties",
  // Constraints that inflate the decoder's state machine.
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
]);

function stripUnsupportedKeywords(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => stripUnsupportedKeywords(item));
  }
  if (node !== null && typeof node === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (UNSUPPORTED_KEYWORDS.has(key)) continue;
      output[key] = stripUnsupportedKeywords(value);
    }
    return output;
  }
  return node;
}
