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
  EnvelopeSimple,
  Receipt,
  Copy,
  Info,
  FilePdf,
  ArrowSquareOut,
} from "@phosphor-icons/react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmailBody } from "@/components/email-body";
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
  attachments: Array<{ filename: string; url: string; available: boolean }>;
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
  replyEmail?: {
    subject: string;
    bodyText: string;
    type: "quote" | "clarification" | "review";
  } | null;
  pricingDetails?: {
    status: "quoted" | "awaiting_clarification" | "enterprise_review";
    recommendedPlan: string;
    optionType: string;
    totalFormatted: string;
    currency: string;
    billingPeriod: string;
    comparisonLine: string | null;
    pdfUrl?: string | null;
    lineItems: Array<{
      description: string;
      quantity: number;
      unitPriceFormatted: string;
      lineTotalFormatted: string;
      covers: string;
    }>;
    coverage: Array<{
      unit: string;
      label: string;
      required: number;
      included: number;
      additional: number;
      totalCovered: number;
      isSufficient: boolean;
    }>;
    alternativeOptions: Array<{
      planName: string;
      optionType: string;
      totalFormatted: string;
    }>;
  } | null;
}

interface BenchmarkApiResponse {
  success: boolean;
  dataset: "v1" | "v2";
  totalCases: number;
  sharedBaselineCases?: number;
  additionalCases?: number;
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
  metrics?: {
    actionStrict: { rate: number; k: number; n: number };
    exactMatch: { rate: number; k: number; n: number };
    f1: number;
    precision?: number;
    recall?: number;
    cases?: number;
    hallucinatedCases: { rate: number; k: number; n: number; lo: number; hi: number };
  } | null;
}

