import fs from "node:fs";
import path from "node:path";

import { BENCHMARK_CASES } from "../src/server/benchmark/cases.ts";
import { runBenchmark, type RunProgressInfo } from "../src/server/benchmark/runner.ts";
import { toMarkdown } from "../src/server/benchmark/report.ts";
import { groqProvider } from "../src/server/ai/groq-provider.ts";
import { cerebrasProvider } from "../src/server/ai/cerebras-provider.ts";
import { geminiProvider } from "../src/server/ai/gemini-provider.ts";

/**
 * Usage (from apps/web):
 *   node --env-file=.env.local --experimental-strip-types scripts/run-benchmark.ts --provider rules
 *   node --env-file=.env.local --experimental-strip-types scripts/run-benchmark.ts --provider groq --delay-ms 4000
 *   node --env-file=.env.local --experimental-strip-types scripts/run-benchmark.ts --provider cerebras --delay-ms 2000
 *
 * Options: --provider rules|groq|cerebras|gemini  --repeats N  --limit N  --ids a,b  --category x,y
 *          --delay-ms N  --out DIR  --export-dataset FILE  --log-file FILE
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const logArg = process.argv.find((a) => a.startsWith("--log-file="));
  const logPath = logArg
    ? logArg.split("=")[1]
    : process.argv.indexOf("--log-file") !== -1
    ? process.argv[process.argv.indexOf("--log-file") + 1]
    : process.env.LOG_FILE;

  if (logPath) {
    const resolvedPath = path.resolve(process.cwd(), logPath);
    const logStream = fs.createWriteStream(resolvedPath, { encoding: "utf8", flags: "w" });
    const origStdout = process.stdout.write.bind(process.stdout);
    const origStderr = process.stderr.write.bind(process.stderr);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.stdout.write = (chunk: any, encoding?: any, callback?: any): boolean => {
      logStream.write(chunk);
      return origStdout(chunk, encoding, callback);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.stderr.write = (chunk: any, encoding?: any, callback?: any): boolean => {
      logStream.write(chunk);
      return origStderr(chunk, encoding, callback);
    };
  }

  const exportPath = arg("export-dataset");
  if (exportPath) {
    fs.writeFileSync(exportPath, JSON.stringify({ version: "v1", cases: BENCHMARK_CASES }, null, 2), "utf8");
    console.log(`Dataset (${BENCHMARK_CASES.length} cases) written to ${exportPath}`);
    return;
  }

  const replayPath = arg("replay");
  if (replayPath) {
    const rawContent = fs.readFileSync(path.resolve(process.cwd(), replayPath), "utf8");
    const parsed = JSON.parse(rawContent) as { runs: import("../src/server/benchmark/runner.ts").CaseRun[]; meta?: { provider?: string } };
    const providerName = `replay-${parsed.meta?.provider ?? "model"}`;
    console.log(`\n=== Replaying Benchmark Runs from ${replayPath} (${parsed.runs.length} cases, 0 API calls) ===\n`);

    const result = await runBenchmark({
      providerName,
      provider: null,
      replayRuns: parsed.runs,
      limit: arg("limit") ? Number(arg("limit")) : undefined,
      ids: arg("ids")?.split(","),
      categories: arg("category")?.split(","),
      delayMs: 0,
      onProgress: (p: RunProgressInfo) => {
        const repTag = p.totalRepeats > 1 ? ` [rep ${p.repeat}/${p.totalRepeats}]` : "";
        const statusTag = p.providerStatus === "ok" ? "ok" : p.providerStatus === "failed" ? `FAILED (${p.failure})` : "offline";
        const latTag = p.latencyMs !== null ? ` ${p.latencyMs}ms` : "";
        console.log(`[${p.index}/${p.total}]${repTag} ${p.caseId} (${p.category}): ${statusTag}${latTag} -> action=${p.action}`);
      },
    });

    const outDir = path.resolve(process.cwd(), arg("out") ?? "benchmark-results");
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = result.meta.startedAt.replace(/[:.]/g, "-");
    const base = path.join(outDir, `${providerName}-${stamp}`);
    fs.writeFileSync(`${base}.json`, JSON.stringify(result, null, 2), "utf8");
    const markdown = toMarkdown(result, BENCHMARK_CASES);
    fs.writeFileSync(`${base}.md`, markdown, "utf8");
    console.log("\n" + markdown.split("\n").slice(0, 40).join("\n"));
    console.log(`\nFull report: ${base}.md\nRaw results: ${base}.json`);
    return;
  }

  const providerName = arg("provider") ?? "rules";
  if (providerName === "rules") process.env.DISABLE_AI = "true";
  const provider =
    providerName === "groq"
      ? groqProvider
      : providerName === "cerebras"
      ? cerebrasProvider
      : providerName === "gemini"
      ? geminiProvider
      : null;
  if (providerName !== "rules" && !provider) throw new Error(`Unknown provider "${providerName}". Use rules, groq, cerebras or gemini.`);

  console.log(`\n=== Running Quote24x7 Benchmark: Provider=${providerName} ===\n`);

  const result = await runBenchmark({
    providerName,
    provider,
    repeats: Number(arg("repeats") ?? 1),
    limit: arg("limit") ? Number(arg("limit")) : undefined,
    ids: arg("ids")?.split(","),
    categories: arg("category")?.split(","),
    delayMs: Number(arg("delay-ms") ?? (provider ? 3000 : 0)),
    onProgress: (p: RunProgressInfo) => {
      const repTag = p.totalRepeats > 1 ? ` [rep ${p.repeat}/${p.totalRepeats}]` : "";
      const statusTag = p.providerStatus === "ok" ? "ok" : p.providerStatus === "failed" ? `FAILED (${p.failure})` : "offline";
      const latTag = p.latencyMs !== null ? ` ${p.latencyMs}ms` : "";
      console.log(`[${p.index}/${p.total}]${repTag} ${p.caseId} (${p.category}): ${statusTag}${latTag} -> action=${p.action}`);
    },
  });

  const outDir = path.resolve(process.cwd(), arg("out") ?? "benchmark-results");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = result.meta.startedAt.replace(/[:.]/g, "-");
  const base = path.join(outDir, `${providerName}-${stamp}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(result, null, 2), "utf8");
  const markdown = toMarkdown(result, BENCHMARK_CASES);
  fs.writeFileSync(`${base}.md`, markdown, "utf8");
  console.log("\n" + markdown.split("\n").slice(0, 40).join("\n"));
  console.log(`\nFull report: ${base}.md\nRaw results: ${base}.json`);

  // Exit non-zero only on real failure: 100% provider failure when AI was requested
  if (result.runs.length > 0 && result.providerFailures === result.runs.length && providerName !== "rules") {
    console.error(`\nFATAL: All ${result.runs.length} runs failed with provider error.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
