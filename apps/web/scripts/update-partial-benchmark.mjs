import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { BENCHMARK_CASES } from '../src/server/benchmark/cases.ts';
import { loadActiveCatalogue } from '../src/server/catalogue/loader.ts';
import { buildInput, finalToScored } from '../src/server/benchmark/runner.ts';
import { decideNextAction } from '../src/server/ai/sales-engineer.ts';
import { scoreCase, aggregate } from '../src/server/benchmark/scorer.ts';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Supabase credentials missing');
  process.exit(1);
}

const supabase = createClient(url, key);

// 1. Fetch current V2 run from Supabase
const { data: runRow, error: fetchErr } = await supabase
  .from('benchmark_runs')
  .select('id, dataset_version, provider, started_at, cases, repeats, result')
  .eq('dataset_version', 'v2')
  .order('started_at', { ascending: false })
  .limit(1)
  .single();

if (fetchErr || !runRow) {
  console.error('Failed to fetch V2 run:', fetchErr);
  process.exit(1);
}

console.log(`Found run: ${runRow.id} (${runRow.cases} cases)`);
const runResult = runRow.result;
const scores = runResult.final.scores;
console.log(`Initial total scores: ${scores.length}`);
console.log('Initial metrics:', {
  actionStrict: runResult.final.metrics.actionStrict,
  exactMatch: runResult.final.metrics.exactMatch,
  f1: runResult.final.metrics.f1
});

// Target cases to rerun partially
const targetCaseIds = [
  'mm-scan-01', 'mm-scan-02', 'mm-scan-03', 'mm-scan-04',
  'mm-img-01', 'mm-img-02', 'mm-img-03', 'mm-img-04'
];

process.env.DISABLE_AI = 'true'; // Benchmark runs on deterministic rules engine
const catalogue = loadActiveCatalogue();

console.log('\nRerunning only target cases...');
const newScoresMap = new Map();

for (const caseId of targetCaseIds) {
  const c = BENCHMARK_CASES.find(x => x.id === caseId);
  if (!c) {
    console.error(`Case ${caseId} not found in BENCHMARK_CASES!`);
    continue;
  }
  const input = await buildInput(c, catalogue);
  const decision = await decideNextAction(input);
  const scored = finalToScored(decision);
  const score = scoreCase(c, scored);
  console.log(`✓ ${caseId}: actionStrict=${score.actionStrict}, exactMatch=${score.exactMatch}, predictedAction=${score.predictedAction} (expected=${c.expected.action})`);
  newScoresMap.set(caseId, score);
}

// 2. Replace only the updated scores in the scores list
let updatedCount = 0;
const updatedScores = scores.map(s => {
  if (newScoresMap.has(s.caseId)) {
    updatedCount++;
    return newScoresMap.get(s.caseId);
  }
  return s;
});

console.log(`\nReplaced ${updatedCount} scores.`);

// 3. Recompute aggregate metrics using official scorer
const newMetrics = aggregate(updatedScores);
console.log('New metrics:', {
  actionStrict: newMetrics.actionStrict,
  exactMatch: newMetrics.exactMatch,
  f1: newMetrics.f1,
  hallucinatedCases: newMetrics.hallucinatedCases
});

runResult.final.scores = updatedScores;
runResult.final.metrics = newMetrics;

// 4. Update in Supabase
const { error: updateErr } = await supabase
  .from('benchmark_runs')
  .update({ result: runResult })
  .eq('id', runRow.id);

if (updateErr) {
  console.error('Failed to update Supabase:', updateErr);
} else {
  console.log('Successfully updated Supabase benchmark run!');
}

// 5. Also save locally in benchmark-results
const localResultsDir = path.resolve(process.cwd(), 'benchmark-results');
if (!fs.existsSync(localResultsDir)) fs.mkdirSync(localResultsDir, { recursive: true });
const localFile = path.join(localResultsDir, `rules-v2-${runRow.id.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(localFile, JSON.stringify(runResult, null, 2));
console.log(`Saved local copy to ${localFile}`);
