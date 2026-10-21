import type { BenchmarkSummaryReport } from "./types.ts";

/**
 * Formats a terminal-friendly ASCII summary scorecard.
 */
export function formatTerminalReport(report: BenchmarkSummaryReport): string {
  const lines: string[] = [];

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const hr = "================================================================================";
  const subhr = "--------------------------------------------------------------------------------";

  lines.push(hr);
  lines.push(`           QUOTE24x7 AI SALES ENGINEER EVALUATION BENCHMARK`);
  lines.push(hr);
  lines.push(`Model / Evaluator : ${report.modelOrEngine}`);
  lines.push(`Catalogue Version : ${report.catalogueVersion}`);
  lines.push(`Timestamp         : ${report.timestamp}`);
  lines.push(`Total Test Cases  : ${report.totalCases}`);
  lines.push(`Overall Pass Rate : ${pct(report.passRate)} (${report.passedCases}/${report.totalCases} cases passed)`);
  lines.push(subhr);

  lines.push(`\n[1] ACCURACY METRICS:`);
  lines.push(`  • Action Classification Accuracy : ${pct(report.accuracy.actionAccuracy)}`);
  lines.push(`  • Quantity Extraction Precision  : ${pct(report.accuracy.overallQuantityPrecision)}`);
  lines.push(`  • Quantity Extraction Recall     : ${pct(report.accuracy.overallQuantityRecall)}`);
  lines.push(`  • Quantity Extraction F1 Score   : ${pct(report.accuracy.overallQuantityF1)}`);
  lines.push(`  • Quantity Exact Match Rate      : ${pct(report.accuracy.exactMatchRate)}`);
  lines.push(`  • Missing Unit Detection Recall  : ${pct(report.accuracy.missingRequirementRecall)}`);

  lines.push(`\n[2] HALLUCINATION DETECTION:`);
  lines.push(`  • Hallucination-Free Case Rate   : ${pct(report.hallucination.hallucinationFreeRate)}`);
  lines.push(`  • Cases with Hallucinations      : ${report.hallucination.casesWithHallucination} / ${report.totalCases}`);
  lines.push(`  • Total Hallucination Incidents  : ${report.hallucination.totalHallucinations}`);
  lines.push(`  Breakdown by Type:`);
  lines.push(`    - Fabricated Quantities        : ${report.hallucination.byType.fabricated_quantity}`);
  lines.push(`    - Unfaithful Evidence          : ${report.hallucination.byType.unfaithful_evidence}`);
  lines.push(`    - Commercial / Price Leaks     : ${report.hallucination.byType.commercial_pricing_leak}`);
  lines.push(`    - Unsupported Capabilities     : ${report.hallucination.byType.unsupported_category}`);
  lines.push(`    - Schema Contradictions        : ${report.hallucination.byType.schema_contradiction}`);
  lines.push(`    - Phantom Plan References      : ${report.hallucination.byType.phantom_plan}`);
  lines.push(`  Breakdown by Severity:`);
  lines.push(`    - Critical (Fatal Errors)      : ${report.hallucination.bySeverity.critical}`);
  lines.push(`    - High                         : ${report.hallucination.bySeverity.high}`);
  lines.push(`    - Medium                       : ${report.hallucination.bySeverity.medium}`);
  lines.push(`    - Low (Advisory)               : ${report.hallucination.bySeverity.low}`);

  lines.push(`\n[3] CATEGORY PERFORMANCE:`);
  lines.push(
    `  ${"Category".padEnd(28)} | ${"Passed".padStart(7)} | ${"Total".padStart(6)} | ${"Pass Rate".padStart(10)} | ${"Hallucinations".padStart(14)}`
  );
  lines.push(`  ${"-".repeat(28)}-|-+-------+--------+------------+---------------`);
  for (const [cat, data] of Object.entries(report.categoryBreakdown)) {
    lines.push(
      `  ${cat.padEnd(28)} | ${String(data.passed).padStart(7)} | ${String(data.total).padStart(6)} | ${pct(data.passRate).padStart(10)} | ${String(data.hallucinations).padStart(14)}`
    );
  }

  // List case failures or hallucination alerts
  const failedCases = report.caseResults.filter((c) => !c.passed);
  if (failedCases.length > 0) {
    lines.push(`\n[4] FAILURE & HALLUCINATION DETAILS (${failedCases.length} cases):`);
    for (const f of failedCases) {
      lines.push(`\n  ✖ Case [${f.caseId}] - ${f.caseName} (${f.category}):`);
      if (!f.actionMatch) {
        lines.push(`    • Action Mismatch: expected '${f.actionExpected}', actual '${f.actionActual}'`);
      }
      for (const note of f.notes) {
        lines.push(`    • Note: ${note}`);
      }
      for (const h of f.hallucinations) {
        lines.push(`    • [${h.severity.toUpperCase()} HALLUCINATION] ${h.type} in ${h.field}: ${h.description}`);
        if (h.evidenceSnippet) {
          lines.push(`      Snippet: "${h.evidenceSnippet.slice(0, 120)}"`);
        }
      }
    }
  } else {
    lines.push(`\n[4] ALL BENCHMARK CASES PASSED WITH 0 CRITICAL HALLUCINATIONS! 🎉`);
  }

  lines.push(hr);
  return lines.join("\n");
}