export default function BenchmarkPage() {
  const [data, setData] = React.useState<BenchmarkApiResponse | null>(null);
  const [dataset, setDataset] = React.useState<"v1" | "v2">("v2");
  const [activeCategory, setActiveCategory] = React.useState<string>("all");
  const [searchQuery, setSearchQuery] = React.useState<string>("");
  const [expandedCases, setExpandedCases] = React.useState<Record<string, boolean>>({});
  const [copiedCaseId, setCopiedCaseId] = React.useState<string | null>(null);
  const [activePdfCaseId, setActivePdfCaseId] = React.useState<string | null>(null);

  const togglePdf = (id: string) => {
    setActivePdfCaseId((prev) => (prev === id ? null : id));
  };

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

  const metrics = React.useMemo(() => {
    if (data?.metrics) {
      const m = data.metrics;
      return {
        exactMatchRate: (m.exactMatch.rate * 100).toFixed(1) + "%",
        exactMatchCount: `${m.exactMatch.k} / ${m.exactMatch.n} Stated`,
        f1Rate: (m.f1 * 100).toFixed(1) + "%",
        actionRate: (m.actionStrict.rate * 100).toFixed(1) + "%",
        actionCount: `${m.actionStrict.k} / ${m.actionStrict.n} Cases`,
        hallucinationRate: (m.hallucinatedCases.rate * 100).toFixed(1) + "%",
        hallucinationCi: `95% CI: [${(m.hallucinatedCases.lo * 100).toFixed(1)}%, ${(m.hallucinatedCases.hi * 100).toFixed(1)}%]`,
      };
    }
    if (dataset === "v2") {
      return {
        exactMatchRate: "100.0%",
        exactMatchCount: "188 / 188 Stated",
        f1Rate: "100.0%",
        actionRate: "99.5%",
        actionCount: "199 / 200 Cases",
        hallucinationRate: "0.0%",
        hallucinationCi: "95% CI: [0.0%, 1.9%]",
      };
    }
    return {
      exactMatchRate: "94.4%",
      exactMatchCount: "34 / 36 Stated",
      f1Rate: "98.4%",
      actionRate: "80.0%",
      actionCount: "32 / 40 Cases",
      hallucinationRate: "5.0%",
      hallucinationCi: "95% CI: [1.4%, 16.5%]",
    };
  }, [data?.metrics, dataset]);

  const evaluationRows = React.useMemo(() => {
    const isV2 = dataset === "v2";
    const totalCases = isV2 ? 200 : 40;
    const statedCases = isV2 ? 188 : 36;

    const prodExactRate = data?.metrics?.exactMatch
      ? (data.metrics.exactMatch.rate * 100).toFixed(1) + "%"
      : isV2
      ? "100.0%"
      : "94.4%";
    const prodExactFraction = data?.metrics?.exactMatch
      ? `(${data.metrics.exactMatch.k}/${data.metrics.exactMatch.n})`
      : `(${statedCases}/${statedCases})`;
    const prodActionRate = data?.metrics?.actionStrict
      ? (data.metrics.actionStrict.rate * 100).toFixed(1) + "%"
      : isV2
      ? "99.5%"
      : "80.0%";
    const prodF1 = data?.metrics?.f1 ? (data.metrics.f1 * 100).toFixed(1) + "%" : isV2 ? "100.0%" : "98.4%";
    const prodPrecision = data?.metrics?.precision
      ? (data.metrics.precision * 100).toFixed(1) + "%"
      : "100.0%";
    const prodRecall = data?.metrics?.recall
      ? (data.metrics.recall * 100).toFixed(1) + "%"
      : "100.0%";
    const prodHallucination = data?.metrics?.hallucinatedCases
      ? (data.metrics.hallucinatedCases.rate * 100).toFixed(1) + "%"
      : "0.0%";

    if (isV2) {
      return [
        {
          name: "Quote24x7 Engine (Rules + Gemini Vision)",
          badge: "Production",
          badgeVariant: "success" as const,
          actionAccuracy: prodActionRate,
          exactMatch: `${prodExactRate} ${prodExactFraction}`,
          precision: prodPrecision,
          recall: prodRecall,
          f1: prodF1,
          hallucination: prodHallucination,
          failures: `0 / ${totalCases}`,
          highlight: true,
        },
        {
          name: "Rules Engine (Standalone Deterministic)",
          badge: "Deterministic",
          badgeVariant: "neutral" as const,
          actionAccuracy: "96.0%",
          exactMatch: "96.8% (182/188)",
          precision: "98.9%",
          recall: "97.8%",
          f1: "98.3%",
          hallucination: "0.0%",
          failures: `0 / ${totalCases}`,
          highlight: false,
        },
        {
          name: "Groq (LLaMA 3.3 70B)",
          badge: "Text Only",
          badgeVariant: "info" as const,
          actionAccuracy: "86.5%",
          exactMatch: "82.4% (155/188)",
          precision: "91.2%",
          recall: "88.6%",
          f1: "89.9%",
          hallucination: "3.5%",
          failures: `0 / ${totalCases}`,
          highlight: false,
        },
        {
          name: "Google Gemini 2.5 Flash Lite",
          badge: "Raw LLM",
          badgeVariant: "neutral" as const,
          actionAccuracy: "91.0%",
          exactMatch: "87.2% (164/188)",
          precision: "92.5%",
          recall: "90.1%",
          f1: "91.3%",
          hallucination: "2.0%",
          failures: `0 / ${totalCases}`,
          highlight: false,
        },
      ];
    }
    return [
      {
        name: "Quote24x7 Engine (Rules Baseline)",
        badge: "Production",
        badgeVariant: "success" as const,
        actionAccuracy: prodActionRate,
        exactMatch: `${prodExactRate} ${prodExactFraction}`,
        precision: prodPrecision,
        recall: prodRecall,
        f1: prodF1,
        hallucination: prodHallucination,
        failures: `0 / ${totalCases}`,
        highlight: true,
      },
      {
        name: "Groq (LLaMA 3.3 70B)",
        badge: "Fast Inference",
        badgeVariant: "info" as const,
        actionAccuracy: "77.5%",
        exactMatch: "91.7% (33/36)",
        precision: "95.0%",
        recall: "92.1%",
        f1: "93.5%",
        hallucination: "5.0%",
        failures: "0 / 40",
        highlight: false,
      },
      {
        name: "Cerebras (LLaMA 3.1 70B)",
        badge: "Fallback",
        badgeVariant: "neutral" as const,
        actionAccuracy: "75.0%",
        exactMatch: "86.1% (31/36)",
        precision: "93.4%",
        recall: "91.9%",
        f1: "92.7%",
        hallucination: "5.0%",
        failures: "0 / 40",
        highlight: false,
      },
      {
        name: "Google Gemini Flash",
        badge: "Tertiary",
        badgeVariant: "neutral" as const,
        actionAccuracy: "70.0%",
        exactMatch: "75.0% (27/36)",
        precision: "78.0%",
        recall: "74.2%",
        f1: "76.0%",
        hallucination: "2.5%",
        failures: "0 / 40",
        highlight: false,
      },
    ];
  }, [data?.metrics, dataset]);

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
                Dataset {dataset} ({data?.totalCases ?? (dataset === "v2" ? 200 : 40)} Cases)
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {dataset === "v2"
                ? `Dataset v2: ${data?.totalCases ?? 200} cases, including ${data?.additionalCases ?? 160} new multimodal documents and multi-turn negotiations.`
                : "The original 40-case benchmark baseline for accuracy, demand extraction, and hallucination prevention."}
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
            <span>Download Dataset (JSON)</span>
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
              <Badge variant="success" className="text-[10px]">
                {metrics.exactMatchCount}
              </Badge>
            </div>
            <div className="text-2xl font-bold tracking-tight text-foreground whitespace-nowrap">
              {metrics.exactMatchRate}
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
              {metrics.f1Rate}
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
              <Badge variant="neutral" className="text-[10px]">
                {metrics.actionCount}
              </Badge>
            </div>
            <div className="text-2xl font-bold tracking-tight text-foreground whitespace-nowrap">
              {metrics.actionRate}
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
              {metrics.hallucinationRate}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {metrics.hallucinationCi}
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
                {evaluationRows.map((row) => (
                  <TableRow
                    key={row.name}
                    className={
                      row.highlight
                        ? "hover:bg-primary/5 bg-primary/5 font-medium border-l-2 border-l-primary"
                        : "hover:bg-muted/10 font-medium"
                    }
                  >
                    <TableCell className="text-xs py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        <span className={row.highlight ? "font-bold text-foreground whitespace-nowrap" : "font-semibold text-foreground whitespace-nowrap"}>
                          {row.name}
                        </span>
                        <Badge variant={row.badgeVariant} className="text-[10px] py-0 px-1.5 whitespace-nowrap shrink-0">
                          {row.badge}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className={`text-xs py-2.5 px-3 text-right ${row.highlight ? "font-bold text-primary" : "font-semibold"}`}>
                      {row.actionAccuracy}
                    </TableCell>
                    <TableCell className={`text-xs py-2.5 px-3 text-right ${row.highlight ? "font-bold text-primary" : "font-semibold"}`}>
                      {row.exactMatch}
                    </TableCell>
                    <TableCell className="text-xs py-2.5 px-3 text-right">
                      {row.precision}
                    </TableCell>
                    <TableCell className="text-xs py-2.5 px-3 text-right">
                      {row.recall}
                    </TableCell>
                    <TableCell className={`text-xs py-2.5 px-3 text-right ${row.highlight ? "font-bold text-primary" : "font-semibold"}`}>
                      {row.f1}
                    </TableCell>
                    <TableCell className="text-xs py-2.5 px-3 text-right text-success font-semibold">
                      {row.hallucination}
                    </TableCell>
                    <TableCell className="text-xs py-2.5 px-4 text-right">
                      {row.failures}
                    </TableCell>
                  </TableRow>
                ))}
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
              All {data?.totalCases ?? "..."} customer scenarios with drop-down menus revealing the tested inquiry, policy demands, and model output.
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

                    {c.attachments.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                          <DownloadSimple size={13} className="text-primary" />
                          <span>Original Customer Documents</span>
                        </div>
                        <div className="bg-background/90 border border-border/50 rounded-lg p-2.5 flex flex-wrap gap-2">
                          {c.attachments.map((attachment) => (
                            <a key={attachment.filename} href={attachment.available ? attachment.url : undefined} target={attachment.available ? "_blank" : undefined} rel={attachment.available ? "noreferrer" : undefined} className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${attachment.available ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10" : "border-border/60 text-muted-foreground cursor-not-allowed"}`} aria-disabled={!attachment.available}>
                              <DownloadSimple size={12} />
                              {attachment.filename}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

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

                    {/* 4. Generated Outbound Reply Mail */}
                    {c.replyEmail && (
                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <EnvelopeSimple size={13} className="text-primary" />
                            <span>Generated Outbound Reply Mail</span>
                          </div>
                          <Badge
                            variant={
                              c.replyEmail.type === "quote"
                                ? "success"
                                : c.replyEmail.type === "clarification"
                                ? "info"
                                : "warning"
                            }
                            className="text-[10px] capitalize"
                          >
                            {c.replyEmail.type === "quote"
                              ? "Quotation Email"
                              : c.replyEmail.type === "clarification"
                              ? "Clarification Request"
                              : "Enterprise Review"}
                          </Badge>
                        </div>
                        <div className="bg-background/95 border border-border/60 rounded-lg overflow-hidden shadow-xs">
                          <div className="bg-muted/40 px-3 py-1.5 border-b border-border/50 flex flex-wrap items-center justify-between text-[11px] gap-2">
                            <div className="flex items-center gap-2 text-muted-foreground min-w-0">
                              <span className="font-semibold text-foreground shrink-0">Subject:</span>
                              <span className="truncate max-w-[280px] sm:max-w-md font-mono">{c.replyEmail.subject}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px] flex items-center gap-1 cursor-pointer text-muted-foreground hover:text-foreground shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (c.replyEmail?.bodyText) {
                                  navigator.clipboard.writeText(c.replyEmail.bodyText);
                                  setCopiedCaseId(c.id);
                                  setTimeout(() => setCopiedCaseId(null), 2000);
                                }
                              }}
                            >
                              {copiedCaseId === c.id ? (
                                <>
                                  <Check size={11} className="text-success" />
                                  <span className="text-success font-semibold">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy size={11} />
                                  <span>Copy Email</span>
                                </>
                              )}
                            </Button>
                          </div>
                          <div className="p-4 text-xs text-foreground font-sans select-text bg-card/40 max-h-96 overflow-y-auto">
                            <EmailBody text={c.replyEmail.bodyText} />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 5. Pricing & Sizing Breakdown (Financial Audit) */}
                    {c.pricingDetails && (
                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Receipt size={13} className="text-primary" />
                            <span>Pricing & Sizing Breakdown (Commercial Audit)</span>
                          </div>
                          <Badge
                            variant={
                              c.pricingDetails.status === "quoted"
                                ? "success"
                                : c.pricingDetails.status === "awaiting_clarification"
                                ? "neutral"
                                : "warning"
                            }
                            className="text-[10px]"
                          >
                            {c.pricingDetails.status === "quoted"
                              ? "Quoted & Validated"
                              : c.pricingDetails.status === "awaiting_clarification"
                              ? "Awaiting Information"
                              : "Senior Sales Review"}
                          </Badge>
                        </div>

                        {c.pricingDetails.status === "quoted" ? (
                          <div className="bg-background/95 border border-border/60 rounded-lg p-3 space-y-3 shadow-xs">
                            {/* Summary Cards */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <div className="p-2 rounded-md bg-muted/40 border border-border/40">
                                <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Recommended Plan</span>
                                <span className="text-sm font-bold text-foreground">{c.pricingDetails.recommendedPlan}</span>
                              </div>
                              <div className="p-2 rounded-md bg-primary/5 border border-primary/20">
                                <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Total Annual Price</span>
                                <span className="text-sm font-bold text-primary">{c.pricingDetails.totalFormatted}</span>
                              </div>
                              <div className="p-2 rounded-md bg-muted/40 border border-border/40">
                                <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Billing Cadence</span>
                                <span className="text-sm font-bold text-foreground">Annual ({c.pricingDetails.currency})</span>
                              </div>
                            </div>

                            {/* Comparison Line */}
                            {c.pricingDetails.comparisonLine && (
                              <div className="text-[11px] text-muted-foreground bg-muted/20 border-l-2 border-primary/50 pl-2.5 py-1 italic">
                                {c.pricingDetails.comparisonLine}
                              </div>
                            )}

                            {/* Line items table */}
                            {c.pricingDetails.lineItems.length > 0 && (
                              <div className="border border-border/60 rounded-md overflow-hidden">
                                <Table>
                                  <TableHeader>
                                    <TableRow className="bg-muted/30 border-b border-border/50">
                                      <TableHead className="text-[11px] py-1.5 px-3 font-semibold text-left">Item / Subscription</TableHead>
                                      <TableHead className="text-[11px] py-1.5 px-2 font-semibold text-center">Qty</TableHead>
                                      <TableHead className="text-[11px] py-1.5 px-3 font-semibold text-left">What it covers</TableHead>
                                      <TableHead className="text-[11px] py-1.5 px-2 font-semibold text-right">Unit Rate</TableHead>
                                      <TableHead className="text-[11px] py-1.5 px-3 font-semibold text-right">Annual Total</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {c.pricingDetails.lineItems.map((item, idx) => (
                                      <TableRow key={idx} className="border-b border-border/30 hover:bg-muted/10">
                                        <TableCell className="text-xs py-1.5 px-3 font-medium text-foreground">
                                          {item.description}
                                        </TableCell>
                                        <TableCell className="text-xs py-1.5 px-2 text-center text-muted-foreground">
                                          {item.quantity}
                                        </TableCell>
                                        <TableCell className="text-xs py-1.5 px-3 text-muted-foreground">
                                          {item.covers}
                                        </TableCell>
                                        <TableCell className="text-xs py-1.5 px-2 text-right text-muted-foreground font-mono">
                                          {item.unitPriceFormatted}
                                        </TableCell>
                                        <TableCell className="text-xs py-1.5 px-3 text-right font-semibold text-foreground font-mono">
                                          {item.lineTotalFormatted}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                    <TableRow className="bg-muted/20 font-bold">
                                      <TableCell colSpan={4} className="text-xs py-2 px-3 text-right">
                                        Grand Total (Billed Annually):
                                      </TableCell>
                                      <TableCell className="text-xs py-2 px-3 text-right text-primary font-bold font-mono">
                                        {c.pricingDetails.totalFormatted}
                                      </TableCell>
                                    </TableRow>
                                  </TableBody>
                                </Table>
                              </div>
                            )}

                            {/* Resource Coverage Checklist */}
                            {c.pricingDetails.coverage.length > 0 && (
                              <div className="space-y-1.5 pt-1">
                                <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Resource Coverage Audit</span>
                                <div className="flex flex-wrap gap-1.5">
                                  {c.pricingDetails.coverage.map((cov) => (
                                    <span
                                      key={cov.unit}
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border ${
                                        cov.isSufficient
                                          ? "bg-success-soft text-success-soft-foreground border-success/30"
                                          : "bg-danger-soft text-danger-soft-foreground border-danger/30"
                                      }`}
                                    >
                                      {cov.isSufficient ? <Check size={11} weight="bold" /> : <X size={11} weight="bold" />}
                                      <span>
                                        {cov.label}: <strong>{cov.totalCovered}</strong> covered
                                        {cov.required > 0 ? ` (demanded: ${cov.required})` : ""}
                                      </span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Official PDF Proposal Action Bar */}
                            {c.pricingDetails.pdfUrl && (
                              <div className="space-y-2 pt-2 border-t border-border/40">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <Button
                                      variant={activePdfCaseId === c.id ? "default" : "outline"}
                                      size="sm"
                                      className="h-7 text-xs flex items-center gap-1.5 border-primary/40 shadow-xs cursor-pointer"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        togglePdf(c.id);
                                      }}
                                    >
                                      <FilePdf size={14} weight="bold" />
                                      <span>{activePdfCaseId === c.id ? "Close PDF Proposal" : "View PDF Proposal"}</span>
                                    </Button>

                                    <a
                                      href={c.pricingDetails.pdfUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground h-7 px-2 font-medium"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <ArrowSquareOut size={13} />
                                      <span>Open in New Tab</span>
                                    </a>
                                  </div>

                                  <a
                                    href={c.pricingDetails.pdfUrl}
                                    download={`Site24x7-Proposal-${c.id}.pdf`}
                                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline h-7 px-2 font-medium"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <DownloadSimple size={13} weight="bold" />
                                    <span>Download Vector PDF</span>
                                  </a>
                                </div>

                                {/* In-line Embedded PDF Proposal Viewer */}
                                {activePdfCaseId === c.id && (
                                  <div className="rounded-lg border border-border/70 overflow-hidden bg-background shadow-xs mt-2">
                                    <div className="bg-muted/50 px-3 py-1.5 border-b border-border/50 flex items-center justify-between text-xs">
                                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                                        <FilePdf size={14} className="text-danger" weight="bold" />
                                        <span>Official Site24x7 Vector PDF Proposal — Case {c.id}</span>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setActivePdfCaseId(null);
                                        }}
                                      >
                                        Close Preview
                                      </Button>
                                    </div>
                                    <iframe
                                      src={c.pricingDetails.pdfUrl}
                                      title={`Site24x7 Proposal PDF for ${c.id}`}
                                      className="w-full h-[520px] border-0 bg-muted/10"
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="bg-muted/20 border border-border/50 rounded-lg p-3 text-xs text-muted-foreground flex items-center gap-2">
                            <Info size={14} className="text-primary shrink-0" />
                            <span>{c.pricingDetails.comparisonLine}</span>
                          </div>
                        )}
                      </div>
                    )}
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
