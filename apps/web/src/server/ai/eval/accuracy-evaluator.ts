import type { DemandUnit } from "../../pricing/engine.ts";
import type { AiDecisionOutput } from "../decision-schema.ts";
import type { BenchmarkCase, CaseEvaluationResult, HallucinationFinding, UnitErrorDetail } from "./types.ts";

export function evaluateAccuracy(
  output: AiDecisionOutput,
  benchmarkCase: BenchmarkCase,
  hallucinations: HallucinationFinding[],
  latencyMs: number,
): CaseEvaluationResult {
  const notes: string[] = [];
  if (output.customerSummary.startsWith("Provider error:")) {
    notes.push(output.customerSummary);
  }
  const expectedAction = benchmarkCase.groundTruth.action;
  const actualAction = output.action;
  const actionMatch = actualAction === expectedAction;

  if (!actionMatch) {
    notes.push(`Action mismatch: expected '${expectedAction}', got '${actualAction}'`);
  }

  // -------------------------------------------------------------------------
  // Quantity Accuracy Metrics
  // -------------------------------------------------------------------------
  const expectedQuantities = benchmarkCase.groundTruth.quantities || {};
  const actualQuantitiesMap = new Map<DemandUnit, number>();
  for (const req of output.knownRequirements) {
    actualQuantitiesMap.set(req.unit, req.quantity);
  }

  const unitDetails: Record<string, UnitErrorDetail> = {};
  let exactMatches = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  const allUnits = new Set<DemandUnit>([
    ...(Object.keys(expectedQuantities) as DemandUnit[]),
    ...actualQuantitiesMap.keys(),
  ]);

  for (const unit of allUnits) {
    const expected = expectedQuantities[unit];
    const actual = actualQuantitiesMap.get(unit);

    if (expected !== undefined && actual !== undefined) {
      if (expected === actual) {
        exactMatches++;
        unitDetails[unit] = { expected, actual, delta: 0, status: "match" };
      } else {
        unitDetails[unit] = { expected, actual, delta: actual - expected, status: "mismatch" };
        notes.push(`Quantity mismatch for ${unit}: expected ${expected}, got ${actual}`);
      }
    } else if (expected !== undefined && actual === undefined) {
      falseNegatives++;
      unitDetails[unit] = { expected, actual: undefined, status: "false_negative" };
      notes.push(`Missing expected quantity for ${unit} (expected ${expected})`);
    } else if (expected === undefined && actual !== undefined) {
      falsePositives++;
      unitDetails[unit] = { expected: undefined, actual, status: "false_positive" };
      notes.push(`Unexpected quantity extracted for ${unit} (got ${actual})`);
    }
  }

  const totalExpected = Object.keys(expectedQuantities).length;
  const totalActual = actualQuantitiesMap.size;
  const precision = totalActual > 0 ? exactMatches / totalActual : totalExpected === 0 ? 1 : 0;
  const recall = totalExpected > 0 ? exactMatches / totalExpected : totalActual === 0 ? 1 : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // -------------------------------------------------------------------------
  // Missing Requirement Accuracy
  // -------------------------------------------------------------------------
  const expectedMissing = benchmarkCase.groundTruth.missingUnits || [];
  const actualMissing = output.missingRequirements.map((m) => m.unit);
  const matchedMissing = expectedMissing.filter((u) => actualMissing.includes(u));
  const missingRecall = expectedMissing.length > 0 ? matchedMissing.length / expectedMissing.length : 1;

  if (expectedMissing.length > 0 && missingRecall < 1) {
    const unflagged = expectedMissing.filter((u) => !actualMissing.includes(u));
    notes.push(`Did not flag expected missing units: ${unflagged.join(", ")}`);
  }

  // -------------------------------------------------------------------------
  // Conversational Checks
  // -------------------------------------------------------------------------
  if (benchmarkCase.groundTruth.expectedConversationalKeywords) {
    const convText = (output.conversationalResponse || "").toLowerCase();
    for (const kw of benchmarkCase.groundTruth.expectedConversationalKeywords) {
      if (!convText.includes(kw.toLowerCase())) {
        notes.push(`Conversational response missing expected keyword: "${kw}"`);
      }
    }
  }

  if (benchmarkCase.groundTruth.expectNullConversationalResponse && output.conversationalResponse) {
    notes.push("Conversational response was expected to be null/omitted, but content was provided.");
  }

  // -------------------------------------------------------------------------
  // Pass / Fail Determination
  // -------------------------------------------------------------------------
  const hasCriticalOrHighHallucination = hallucinations.some(
    (h) => h.severity === "critical" || h.severity === "high",
  );
  const quantitiesPass = exactMatches === totalExpected && falsePositives === 0;
  const missingPass = missingRecall >= 0.99;

  const passed =
    actionMatch &&
    quantitiesPass &&
    missingPass &&
    !hasCriticalOrHighHallucination;

  return {
    caseId: benchmarkCase.id,
    caseName: benchmarkCase.name,
    category: benchmarkCase.category,
    passed,
    actionMatch,
    actionExpected: expectedAction,
    actionActual: actualAction,
    quantityAccuracy: {
      exactMatches,
      totalExpected,
      falsePositives,
      falseNegatives,
      precision,
      recall,
      f1,
      unitDetails,
    },
    missingRequirementsAccuracy: {
      expected: expectedMissing,
      actual: actualMissing,
      matched: matchedMissing,
      recall: missingRecall,
    },
    hallucinations,
    hasHallucination: hallucinations.length > 0,
    latencyMs,
    notes,
  };
}