/**
 * Formats a GitHub Flavored Markdown report.
 */
export function formatMarkdownReport(report: BenchmarkSummaryReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const md: string[] = [];

  md.push(`# Quote24x7 AI Model Evaluation Benchmark Report\n`);
  md.push(`**Model / Engine Evaluated:** \`${report.modelOrEngine}\`  `);
  md.push(`**Catalogue Version:** \`${report.catalogueVersion}\`  `);
  md.push(`**Timestamp:** ${report.timestamp}  `);
  md.push(`**Overall Pass Rate:** **${pct(report.passRate)}** (${report.passedCases}/${report.totalCases} passed)\n`);

  md.push(`## 1. Executive Summary\n`);
  md.push(`| Metric | Score | Target | Status |`);
  md.push(`| :--- | :--- | :--- | :--- |`);
  md.push(`| **Action Classification Accuracy** | ${pct(report.accuracy.actionAccuracy)} | ≥ 95.0% | ${report.accuracy.actionAccuracy >= 0.95 ? "✅ Pass" : "⚠️ Needs Review"} |`);
  md.push(`| **Quantity Extraction F1** | ${pct(report.accuracy.overallQuantityF1)} | ≥ 90.0% | ${report.accuracy.overallQuantityF1 >= 0.9 ? "✅ Pass" : "⚠️ Needs Review"} |`);
  md.push(`| **Quantity Exact Match Rate** | ${pct(report.accuracy.exactMatchRate)} | ≥ 85.0% | ${report.accuracy.exactMatchRate >= 0.85 ? "✅ Pass" : "⚠️ Needs Review"} |`);
  md.push(`| **Missing Unit Detection Recall** | ${pct(report.accuracy.missingRequirementRecall)} | ≥ 95.0% | ${report.accuracy.missingRequirementRecall >= 0.95 ? "✅ Pass" : "⚠️ Needs Review"} |`);
  md.push(`| **Hallucination-Free Rate** | ${pct(report.hallucination.hallucinationFreeRate)} | ≥ 95.0% | ${report.hallucination.hallucinationFreeRate >= 0.95 ? "✅ Pass" : "⚠️ Alert"} |`);
  md.push(`| **Critical Hallucinations** | ${report.hallucination.bySeverity.critical} | 0 | ${report.hallucination.bySeverity.critical === 0 ? "✅ 0" : "❌ Critical Fail"} |\n`);

  md.push(`## 2. Hallucination Breakdown\n`);
  md.push(`| Hallucination Detector | Incidents Detected | Risk Level |`);
  md.push(`| :--- | :--- | :--- |`);
  md.push(`| **Fabricated Quantities** | ${report.hallucination.byType.fabricated_quantity} | Critical |`);
  md.push(`| **Commercial / Price Leaks** | ${report.hallucination.byType.commercial_pricing_leak} | Critical |`);
  md.push(`| **Unsupported Capabilities** | ${report.hallucination.byType.unsupported_category} | High |`);
  md.push(`| **Unfaithful Evidence** | ${report.hallucination.byType.unfaithful_evidence} | High |`);
  md.push(`| **Schema Contradictions** | ${report.hallucination.byType.schema_contradiction} | Medium |`);
  md.push(`| **Phantom Plans** | ${report.hallucination.byType.phantom_plan} | Low |\n`);

  md.push(`## 3. Category Benchmark Results\n`);
  md.push(`| Evaluation Slice | Passed | Total | Pass Rate | Hallucinations |`);
  md.push(`| :--- | :--- | :--- | :--- | :--- |`);
  for (const [cat, data] of Object.entries(report.categoryBreakdown)) {
    md.push(`| \`${cat}\` | ${data.passed} | ${data.total} | ${pct(data.passRate)} | ${data.hallucinations} |`);
  }
  md.push(``);

  return md.join("\n");
}
