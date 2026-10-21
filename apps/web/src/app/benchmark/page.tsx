"use client";

import * as React from "react";
import {
  Gauge,
  Brain,
  CheckCircle,
  WarningCircle,
  ChatCircleText,
  MagnifyingGlass,
  Check,
  X,
  CaretDown,
  DownloadSimple,
  ArrowsIn,
  ArrowsOut,
  CloudArrowDown,
  Sparkle,
} from "@phosphor-icons/react";

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
  supabaseDatasetUrl?: string;
}

const SUPABASE_DATASET_URL =
  "https://rezunroklwuzwahzknbz.supabase.co/storage/v1/object/public/benchmark-datasets/benchmark-dataset-v1.json";

export default function BenchmarkPage() {
  const [data, setData] = React.useState<BenchmarkApiResponse | null>(null);
  const [activeCategory, setActiveCategory] = React.useState<string>("all");
  const [searchQuery, setSearchQuery] = React.useState<string>("");
  const [expandedCases, setExpandedCases] = React.useState<Record<string, boolean>>({});

  const fetchOverview = React.useCallback(async () => {
    try {
      const res = await fetch("/api/v1/benchmark");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        // By default expand the first 3 cases for quick glance
        if (json.benchmarkCases && json.benchmarkCases.length > 0) {
          const initial: Record<string, boolean> = {};
          json.benchmarkCases.slice(0, 3).forEach((c: BenchmarkCaseItem) => {
            initial[c.id] = true;
          });
          setExpandedCases(initial);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const toggleCase = (id: string) => {
    setExpandedCases((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleExpandAll = () => {
    if (!data?.benchmarkCases) return;
    const allOpen: Record<string, boolean> = {};
    data.benchmarkCases.forEach((c) => {
      allOpen[c.id] = true;
    });
    setExpandedCases(allOpen);
  };

  const handleCollapseAll = () => {
    setExpandedCases({});
  };

  const handleDownloadDataset = () => {
    const link = document.createElement("a");
    link.href = "/api/v1/benchmark?download=dataset";
    link.download = "benchmark-dataset-v1.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
      {/* Header — Floating weightless glass style */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-border/40 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
              <Gauge size={24} weight="bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  AI Evaluation Benchmark
                </h1>
                <Badge variant="neutral" className="font-mono text-xs">
                  Dataset v1 (40 Cases)
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Empirical evaluation across 40 real-world customer inquiries verifying accuracy, demand extraction, and hallucination prevention.
              </p>
            </div>
          </div>
        </div>

        {/* Action button for dataset download */}
        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            onClick={handleDownloadDataset}
            className="flex items-center gap-2 text-xs font-semibold h-9 px-3.5 bg-card/80 hover:bg-muted border-border/80 shadow-xs"
          >
            <DownloadSimple size={16} weight="bold" className="text-primary" />
            <span>Download Dataset</span>
            <Badge variant="success" className="text-[9px] px-1.5 py-0 font-mono tracking-tight ml-1">
              Supabase
            </Badge>
          </Button>

          <a
            href={data?.supabaseDatasetUrl || SUPABASE_DATASET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-lg border border-border/40 hover:bg-muted/40"
            title="Open raw public JSON from Supabase Cloud Storage"
          >
            <CloudArrowDown size={15} />
            <span className="hidden sm:inline">Supabase URL</span>
          </a>
        </div>
      </div>

      {/* Metric Highlights — Production Model (Groq LPU / openai/gpt-oss-120b) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Exact Match */}
        <Card className="bg-card/70 backdrop-blur-md border-border/70 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                Exact Match (6 Units)
              </span>
              <Badge variant="success" className="text-[10px] font-mono">
                34 / 36 Stated
              </Badge>
            </div>
            <div className="text-2xl font-bold font-mono tracking-tight text-foreground whitespace-nowrap">
              94.4%
            </div>
            <p className="text-[11px] text-muted-foreground">
              Zero fabricated quantities across all 6 units
            </p>
          </CardContent>
        </Card>

        {/* F1 Score */}
        <Card className="bg-card/70 backdrop-blur-md border-border/70 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                Quantity F1 Score
              </span>
              <Badge variant="info" className="text-[10px] font-mono">
                Prec 100% · Rec 96.8%
              </Badge>
            </div>
            <div className="text-2xl font-bold font-mono tracking-tight text-foreground whitespace-nowrap">
              98.4%
            </div>
            <p className="text-[11px] text-muted-foreground">
              Harmonic mean across 6 billable categories
            </p>
          </CardContent>
        </Card>

        {/* Action Accuracy */}
        <Card className="bg-card/70 backdrop-blur-md border-border/70 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                Action Accuracy
              </span>
              <Badge variant="neutral" className="text-[10px] font-mono">
                32 / 40 Cases
              </Badge>
            </div>
            <div className="text-2xl font-bold font-mono tracking-tight text-foreground whitespace-nowrap">
              80.0%
            </div>
            <p className="text-[11px] text-muted-foreground">
              Quote vs Ask Follow-up vs Human Review
            </p>
          </CardContent>
        </Card>

        {/* Hallucination Rate */}
        <Card className="bg-card/70 backdrop-blur-md border-border/70 shadow-sm hover:shadow-md transition-shadow">
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
              95% CI: [1.4%, 16.5%] · Zero price leaks
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Empirical Evaluation Benchmark Matrix — Exactly 4 Production Models, Sorted by Performance */}
      <Card className="border-border/70 shadow-xs overflow-hidden bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-3 border-b border-border/40">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2 font-bold">
                <Brain size={18} className="text-primary" />
                Empirical Evaluation Benchmark Matrix
              </CardTitle>
              <CardDescription className="text-xs">
                Side-by-side performance ranking across all 40 benchmark cases in dataset v1.
              </CardDescription>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
              <Sparkle size={14} className="text-amber-500" />
              <span>Sorted by Overall Benchmark Score</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50 bg-muted/30">
                <TableHead className="font-semibold text-xs">Model / Engine</TableHead>
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
              {/* Rank 1: Groq LPU (openai/gpt-oss-120b) */}
              <TableRow className="hover:bg-primary/5 bg-primary/5 font-medium border-l-2 border-l-primary">
                <TableCell className="font-medium text-xs py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground">Groq LPU (openai/gpt-oss-120b)</span>
                    <Badge variant="success" className="text-[10px] font-mono py-0">
                      Best Overall · Active Production
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Fast deterministic inference on Groq LPU with multi-layer verification
                  </div>
                </TableCell>
                <TableCell className="text-xs text-right font-bold text-primary">80.0%</TableCell>
                <TableCell className="text-xs text-right font-mono font-bold text-primary">94.4% (34/36)</TableCell>
                <TableCell className="text-xs text-right font-semibold">100.0%</TableCell>
                <TableCell className="text-xs text-right font-semibold">96.8%</TableCell>
                <TableCell className="text-xs text-right font-bold text-primary">98.4%</TableCell>
                <TableCell className="text-xs text-right text-success font-semibold">5.0%</TableCell>
                <TableCell className="text-xs text-right font-mono">0 / 40</TableCell>
              </TableRow>

              {/* Rank 2: Cerebras AI (Wafer-Scale LPU) */}
              <TableRow className="hover:bg-muted/10 font-medium">
                <TableCell className="font-medium text-xs py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">Cerebras LPU (gpt-oss-120b)</span>
                    <Badge variant="info" className="text-[10px] font-mono py-0">
                      Ultra-Fast Fallback
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Sub-second wafer-scale cluster inference for high throughput
                  </div>
                </TableCell>
                <TableCell className="text-xs text-right font-semibold">75.0%</TableCell>
                <TableCell className="text-xs text-right font-mono font-semibold">86.1% (31/36)</TableCell>
                <TableCell className="text-xs text-right">93.4%</TableCell>
                <TableCell className="text-xs text-right">91.9%</TableCell>
                <TableCell className="text-xs text-right font-semibold">92.7%</TableCell>
                <TableCell className="text-xs text-right text-success font-semibold">5.0%</TableCell>
                <TableCell className="text-xs text-right font-mono">0 / 40</TableCell>
              </TableRow>

              {/* Rank 3: Rules Engine (Deterministic) */}
              <TableRow className="hover:bg-muted/10 font-medium">
                <TableCell className="font-medium text-xs py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">Rules Engine</span>
                    <Badge variant="neutral" className="text-[10px] font-mono py-0">
                      Deterministic Fail-Safe
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Regex and pattern extraction engine running with 0 LLM tokens
                  </div>
                </TableCell>
                <TableCell className="text-xs text-right font-semibold">62.5%</TableCell>
                <TableCell className="text-xs text-right font-mono font-semibold">94.4% (34/36)</TableCell>
                <TableCell className="text-xs text-right">100.0%</TableCell>
                <TableCell className="text-xs text-right">95.3%</TableCell>
                <TableCell className="text-xs text-right font-semibold">97.6%</TableCell>
                <TableCell className="text-xs text-right text-warning">7.5%</TableCell>
                <TableCell className="text-xs text-right font-mono">0 / 40</TableCell>
              </TableRow>

              {/* Rank 4: Google Gemini Flash */}
              <TableRow className="hover:bg-muted/10 text-muted-foreground">
                <TableCell className="font-medium text-xs py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">Google Gemini Flash</span>
                    <Badge variant="neutral" className="text-[10px] font-mono py-0">
                      Tertiary Fallback
                    </Badge>
                  </div>
                  <div className="text-[11px] text-amber-500/80 mt-0.5">
                    Evaluated on 10 free-tier cases before rate limiting
                  </div>
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

      {/* Benchmark Cases — Clean Accordion Drop-down Architecture */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">Benchmark Cases</h2>
            <p className="text-xs text-muted-foreground">
              All 40 customer scenarios with drop-down menus revealing the tested inquiry, policy demands, and model output.
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Search bar */}
            <div className="relative flex-1 sm:w-64">
              <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search case ID, keyword..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-card border border-border/70 rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:border-primary/60"
              />
            </div>

            {/* Expand / Collapse All buttons */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExpandAll}
              className="text-xs h-8 px-2.5 flex items-center gap-1 border-border/70"
              title="Expand all test case drop-downs"
            >
              <ArrowsOut size={13} />
              <span className="hidden sm:inline">Expand All</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCollapseAll}
              className="text-xs h-8 px-2.5 flex items-center gap-1 border-border/70"
              title="Collapse all test case drop-downs"
            >
              <ArrowsIn size={13} />
              <span className="hidden sm:inline">Collapse</span>
            </Button>
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveCategory("all")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
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
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                activeCategory === cat
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* 40 Cases — Sleek Accordion Drop-downs */}
        <div className="space-y-3">
          {filteredCases.map((c) => {
            const isExpanded = Boolean(expandedCases[c.id]);
            const isExactAndAction = c.got.exactMatch && c.got.actionCorrect;
            const isActionOnly = c.got.actionCorrect && !c.got.exactMatch;

            return (
              <Card
                key={c.id}
                className="border-border/70 bg-card/60 backdrop-blur-sm shadow-xs hover:border-border transition-all overflow-hidden"
              >
                {/* Accordion Dropdown Header — Always Visible */}
                <div
                  onClick={() => toggleCase(c.id)}
                  className="p-4 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                    <span className="font-mono text-xs font-bold text-foreground bg-muted/80 px-2 py-0.5 rounded border border-border/60 shrink-0">
                      {c.id}
                    </span>
                    <Badge variant="neutral" className="text-[10px] font-mono uppercase tracking-wide shrink-0">
                      {c.category}
                    </Badge>
                    <span className="text-xs font-semibold text-foreground truncate max-w-[280px] sm:max-w-md">
                      {c.subject}
                    </span>
                    {c.turnsCount > 1 && (
                      <Badge variant="info" className="text-[10px] font-mono shrink-0">
                        {c.turnsCount} turns
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {isExactAndAction ? (
                      <Badge variant="success" className="text-[11px] font-mono py-0.5 px-2 flex items-center gap-1">
                        <CheckCircle size={13} weight="bold" />
                        <span className="hidden sm:inline">Exact Match ✓</span>
                      </Badge>
                    ) : isActionOnly ? (
                      <Badge variant="info" className="text-[11px] font-mono py-0.5 px-2 flex items-center gap-1">
                        <CheckCircle size={13} />
                        <span className="hidden sm:inline">Action Match</span>
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="text-[11px] font-mono py-0.5 px-2 flex items-center gap-1">
                        <WarningCircle size={13} weight="bold" />
                        <span className="hidden sm:inline">Action Mismatch</span>
                      </Badge>
                    )}

                    <div
                      className={`p-1 rounded-md text-muted-foreground hover:text-foreground transition-transform duration-200 ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    >
                      <CaretDown size={16} weight="bold" />
                    </div>
                  </div>
                </div>

                {/* Dropdown Content — Toggled smoothly */}
                {isExpanded && (
                  <CardContent className="px-5 pb-5 pt-1 space-y-3.5 border-t border-border/40 bg-muted/5">
                    {/* 1. Tested Customer Inquiry (Input) */}
                    <div className="space-y-1.5 pt-2">
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <ChatCircleText size={14} className="text-primary" />
                        <span>Tested Customer Inquiry (Input)</span>
                      </div>
                      <div className="bg-muted/40 border border-border/50 rounded-lg p-3 text-xs text-foreground font-sans whitespace-pre-wrap leading-relaxed select-text">
                        {c.testedContent}
                      </div>
                    </div>

                    {/* 2. Expected Requirements (Benchmark Ground Truth) */}
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <CheckCircle size={14} className="text-emerald-500" />
                        <span>Ground Truth (Expected Requirements)</span>
                      </div>
                      <div className="bg-background/90 border border-border/50 rounded-lg p-3 flex flex-wrap items-center gap-2">
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

                    {/* 3. AI Extracted Output */}
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <Brain size={14} className="text-primary" />
                        <span>AI Model Output (Extracted Demands)</span>
                      </div>
                      <div className="bg-background/90 border border-border/50 rounded-lg p-3 flex flex-wrap items-center gap-2">
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
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
