import fs from "node:fs";
import path from "node:path";

import { BENCHMARK_CASES } from "../src/server/benchmark/cases.ts";
import { runBenchmark } from "../src/server/benchmark/runner.ts";
import { toMarkdown } from "../src/server/benchmark/report.ts";
import { groqProvider } from "../src/server/ai/groq-provider.ts";
import { geminiProvider } from "../src/server/ai/gemini-provider.ts";

/**
 * Usage (from apps/web):
 *   node --env-file=.env.local --experimental-strip-types scripts/run-benchmark.ts --provider rules
 *   node --env-file=.env.local --experimental-strip-types scripts/run-benchmark.ts --provider groq --delay-ms 4000
 *
 * Options: --provider rules|groq|gemini  --repeats N  --limit N  --ids a,b  --category x,y
 *          --delay-ms N  --out DIR  --export-dataset FILE
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const exportPath = arg("export-dataset");
  if (exportPath) {
    fs.writeFileSync(exportPath, JSON.stringify({ version: "v1", cases: BENCHMARK_CASES }, null, 2), "utf8");
    console.log(`Dataset (${BENCHMARK_CASES.length} cases) written to ${exportPath}`);
    return;
  }

  const providerName = arg("provider") ?? "rules";
  if (providerName === "rules") process.env.DISABLE_AI = "true";
  const provider = providerName === "groq" ? groqProvider : providerName === "gemini" ? geminiProvider : null;
  if (providerName !== "rules" && !provider) throw new Error(`Unknown provider "${providerName}". Use rules, groq or gemini.`);

  const result = await runBenchmark({
    providerName,
    provider,
    repeats: Number(arg("repeats") ?? 1),
    limit: arg("limit") ? Number(arg("limit")) : undefined,
    ids: arg("ids")?.split(","),
    categories: arg("category")?.split(","),
    delayMs: Number(arg("delay-ms") ?? (provider ? 3000 : 0)),
  });

  const outDir = path.resolve(process.cwd(), arg("out") ?? "benchmark-results");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = result.meta.startedAt.replace(/[:.]/g, "-");
  const base = path.join(outDir, `${providerName}-${stamp}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(result, null, 2), "utf8");
  const markdown = toMarkdown(result, BENCHMARK_CASES);
  fs.writeFileSync(`${base}.md`, markdown, "utf8");
  console.log(markdown.split("\n").slice(0, 40).join("\n"));
  console.log(`\nFull report: ${base}.md\nRaw results: ${base}.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
