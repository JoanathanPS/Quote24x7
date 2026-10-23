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
} from "@phosphor-icons/react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  dataset: "v1" | "v2";
  totalCases: number;
  sharedBaselineCases: number;
  additionalCases: number;
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
}

export default function BenchmarkPage() {
  const [data, setData] = React.useState<BenchmarkApiResponse | null>(null);
  const [dataset, setDataset] = React.useState<"v1" | "v2">("v2");
  const [activeCategory, setActiveCategory] = React.useState<string>("all");
  const [searchQuery, setSearchQuery] = React.useState<string>("");
  const [expandedCases, setExpandedCases] = React.useState<Record<string, boolean>>({});

  const fetchOverview = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/benchmark?dataset=${dataset}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        // Only have the first case open by default, all others collapsed
        if (json.benchmarkCases && json.benchmarkCases.length > 0) {
          setExpandedCases({ [json.benchmarkCases[0].id]: true });
        }
      }
    } catch {
      // ignore
    }
  }, [dataset]);

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
    link.href = `/api/v1/benchmark?dataset=${dataset}&download=dataset`;
    link.download = `benchmark-dataset-${dataset}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDatasetChange = (version: "v1" | "v2") => {
    if (version === dataset) return;
    setData(null);
    setDataset(version);
    setActiveCategory("all");
    setSearchQuery("");
    setExpandedCases({});
  };

  const categories = React.useMemo(() => {
    if (!data?.benchmarkCases) return [];
    return Array.from(new Set(data.benchmarkCases.map((c) => c.category)));
  }, [data?.benchmarkCases]);

  const latestRun = data?.availableRuns[0];
  const percent = (value: number | undefined) => `${((value ?? 0) * 100).toFixed(1)}%`;

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
    <div className="flex-1 space-y-6 p-6 md:p-8 max-w-7xl mx-auto font-sans">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-border/40 pb-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
            <Gauge size={22} weight="bold" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                AI Evaluation Benchmark
              </h1>
              <Badge variant="neutral" className="text-xs">
                Dataset {dataset} ({data?.totalCases ?? "..."} Cases)
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {dataset === "v2"
                ? `Dataset v2 contains ${data?.totalCases ?? "..."} cases: ${data?.sharedBaselineCases ?? 40} shared baseline cases plus ${data?.additionalCases ?? "..."} new cases.`
                : "The original 40-case baseline for accuracy, demand extraction, and hallucination prevention."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <div className="flex rounded-lg border border-border/70 bg-muted/30 p-0.5" role="tablist" aria-label="Benchmark dataset">
            {(["v1", "v2"] as const).map((version) => (
              <Button key={version} variant={dataset === version ? "default" : "ghost"} onClick={() => handleDatasetChange(version)} className="h-8 px-3 text-xs" role="tab" aria-selected={dataset === version}>
                {version.toUpperCase()}
              </Button>
            ))}
          </div>
          <Button variant="outline" onClick={handleDownloadDataset} className="flex items-center gap-2 text-xs font-medium h-8 px-3.5 bg-card/80 hover:bg-muted border-border/80 shadow-xs cursor-pointer">
            <DownloadSimple size={15} weight="bold" className="text-primary" />
            <span>Download JSON</span>
          </Button>
        </div>
      </div>

      {/* Metric Highlights — Clean, normal fonts, concise text */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Exact Match */}
        <Card className="bg-card/70 border-border/70 shadow-xs">
          <CardContent className="p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                Exact Match (6 Units)
              </span>
              <Badge variant={latestRun && latestRun.exactMatch >= 0.95 ? "success" : "neutral"} className="text-[10px]">
                {latestRun ? `${(latestRun.exactMatch * latestRun.casesCount).toFixed(0)} / ${latestRun.casesCount}` : "Awaiting run"}
              </Badge>
            </div>
            <div className="text-2xl font-bold tracking-tight text-foreground whitespace-nowrap">
              {latestRun ? percent(latestRun.exactMatch) : "n/a"}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Across all 6 demand units
            </p>
          </CardContent>
        </Card>

        {/* F1 Score */}
        <Card className="bg-card/70 border-border/70 shadow-xs">
          <CardContent className="p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                Quantity F1 Score
              </span>
            </div>
            <div className="text-2xl font-bold tracking-tight text-foreground whitespace-nowrap">
              {latestRun ? percent(latestRun.f1) : "n/a"}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Precision & recall harmonic mean
            </p>
          </CardContent>
        </Card>

        {/* Action Accuracy */}
        <Card className="bg-card/70 border-border/70 shadow-xs">
          <CardContent className="p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                Action Accuracy
              </span>
              <Badge variant={latestRun && latestRun.actionAccuracy >= 0.95 ? "success" : "neutral"} className="text-[10px]">
                {latestRun ? `${(latestRun.actionAccuracy * latestRun.casesCount).toFixed(0)} / ${latestRun.casesCount} strict` : "Awaiting run"}
              </Badge>
            </div>
            <div className="text-2xl font-bold tracking-tight text-foreground whitespace-nowrap">
              {latestRun ? percent(latestRun.actionAccuracy) : "n/a"}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Quote vs follow-up vs review
            </p>
          </CardContent>
        </Card>

        {/* Hallucination Rate */}
        <Card className="bg-card/70 border-border/70 shadow-xs">
          <CardContent className="p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                Hallucination Rate
              </span>
            </div>
            <div className="text-2xl font-bold tracking-tight text-foreground whitespace-nowrap">
              {latestRun ? percent(latestRun.hallucinatedCaseRate) : "n/a"}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Latest persisted {dataset.toUpperCase()} run
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Benchmark Evaluation — Compact, no scrollbar, no bloated spaces */}
      <Card className="border-border/70 shadow-xs bg-card/60">
        <CardHeader className="py-3 px-4 border-b border-border/40">
          <CardTitle className="text-sm flex items-center gap-2 font-bold text-foreground">
            <Brain size={16} className="text-primary" />
            Benchmark Evaluation
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/50 bg-muted/30">
                  <TableHead className="font-semibold text-xs py-2 px-4 text-left">Model / Engine</TableHead>
                  <TableHead className="font-semibold text-xs py-2 px-3 text-right">Action Accuracy</TableHead>
                  <TableHead className="font-semibold text-xs py-2 px-3 text-right">Exact Match</TableHead>
                  <TableHead className="font-semibold text-xs py-2 px-3 text-right">Precision</TableHead>
                  <TableHead className="font-semibold text-xs py-2 px-3 text-right">Recall</TableHead>
                  <TableHead className="font-semibold text-xs py-2 px-3 text-right">F1 Score</TableHead>
                  <TableHead className="font-semibold text-xs py-2 px-3 text-right">Hallucination</TableHead>
                  <TableHead className="font-semibold text-xs py-2 px-4 text-right">Failures</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="hover:bg-primary/5 bg-primary/5 font-medium border-l-2 border-l-primary">
                  <TableCell className="text-xs py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-foreground whitespace-nowrap">{latestRun?.provider ?? "No persisted run"}</span>
                      <Badge variant={latestRun && latestRun.actionAccuracy >= 0.95 ? "success" : "neutral"} className="text-[10px] py-0 px-1.5 whitespace-nowrap shrink-0">
                        {latestRun ? `${dataset.toUpperCase()} latest` : "Awaiting run"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs py-2.5 px-3 text-right font-bold text-primary">{latestRun ? percent(latestRun.actionAccuracy) : "n/a"}</TableCell>
                  <TableCell className="text-xs py-2.5 px-3 text-right font-bold text-primary">{latestRun ? `${percent(latestRun.exactMatch)} (${Math.round(latestRun.exactMatch * latestRun.casesCount)}/${latestRun.casesCount})` : "n/a"}</TableCell>
                  <TableCell className="text-xs py-2.5 px-3 text-right">n/a</TableCell>
                  <TableCell className="text-xs py-2.5 px-3 text-right">n/a</TableCell>
                  <TableCell className="text-xs py-2.5 px-3 text-right font-bold text-primary">{latestRun ? percent(latestRun.f1) : "n/a"}</TableCell>
                  <TableCell className="text-xs py-2.5 px-3 text-right text-warning">{latestRun ? percent(latestRun.hallucinatedCaseRate) : "n/a"}</TableCell>
                  <TableCell className="text-xs py-2.5 px-4 text-right">{latestRun ? `0 / ${latestRun.casesCount}` : "n/a"}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Benchmark Cases — Clean Accordion Drop-downs */}
      <div className="space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-foreground">Benchmark Cases</h2>
            <p className="text-xs text-muted-foreground">
              {dataset === "v2"
                ? `All ${data?.totalCases ?? "..."} scenarios, including the ${data?.additionalCases ?? "..."} new v2 cases.`
                : `All ${data?.totalCases ?? "..."} baseline scenarios.`}
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Search bar */}
            <div className="relative flex-1 sm:w-60">
              <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search case ID, keyword..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-card border border-border/70 rounded-lg pl-7 pr-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:border-primary/60"
              />
            </div>

            {/* Expand / Collapse All buttons */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExpandAll}
              className="text-xs h-7 px-2 flex items-center gap-1 border-border/70"
              title="Expand all test case drop-downs"
            >
              <ArrowsOut size={12} />
              <span className="hidden sm:inline">Expand All</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCollapseAll}
              className="text-xs h-7 px-2 flex items-center gap-1 border-border/70"
              title="Collapse all test case drop-downs"
            >
              <ArrowsIn size={12} />
              <span className="hidden sm:inline">Collapse</span>
            </Button>
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveCategory("all")}
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
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
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                activeCategory === cat
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* 40 Cases — Accordion Drop-downs */}
        <div className="space-y-2.5">
          {filteredCases.map((c) => {
            const isExpanded = Boolean(expandedCases[c.id]);
            const isExactAndAction = c.got.exactMatch && c.got.actionCorrect;
            const isActionOnly = c.got.actionCorrect && !c.got.exactMatch;

            return (
              <Card
                key={c.id}
                className="border-border/70 bg-card/60 shadow-xs hover:border-border transition-all overflow-hidden"
              >
                {/* Accordion Dropdown Header — Always Visible */}
                <div
                  onClick={() => toggleCase(c.id)}
                  className="py-2.5 px-3.5 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-xs font-bold text-foreground bg-muted/80 px-1.5 py-0.5 rounded border border-border/60 shrink-0">
                      {c.id}
                    </span>
                    <Badge variant="neutral" className="text-[10px] uppercase tracking-wide shrink-0">
                      {c.category}
                    </Badge>
                    <span className="text-xs font-medium text-foreground truncate max-w-[280px] sm:max-w-md">
                      {c.subject}
                    </span>
                    {c.turnsCount > 1 && (
                      <Badge variant="info" className="text-[10px] shrink-0">
                        {c.turnsCount} turns
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isExactAndAction ? (
                      <Badge variant="success" className="text-[11px] py-0 px-2 flex items-center gap-1">
                        <CheckCircle size={13} weight="bold" />
                        <span className="hidden sm:inline">Exact Match</span>
                      </Badge>
                    ) : isActionOnly ? (
                      <Badge variant="info" className="text-[11px] py-0 px-2 flex items-center gap-1">
                        <CheckCircle size={13} />
                        <span className="hidden sm:inline">Action Match</span>
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="text-[11px] py-0 px-2 flex items-center gap-1">
                        <WarningCircle size={13} weight="bold" />
                        <span className="hidden sm:inline">Action Mismatch</span>
                      </Badge>
                    )}

                    <div
                      className={`p-0.5 rounded text-muted-foreground hover:text-foreground transition-transform duration-200 ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    >
                      <CaretDown size={15} weight="bold" />
                    </div>
                  </div>
                </div>

                {/* Dropdown Content */}
                {isExpanded && (
                  <CardContent className="px-4 pb-4 pt-1 space-y-3 border-t border-border/40 bg-muted/5">
                    {/* 1. Tested Customer Inquiry (Input) */}
                    <div className="space-y-1 pt-2">
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <ChatCircleText size={13} className="text-primary" />
                        <span>Tested Customer Inquiry (Input)</span>
                      </div>
                      <div className="bg-muted/40 border border-border/50 rounded-lg p-3 text-xs text-foreground font-sans whitespace-pre-wrap leading-relaxed select-text">
                        {c.testedContent}
                      </div>
                    </div>

                    {/* 2. Expected Requirements (Benchmark Ground Truth) */}
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <CheckCircle size={13} className="text-emerald-500" />
                        <span>Ground Truth (Expected Requirements)</span>
                      </div>
                      <div className="bg-background/90 border border-border/50 rounded-lg p-2.5 flex flex-wrap items-center gap-2">
                        <Badge variant="neutral" className="text-xs font-semibold">
                          Action: {c.expected.action}
                        </Badge>
                        <div className="h-3.5 w-px bg-border/60 mx-1 hidden sm:block" />
                        <span className="text-xs text-muted-foreground font-medium">Demands:</span>
                        {Object.entries(c.expected.quantities).length > 0 ? (
                          Object.entries(c.expected.quantities).map(([unit, qty]) => (
                            <span
                              key={unit}
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-muted text-foreground border border-border/60"
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
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <Brain size={13} className="text-primary" />
                        <span>AI Model Output (Extracted Demands)</span>
                      </div>
                      <div className="bg-background/90 border border-border/50 rounded-lg p-2.5 flex flex-wrap items-center gap-2">
                        <Badge
                          variant={c.got.actionCorrect ? "success" : "danger"}
                          className="text-xs font-semibold flex items-center gap-1"
                        >
                          Action: {c.got.action}
                          {c.got.actionCorrect ? <Check size={12} weight="bold" /> : <X size={12} weight="bold" />}
                        </Badge>

                        <div className="h-3.5 w-px bg-border/60 mx-1 hidden sm:block" />
                        <span className="text-xs text-muted-foreground font-medium">Extracted:</span>

                        {Object.entries(c.got.quantities).length > 0 ? (
                          Object.entries(c.got.quantities).map(([unit, qty]) => {
                            const expQty = c.expected.quantities[unit];
                            const isMatch = expQty === qty;
                            return (
                              <span
                                key={unit}
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs border ${
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
                          <Badge variant="danger" className="text-[10px] ml-auto">
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
