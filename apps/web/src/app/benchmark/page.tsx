"use client";

import * as React from "react";
import {
  Gauge,
  WarningCircle,
  ShieldCheck,
  Brain,
  Lightning,
  CheckCircle,
  ChatCircleText,
  MagnifyingGlass,
  Check,
  X,
} from "@phosphor-icons/react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/data-table";

interface BenchmarkCaseItem {
  id: string;
  category: string;
  subject: string;
  description: string;
  testedContent: string;
  turnsCount: number;
  expected: {
    action: string;
    quantities: Record<string, number>;
  };
  got: {
    action: string;
    quantities: Record<string, number>;
    exactMatch: boolean;
    actionCorrect: boolean;
    actionStrict: boolean;
    hallucinations: string[];
    perUnit: Record<string, { expected: number; got: number; ok: boolean }> | null;
  };
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
  benchmarkCases: BenchmarkCaseItem[];
  cerebrasMetrics?: {
    actionStrict?: { rate: number; numerator: number; denominator: number };
    actionLenient?: { rate: number; numerator: number; denominator: number };
    exactMatch?: { rate: number; numerator: number; denominator: number };
    f1?: number;
    precision?: number;
    recall?: number;
    hallucinatedCases?: { rate: number; numerator: number; denominator: number };
  } | null;
}

