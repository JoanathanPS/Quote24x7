import fs from "node:fs/promises";
import path from "node:path";
import { getSupabaseClient } from "../src/server/db/supabase.ts";
import type { BenchmarkResult } from "../src/server/benchmark/runner.ts";

const filename = process.argv[2];
if (!filename) throw new Error("Usage: npm run benchmark:persist -- benchmark-results/<run>.json");

const content = await fs.readFile(path.resolve(process.cwd(), filename), "utf8");
const result = JSON.parse(content) as BenchmarkResult;
const supabase = getSupabaseClient();
if (!supabase) throw new Error("Supabase is not configured");

const { error } = await supabase.from("benchmark_runs").upsert({
  id: `${result.meta.datasetVersion}-${result.meta.startedAt}`,
  dataset_version: result.meta.datasetVersion,
  provider: result.meta.provider,
  started_at: result.meta.startedAt,
  cases: result.meta.cases,
  repeats: result.meta.repeats,
  result,
});
if (error) throw error;
console.log(`Persisted ${result.meta.datasetVersion} benchmark run ${result.meta.startedAt}`);