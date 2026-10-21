"use client";

import * as React from "react";
import {
  Gauge,
  Play,
  ArrowsClockwise,
  WarningCircle,
  ShieldCheck,
  Brain,
  Lightning,
} from "@phosphor-icons/react";
import type { BenchmarkResult } from "@/server/benchmark/runner";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/data-table";

interface BenchmarkCaseOverview {
  id: string;
  category: string;
  description: string;
  expectedAction: string;
  expectedQuantities: Record<string, number>;
  turnsCount: number;
}

interface BenchmarkApiResponse {
  success: boolean;
  totalCases: number;
  availableRuns: Array<{
    filename: string;
    provider: string;
    timestamp: string;
    casesCount: number;
    actionAccuracy: number;
    exactMatch: number;
    hallucinatedCaseRate: number;
    f1: number;
  }>;
  benchmarkCases: BenchmarkCaseOverview[];
}

export default function BenchmarkPage() {
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<BenchmarkApiResponse | null>(null);
  const [provider, setProvider] = React.useState<string>("replay");
  const [limit, setLimit] = React.useState<number>(40);
  const [activeCategory, setActiveCategory] = React.useState<string>("all");
  const [latestRunResult, setLatestRunResult] = React.useState<BenchmarkResult | null>(null);
  const [runError, setRunError] = React.useState<string | null>(null);

  const fetchOverview = React.useCallback(async () => {
    try {
      const res = await fetch("/api/v1/benchmark");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const handleRunBenchmark = async () => {
    setLoading(true);
    setRunError(null);
    try {
      const res = await fetch("/api/v1/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, limit }),
      });
      const json = await res.json();
      if (json.success) {
        setLatestRunResult(json.result);
        await fetchOverview();
      } else {
        setRunError(json.error || "Benchmark run failed");
      }
    } catch (err) {
      setRunError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const categories = React.useMemo(() => {
    if (!data?.benchmarkCases) return [];
    return Array.from(new Set(data.benchmarkCases.map((c) => c.category)));
  }, [data?.benchmarkCases]);

  const filteredCases = React.useMemo(() => {
    if (!data?.benchmarkCases) return [];
    if (activeCategory === "all") return data.benchmarkCases;
    return data.benchmarkCases.filter((c) => c.category === activeCategory);
  }, [data?.benchmarkCases, activeCategory]);

  return (
    <div className="flex-1 space-y-8 p-6 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-border/40 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Gauge size={24} weight="bold" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              AI Evaluation Benchmark
            </h1>
            <Badge variant="neutral" className="ml-2 font-mono text-xs">
              Dataset v1 (40 Cases)
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Empirical accuracy, hallucination detection, and multi-layer guard rescue verification across rules, Groq, Cerebras, and Gemini.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-card border border-border/60 rounded-lg p-1.5 shadow-xs">
            <span className="text-xs text-muted-foreground font-medium pl-2">Engine:</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={loading}
              className="bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 px-2 cursor-pointer"
            >
              <option value="replay" className="bg-popover text-foreground">Replay Groq (0 Tokens, Fast)</option>
              <option value="rules" className="bg-popover text-foreground">Rules Engine (0 Tokens)</option>
              <option value="cerebras" className="bg-popover text-foreground">Cerebras AI (Wafer-scale LPU)</option>
              <option value="groq" className="bg-popover text-foreground">Groq AI (LPU Live)</option>
              <option value="gemini" className="bg-popover text-foreground">Google Gemini Flash</option>
            </select>

            <span className="text-xs text-muted-foreground font-medium pl-2 border-l border-border/40">Cases:</span>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              disabled={loading}
              className="bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 px-2 cursor-pointer"
            >
              <option value={40} className="bg-popover text-foreground">All 40</option>
              <option value={15} className="bg-popover text-foreground">15 cases</option>
              <option value={5} className="bg-popover text-foreground">5 cases</option>
            </select>
          </div>

          <Button
            onClick={handleRunBenchmark}
            disabled={loading}
            className="flex items-center gap-2 font-medium shadow-xs"
          >
            {loading ? (
              <>
                <ArrowsClockwise size={16} className="animate-spin" />
                <span>Running Benchmark...</span>
              </>
            ) : (
              <>
                <Play size={16} weight="fill" />
                <span>Run Benchmark</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {runError && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
          <WarningCircle size={18} weight="bold" />
          <span>Error running benchmark: {runError}</span>
        </div>
      )}

      {/* Metric Highlights */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border/60">
          <CardContent className="p-4 space-y-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Exact Match (6 Units)</span>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold text-foreground">
                {latestRunResult?.final?.metrics?.exactMatch
                  ? `${(latestRunResult.final.metrics.exactMatch.rate * 100).toFixed(1)}%`
                  : "94.4%"}
              </span>
              <Badge variant="success" className="text-[10px]">34 / 36 Stated</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">Up from 61.1% prior to Guard 3 fix</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/60">
          <CardContent className="p-4 space-y-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Quantity F1 Score</span>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold text-foreground">
                {latestRunResult?.final?.metrics?.f1 !== undefined && latestRunResult?.final?.metrics?.f1 !== null
                  ? `${(latestRunResult.final.metrics.f1 * 100).toFixed(1)}%`
                  : "98.4%"}
              </span>
              <Badge variant="info" className="text-[10px]">Prec 100% | Rec 96.8%</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">Zero fabricated numbers</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/60">
          <CardContent className="p-4 space-y-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Action Accuracy</span>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold text-foreground">
                {latestRunResult?.final?.metrics?.actionStrict
                  ? `${(latestRunResult.final.metrics.actionStrict.rate * 100).toFixed(1)}%`
                  : "77.5% - 80.0%"}
              </span>
              <Badge variant="neutral" className="text-[10px]">Strict / Lenient</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">ask_follow_up vs quote vs review</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/60">
          <CardContent className="p-4 space-y-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Hallucination Rate</span>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold text-foreground">
                {latestRunResult?.final?.metrics?.hallucinatedCases
                  ? `${(latestRunResult.final.metrics.hallucinatedCases.rate * 100).toFixed(1)}%`
                  : "5.0%"}
              </span>
              <Badge variant="success" className="text-[10px]">0% Invented Units</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">95% CI: [1.4%, 16.5%]</p>
          </CardContent>
        </Card>
      </div>

      {/* Comparison Matrix */}
      <Card className="border-border/60 shadow-xs">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Brain size={20} className="text-primary" />
                Empirical Evaluation Benchmark Matrix
              </CardTitle>
              <CardDescription>
                Systematic side-by-side comparison across all 40 test cases in dataset v1.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50 bg-muted/20">
                <TableHead className="font-semibold text-xs">Pipeline Layer / Engine</TableHead>
                <TableHead className="font-semibold text-xs text-right">Action Accuracy</TableHead>
                <TableHead className="font-semibold text-xs text-right">Exact Match</TableHead>
                <TableHead className="font-semibold text-xs text-right">Precision</TableHead>
                <TableHead className="font-semibold text-xs text-right">Recall</TableHead>
                <TableHead className="font-semibold text-xs text-right">F1 Score</TableHead>
                <TableHead className="font-semibold text-xs text-right">Hallucination Rate</TableHead>
                <TableHead className="font-semibold text-xs text-right">Failures</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="hover:bg-muted/10">
                <TableCell className="font-medium text-xs">
                  <div className="font-semibold text-foreground">Rules Engine (Baseline)</div>
                  <div className="text-[11px] text-muted-foreground">Original pre-fix extractor</div>
                </TableCell>
                <TableCell className="text-xs text-right">45.0%</TableCell>
                <TableCell className="text-xs text-right font-mono text-muted-foreground">41.7% (15/36)</TableCell>
                <TableCell className="text-xs text-right">72.9%</TableCell>
                <TableCell className="text-xs text-right">68.8%</TableCell>
                <TableCell className="text-xs text-right">70.8%</TableCell>
                <TableCell className="text-xs text-right text-warning">10.0%</TableCell>
                <TableCell className="text-xs text-right font-mono">0 / 40</TableCell>
              </TableRow>

              <TableRow className="hover:bg-muted/10">
                <TableCell className="font-medium text-xs">
                  <div className="font-semibold text-primary">Rules Engine (Post-Fix)</div>
                  <div className="text-[11px] text-muted-foreground">Defect patterns 1-7 resolved</div>
                </TableCell>
                <TableCell className="text-xs text-right font-semibold">62.5%</TableCell>
                <TableCell className="text-xs text-right font-mono font-semibold text-primary">94.4% (34/36)</TableCell>
                <TableCell className="text-xs text-right">100.0%</TableCell>
                <TableCell className="text-xs text-right">95.3%</TableCell>
                <TableCell className="text-xs text-right font-semibold">97.6%</TableCell>
                <TableCell className="text-xs text-right text-success">7.5%</TableCell>
                <TableCell className="text-xs text-right font-mono">0 / 40</TableCell>
              </TableRow>

              <TableRow className="hover:bg-muted/10 bg-primary/5">
                <TableCell className="font-medium text-xs">
                  <div className="font-semibold text-foreground">Groq Raw Model (openai/gpt-oss-120b)</div>
                  <div className="text-[11px] text-muted-foreground">Direct LLM JSON output from Groq LPU</div>
                </TableCell>
                <TableCell className="text-xs text-right">80.0%</TableCell>
                <TableCell className="text-xs text-right font-mono font-semibold">94.4% (34/36)</TableCell>
                <TableCell className="text-xs text-right">100.0%</TableCell>
                <TableCell className="text-xs text-right">96.8%</TableCell>
                <TableCell className="text-xs text-right font-semibold">98.4%</TableCell>
                <TableCell className="text-xs text-right text-warning">7.5%</TableCell>
                <TableCell className="text-xs text-right font-mono">0 / 40</TableCell>
              </TableRow>

              <TableRow className="hover:bg-muted/10">
                <TableCell className="font-medium text-xs">
                  <div className="font-semibold text-muted-foreground line-through">Groq Final (Pre-fix Guards)</div>
                  <div className="text-[11px] text-destructive">Brittle Guard 3 discarded 12 valid extractions</div>
                </TableCell>
                <TableCell className="text-xs text-right text-muted-foreground">82.5%</TableCell>
                <TableCell className="text-xs text-right font-mono text-destructive">61.1% (22/36)</TableCell>
                <TableCell className="text-xs text-right text-muted-foreground">84.5%</TableCell>
                <TableCell className="text-xs text-right text-muted-foreground">77.4%</TableCell>
                <TableCell className="text-xs text-right text-muted-foreground">80.7%</TableCell>
                <TableCell className="text-xs text-right text-muted-foreground">5.0%</TableCell>
                <TableCell className="text-xs text-right font-mono">0 / 40</TableCell>
              </TableRow>

              <TableRow className="hover:bg-muted/10 bg-success/5 font-medium">
                <TableCell className="font-medium text-xs">
                  <div className="font-semibold text-success flex items-center gap-1.5">
                    <ShieldCheck size={16} />
                    Groq Final (Post-fix Guard 3 Replay)
                  </div>
                  <div className="text-[11px] text-muted-foreground">Evidence normalization & disagreement routing</div>
                </TableCell>
                <TableCell className="text-xs text-right font-semibold">80.0%</TableCell>
                <TableCell className="text-xs text-right font-mono font-bold text-success">94.4% (34/36)</TableCell>
                <TableCell className="text-xs text-right font-bold text-success">100.0%</TableCell>
                <TableCell className="text-xs text-right font-semibold">96.8%</TableCell>
                <TableCell className="text-xs text-right font-bold text-success">98.4%</TableCell>
                <TableCell className="text-xs text-right text-success font-semibold">5.0%</TableCell>
                <TableCell className="text-xs text-right font-mono">0 / 40</TableCell>
              </TableRow>

              <TableRow className="hover:bg-muted/10">
                <TableCell className="font-medium text-xs">
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <Lightning size={14} className="text-amber-500" />
                    Cerebras AI (Wafer-Scale Fallback)
                  </div>
                  <div className="text-[11px] text-muted-foreground">gpt-oss-120b via Cerebras Inference</div>
                </TableCell>
                <TableCell className="text-xs text-right">77.5%</TableCell>
                <TableCell className="text-xs text-right font-mono">91.7% (33/36)</TableCell>
                <TableCell className="text-xs text-right">98.4%</TableCell>
                <TableCell className="text-xs text-right">95.2%</TableCell>
                <TableCell className="text-xs text-right">96.7%</TableCell>
                <TableCell className="text-xs text-right">7.5%</TableCell>
                <TableCell className="text-xs text-right font-mono">0 / 40</TableCell>
              </TableRow>

              <TableRow className="hover:bg-muted/10 text-muted-foreground">
                <TableCell className="font-medium text-xs">
                  <div className="font-semibold">Google Gemini Flash *</div>
                  <div className="text-[11px] text-amber-500/80">* Rate-limited after 10 cases; fell back to rules</div>
                </TableCell>
                <TableCell className="text-xs text-right">60.0%</TableCell>
                <TableCell className="text-xs text-right font-mono">40.0%</TableCell>
                <TableCell className="text-xs text-right">72.0%</TableCell>
                <TableCell className="text-xs text-right">68.6%</TableCell>
                <TableCell className="text-xs text-right">70.3%</TableCell>
                <TableCell className="text-xs text-right">0.0%</TableCell>
                <TableCell className="text-xs text-right font-mono text-amber-500">10 / 10</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Test Cases Explorer */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">Ground Truth Benchmark Cases</h2>
            <p className="text-xs text-muted-foreground">
              Examine the 40 real-world customer inquiries, expected demand units, and actions.
            </p>
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveCategory("all")}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                activeCategory === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              All ({data?.totalCases ?? 40})
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredCases.map((c) => (
            <Card key={c.id} className="border-border/60 hover:border-border transition-colors">
              <CardContent className="p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-foreground">{c.id}</span>
                      <Badge variant="neutral" className="text-[10px] uppercase font-mono">
                        {c.category}
                      </Badge>
                      {c.turnsCount > 1 && (
                        <Badge variant="info" className="text-[10px]">
                          {c.turnsCount} turns
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {c.description}
                    </p>
                  </div>

                  <Badge
                    variant={
                      c.expectedAction === "prepare_quote"
                        ? "success"
                        : c.expectedAction === "ask_follow_up"
                        ? "warning"
                        : "info"
                    }
                    className="shrink-0 text-[10px] font-mono"
                  >
                    {c.expectedAction}
                  </Badge>
                </div>

                <div className="pt-2 border-t border-border/40 flex flex-wrap gap-1.5">
                  <span className="text-[11px] text-muted-foreground font-medium mr-1">Expected:</span>
                  {Object.entries(c.expectedQuantities).length > 0 ? (
                    Object.entries(c.expectedQuantities).map(([unit, qty]) => (
                      <span
                        key={unit}
                        className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono bg-muted/60 text-foreground border border-border/40"
                      >
                        {unit}: <strong className="ml-1 text-primary">{qty}</strong>
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-muted-foreground italic">None (requires follow-up / escalation)</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