export default function BenchmarkPage() {
  const [data, setData] = React.useState<BenchmarkApiResponse | null>(null);
  const [activeCategory, setActiveCategory] = React.useState<string>("all");
  const [searchQuery, setSearchQuery] = React.useState<string>("");

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

  const categories = React.useMemo(() => {
    if (!data?.benchmarkCases) return [];
    return Array.from(new Set(data.benchmarkCases.map((c) => c.category)));
  }, [data?.benchmarkCases]);

  const filteredCases = React.useMemo(() => {
    if (!data?.benchmarkCases) return [];
    return data.benchmarkCases.filter((c) => {
      const matchesCategory = activeCategory === "all" || c.category === activeCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        c.id.toLowerCase().includes(q) ||
        c.subject.toLowerCase().includes(q) ||
        c.testedContent.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [data?.benchmarkCases, activeCategory, searchQuery]);

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
            Empirical accuracy, hallucination detection, and multi-layer guard verification across 40 real-world inquiries.
          </p>
        </div>

        {/* Engine and Cases Status Header */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 bg-card border border-border/70 rounded-xl px-4 py-2.5 shadow-xs">
            <div className="flex items-center gap-2">
              <Lightning size={18} weight="fill" className="text-amber-500 shrink-0" />
              <span className="text-xs text-muted-foreground font-medium">Engine:</span>
              <span className="text-xs font-bold text-foreground">Cerebras AI (Wafer-scale LPU)</span>
            </div>
            <div className="h-4 w-px bg-border/60" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">Cases:</span>
              <span className="text-xs font-bold text-foreground font-mono">All 40</span>
            </div>
            <Badge variant="success" className="text-[10px] uppercase font-mono tracking-wider ml-1">
              Evaluated
            </Badge>
          </div>
        </div>
      </div>

      {/* Metric Highlights — Fixed Alignment & Clean Proportions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Exact Match */}
        <Card className="bg-card/60 border-border/70 shadow-xs">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                Exact Match (6 Units)
              </span>
              <Badge variant="success" className="text-[10px] font-mono">
                31 / 36 Stated
              </Badge>
            </div>
            <div className="text-2xl font-bold font-mono tracking-tight text-foreground whitespace-nowrap">
              86.1%
            </div>
            <p className="text-[11px] text-muted-foreground">
              94.3% raw model · Zero fabricated quantities
            </p>
          </CardContent>
        </Card>

        {/* F1 Score */}
        <Card className="bg-card/60 border-border/70 shadow-xs">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                Quantity F1 Score
              </span>
              <Badge variant="info" className="text-[10px] font-mono">
                Prec 93.4% · Rec 91.9%
              </Badge>
            </div>
            <div className="text-2xl font-bold font-mono tracking-tight text-foreground whitespace-nowrap">
              92.7%
            </div>
            <p className="text-[11px] text-muted-foreground">
              98.3% on raw extractions before system guard
            </p>
          </CardContent>
        </Card>

        {/* Action Accuracy */}
        <Card className="bg-card/60 border-border/70 shadow-xs">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                Action Accuracy
              </span>
              <Badge variant="neutral" className="text-[10px] font-mono">
                Strict: 70.0%
              </Badge>
            </div>
            <div className="text-2xl font-bold font-mono tracking-tight text-foreground whitespace-nowrap">
              75.0%
            </div>
            <p className="text-[11px] text-muted-foreground">
              Lenient: 75.0% (30/40) · Strict: 70.0% (28/40)
            </p>
          </CardContent>
        </Card>

        {/* Hallucination Rate */}
        <Card className="bg-card/60 border-border/70 shadow-xs">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                Hallucination Rate
              </span>
              <Badge variant="success" className="text-[10px] font-mono">
                0% Invented Units
              </Badge>
            </div>
            <div className="text-2xl font-bold font-mono tracking-tight text-foreground whitespace-nowrap">
              5.0%
            </div>
            <p className="text-[11px] text-muted-foreground">
              95% CI: [1.0%, 17.0%] · 2 cases guarded
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Comparison Matrix */}
      <Card className="border-border/60 shadow-xs overflow-hidden">
        <CardHeader className="pb-3">
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
        <CardContent className="p-0 overflow-x-auto">
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

              <TableRow className="hover:bg-muted/10">
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

              <TableRow className="hover:bg-muted/10 bg-amber-500/5 font-medium border-l-2 border-l-amber-500">
                <TableCell className="font-medium text-xs">
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <Lightning size={14} weight="fill" className="text-amber-500" />
                    Cerebras AI (Wafer-Scale LPU)
                  </div>
                  <div className="text-[11px] text-muted-foreground">gpt-oss-120b on Cerebras Wafer-Scale cluster</div>
                </TableCell>
                <TableCell className="text-xs text-right font-semibold">75.0%</TableCell>
                <TableCell className="text-xs text-right font-mono font-semibold">86.1% (31/36)</TableCell>
                <TableCell className="text-xs text-right">93.4%</TableCell>
                <TableCell className="text-xs text-right">91.9%</TableCell>
                <TableCell className="text-xs text-right font-semibold">92.7%</TableCell>
                <TableCell className="text-xs text-right text-success font-semibold">5.0%</TableCell>
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

      {/* Benchmark Cases — Clear 4-Row Architecture */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">Ground Truth Benchmark Cases</h2>
            <p className="text-xs text-muted-foreground">
              Detailed audit of all 40 customer scenarios: tested inquiry, ground-truth policy expectations, and Cerebras AI model outputs.
            </p>
          </div>

          {/* Search bar */}
          <div className="relative w-full sm:w-64">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search case ID, keyword..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-card border border-border/60 rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:border-primary/60"
            />
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveCategory("all")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              activeCategory === "all"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            All ({data?.totalCases ?? 40})
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                activeCategory === cat
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* 40 Cases — Exactly 4 Rows Each */}
        <div className="space-y-4">
          {filteredCases.map((c) => {
            const isExactAndAction = c.got.exactMatch && c.got.actionCorrect;
            const isActionOnly = c.got.actionCorrect && !c.got.exactMatch;

            return (
              <Card
                key={c.id}
                className="border-border/70 bg-card/60 shadow-xs hover:border-border transition-colors overflow-hidden"
              >
                <CardContent className="p-5 space-y-4">
                  {/* ROW 1: Case Identification & Verdict */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-border/50">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono text-xs font-bold text-foreground bg-muted px-2 py-0.5 rounded border border-border/60">
                        {c.id}
                      </span>
                      <Badge variant="neutral" className="text-[10px] font-mono uppercase tracking-wide">
                        {c.category}
                      </Badge>
                      <span className="text-xs font-semibold text-foreground">
                        {c.subject}
                      </span>
                      {c.turnsCount > 1 && (
                        <Badge variant="info" className="text-[10px] font-mono">
                          {c.turnsCount} turns
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isExactAndAction ? (
                        <Badge variant="success" className="text-xs font-mono py-0.5 px-2.5 flex items-center gap-1.5">
                          <CheckCircle size={14} weight="bold" />
                          <span>Exact Match ✓</span>
                        </Badge>
                      ) : isActionOnly ? (
                        <Badge variant="info" className="text-xs font-mono py-0.5 px-2.5 flex items-center gap-1.5">
                          <CheckCircle size={14} />
                          <span>Action Match (Delta Qty)</span>
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="text-xs font-mono py-0.5 px-2.5 flex items-center gap-1.5">
                          <WarningCircle size={14} weight="bold" />
                          <span>Action Mismatch</span>
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* ROW 2: Tested Content (What was tested) */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <ChatCircleText size={14} className="text-primary" />
                      <span>Tested Customer Inquiry (Input)</span>
                    </div>
                    <div className="bg-muted/40 border border-border/50 rounded-lg p-3.5 text-xs text-foreground font-sans whitespace-pre-wrap leading-relaxed select-text">
                      {c.testedContent}
                    </div>
                  </div>

                  {/* ROW 3: Ground Truth (What was expected) */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <CheckCircle size={14} className="text-emerald-500" />
                      <span>Ground Truth (Expected)</span>
                    </div>
                    <div className="bg-background/80 border border-border/50 rounded-lg p-3 flex flex-wrap items-center gap-2">
                      <Badge variant="neutral" className="font-mono text-xs font-semibold">
                        Action: {c.expected.action}
                      </Badge>
                      <div className="h-4 w-px bg-border/60 mx-1 hidden sm:block" />
                      <span className="text-xs text-muted-foreground font-medium">Demands:</span>
                      {Object.entries(c.expected.quantities).length > 0 ? (
                        Object.entries(c.expected.quantities).map(([unit, qty]) => (
                          <span
                            key={unit}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-muted text-foreground border border-border/60"
                          >
                            {unit}: <strong className="ml-1 text-primary">{qty}</strong>
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          None stated (Scope closed or unquantified)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ROW 4: What You Got (Cerebras AI Result) */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Lightning size={14} weight="fill" className="text-amber-500" />
                      <span>Cerebras AI Wafer-Scale LPU (What you got)</span>
                    </div>
                    <div className="bg-background/80 border border-border/50 rounded-lg p-3 flex flex-wrap items-center gap-2">
                      <Badge
                        variant={c.got.actionCorrect ? "success" : "danger"}
                        className="font-mono text-xs font-semibold flex items-center gap-1"
                      >
                        Action: {c.got.action}
                        {c.got.actionCorrect ? <Check size={12} weight="bold" /> : <X size={12} weight="bold" />}
                      </Badge>

                      <div className="h-4 w-px bg-border/60 mx-1 hidden sm:block" />
                      <span className="text-xs text-muted-foreground font-medium">Extracted:</span>

                      {Object.entries(c.got.quantities).length > 0 ? (
                        Object.entries(c.got.quantities).map(([unit, qty]) => {
                          const expQty = c.expected.quantities[unit];
                          const isMatch = expQty === qty;
                          return (
                            <span
                              key={unit}
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border ${
                                isMatch
                                  ? "bg-success-soft text-success-soft-foreground border-success/30"
                                  : "bg-danger-soft text-danger-soft-foreground border-danger/30"
                              }`}
                            >
                              {unit}: <strong className="ml-1">{qty}</strong>
                              {isMatch ? " ✓" : ` (exp: ${expQty ?? 0}) ✗`}
                            </span>
                          );
                        })
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          No positive units extracted
                        </span>
                      )}

                      {c.got.hallucinations && c.got.hallucinations.length > 0 && (
                        <Badge variant="danger" className="text-[10px] font-mono ml-auto">
                          Flagged: {c.got.hallucinations.join(", ")}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}