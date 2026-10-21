import type { BenchmarkCase, AggregateMetrics, CaseScore, RateWithCi } from "./types.ts";
import type { BenchmarkResult } from "./runner.ts";

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const ci = (r: RateWithCi) => (r.n === 0 ? "n/a" : `${(r.rate * 100).toFixed(1)}% (${r.k}/${r.n}; 95% CI ${(r.lo * 100).toFixed(0)}-${(r.hi * 100).toFixed(0)}%)`);

function metricsTable(raw: AggregateMetrics | null, final: AggregateMetrics): string[] {
  const rows: Array<[string, (m: AggregateMetrics) => string]> = [
    ["Action accuracy (lenient)", (m) => ci(m.action)],
    ["Action accuracy (strict)", (m) => ci(m.actionStrict)],
    ["Exact quantity match (all 6 units)", (m) => ci(m.exactMatch)],
    ["Quantity precision", (m) => pct(m.precision)],
    ["Quantity recall", (m) => pct(m.recall)],
    ["Quantity F1", (m) => pct(m.f1)],
    ["Cases with >=1 hallucination", (m) => ci(m.hallucinatedCases)],
    ["Hallucinated claims / positive claims", (m) => ci(m.hallucinatedClaims)],
    ["Premature quote rate", (m) => ci(m.prematureQuote)],
    ["Follow-up coverage (missing units asked)", (m) => pct(m.followUpCoverage)],
    ["Cases with possible re-ask (heuristic)", (m) => String(m.possibleReaskCases)],
    ["Mean confidence when right / wrong", (m) => `${pct(m.meanConfidenceWhenExact)} / ${pct(m.meanConfidenceWhenWrong)}`],
    ["High-confidence (>=0.8) errors", (m) => String(m.highConfidenceErrors)],
  ];
  const lines = [`| Metric | ${raw ? "Raw model | " : ""}Final system |`, `| :-- | ${raw ? ":-- | " : ""}:-- |`];
  for (const [label, fn] of rows) lines.push(`| ${label} | ${raw ? `${fn(raw)} | ` : ""}${fn(final)} |`);
  return lines;
}

export function toMarkdown(result: BenchmarkResult, cases: BenchmarkCase[]): string {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const out: string[] = [];
  const m = result.meta;
  out.push(`# Quote24x7 AI Benchmark — ${m.provider}`, "");
  out.push(`- Dataset ${m.datasetVersion}, ${m.cases} cases x ${m.repeats} repeat(s); catalogue ${m.catalogueVersion}; run ${m.startedAt}`);
  out.push(`- Provider failures (fell back to rules): ${result.providerFailures} of ${result.runs.length} runs`);
  if (result.stability !== null) out.push(`- Run-to-run stability: ${pct(result.stability)} of cases gave identical output on every repeat`);
  out.push("");
  if (result.providerFailures > 0 && result.raw) {
    out.push(`> Raw-model metrics cover only the ${result.raw.scores.length} runs where the model answered. Final-system metrics include the rules fallback.`, "");
  }
  if (!result.raw) out.push("> Rules-only baseline: no model was called, so there is no raw-model layer.", "");

  out.push("## Headline metrics", "", ...metricsTable(result.raw?.metrics ?? null, result.final.metrics), "");

  const types = new Set([...Object.keys(result.raw?.metrics.byType ?? {}), ...Object.keys(result.final.metrics.byType)]);
  if (types.size > 0) {
    out.push("## Hallucinations by type", "", `| Type | ${result.raw ? "Raw model | " : ""}Final system |`, `| :-- | ${result.raw ? ":-- | " : ""}:-- |`);
    for (const t of [...types].sort()) {
      const key = t as keyof AggregateMetrics["byType"];
      out.push(`| ${t} | ${result.raw ? `${result.raw.metrics.byType[key] ?? 0} | ` : ""}${result.final.metrics.byType[key] ?? 0} |`);
    }
    out.push("");
  } else {
    out.push("## Hallucinations by type", "", "None detected.", "");
  }

  const focus = result.raw ?? result.final;
  out.push(`## By category (${focus.metrics.layer})`, "", "| Category | n | Action ok | Exact match | Hallucinated |", "| :-- | --: | --: | --: | --: |");
  for (const [category, v] of Object.entries(focus.metrics.byCategory)) {
    out.push(`| ${category} | ${v.n} | ${pct(v.action)} | ${pct(v.exact)} | ${pct(v.hallucinated)} |`);
  }
  out.push("");

  const failing = (scores: CaseScore[]) => scores.filter((s) => !s.exactMatch || !s.actionCorrect || s.hallucinations.length > 0);
  const bad = failing(focus.scores);
  out.push(`## Cases to inspect (${focus.metrics.layer}, ${bad.length})`, "");
  for (const s of bad.slice(0, 40)) {
    const c = byId.get(s.caseId);
    out.push(`### ${s.caseId} — ${c?.category ?? ""}`, c?.description ?? "", "");
    out.push(`- Action: expected \`${s.expectedAction}\`, got \`${s.predictedAction}\``);
    for (const [unit, v] of Object.entries(s.perUnit)) {
      if (!v.ok) out.push(`- ${unit}: expected ${v.expected ?? "(unspecified -> 0)"}, got ${v.got}`);
    }
    for (const h of s.hallucinations) out.push(`- **${h.type}**: ${h.detail}`);
    out.push("");
  }

  const failures = result.runs.filter((r) => r.failure);
  if (failures.length > 0) {
    out.push("## Provider failures", "");
    for (const r of failures.slice(0, 20)) out.push(`- ${r.caseId}: ${r.failure}`);
    out.push("");
  }
  return out.join("\n");
}
