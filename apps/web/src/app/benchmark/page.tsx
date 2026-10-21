"use client";

import * as React from "react";
import {
  ChartBar,
  Play,
  ArrowsClockwise,
  CheckCircle,
  XCircle,
  WarningCircle,
  ShieldCheck,
  Cpu,
  Lightning,
  SlidersHorizontal,
  DownloadSimple,
  MagnifyingGlass,
  Funnel,
  Sparkle,
} from "@phosphor-icons/react";

import { useBenchmarkOverview, useAiProviderConfig } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface CaseEvaluationResult {
  caseId: string;
  caseName: string;
  category: string;
  passed: boolean;
  actionMatch: boolean;
  actionExpected: string;
  actionActual: string;
  quantityAccuracy: {
    exactMatches: number;
    totalExpected: number;
    falsePositives: number;
    falseNegatives: number;
    precision: number;
    recall: number;
    f1: number;
    unitDetails: Record<string, { expected?: number; actual?: number; status: string }>;
  };
  hallucinations: Array<{
    type: string;
    severity: string;
    field: string;
    description: string;
  }>;
  hasHallucination: boolean;
  latencyMs: number;
  notes: string[];
}

interface BenchmarkReport {
  timestamp: string;
  modelOrEngine: string;
  totalCases: number;
  passedCases: number;
  passRate: number;
  accuracy: {
    actionAccuracy: number;
    overallQuantityPrecision: number;
    overallQuantityRecall: number;
    overallQuantityF1: number;
    exactMatchRate: number;
  };
  hallucination: {
    totalHallucinations: number;
    casesWithHallucination: number;
    hallucinationFreeRate: number;
    byType: Record<string, number>;
  };
  categoryBreakdown: Record<
    string,
    {
      total: number;
      passed: number;
      passRate: number;
      actionAccuracy: number;
      exactMatchRate: number;
      hallucinations: number;
    }
  >;
  caseResults: CaseEvaluationResult[];
}

export default function BenchmarkPage() {
  const { data: overview, isLoading: overviewLoading } = useBenchmarkOverview();
  const { data: aiConfig } = useAiProviderConfig();

  const [selectedProvider, setSelectedProvider] = React.useState<string>("rules");
  const [selectedCategory, setSelectedCategory] = React.useState<string>("all");
  const [activeTab, setActiveTab] = React.useState<"results" | "taxonomy" | "dataset">("results");
  const [isRunning, setIsRunning] = React.useState<boolean>(false);
  const [report, setReport] = React.useState<BenchmarkReport | null>(null);
  const [runError, setRunError] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState<string>("");

  // Default to active AI provider if available
  React.useEffect(() => {
    if (aiConfig?.activeProvider) {
      setSelectedProvider(aiConfig.activeProvider);
    }
  }, [aiConfig?.activeProvider]);

  const handleRunBenchmark = async () => {
    setIsRunning(true);
    setRunError(null);
    try {
      const res = await fetch("/api/v1/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          category: selectedCategory === "all" ? undefined : selectedCategory,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setRunError(data.error || "Benchmark run failed.");
      } else {
        setReport(data.report);
        setActiveTab("results");
      }
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  };

  const filteredCases = React.useMemo(() => {
    if (!overview?.dataset.cases) return [];
    return overview.dataset.cases.filter((c) => {
      const matchesCategory = selectedCategory === "all" || c.category === selectedCategory;
      const matchesSearch =
        searchQuery === "" ||
        c.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.subject.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [overview?.dataset.cases, selectedCategory, searchQuery]);

  return (
    <div className="flex-1 space-y-6 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ChartBar className="h-6 w-6 text-primary" weight="bold" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              AI Evaluation Benchmark
            </h1>
            <Badge variant="primary" className="text-xs font-mono font-medium">
              v1.0.0
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Ground-truth evaluation detecting accuracy, hallucination patterns, and guard rescue rates across customer RFQ scenarios.
          </p>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(overview?.dataset.cases ?? [], null, 2));
              const downloadAnchor = document.createElement("a");
              downloadAnchor.setAttribute("href", dataStr);
              downloadAnchor.setAttribute("download", "benchmark-dataset-v1.json");
              document.body.appendChild(downloadAnchor);
              downloadAnchor.click();
              downloadAnchor.remove();
            }}
            className="h-9 text-xs gap-1.5"
          >
            <DownloadSimple className="h-3.5 w-3.5" />
            Export Dataset
          </Button>

          <Button
            size="sm"
            onClick={handleRunBenchmark}
            disabled={isRunning}
            className="h-9 text-xs gap-2 shadow-xs"
          >
            {isRunning ? (
              <ArrowsClockwise className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" weight="fill" />
            )}
            {isRunning ? "Running Benchmark..." : "Run Evaluation"}
          </Button>
        </div>
      </div>

      {/* Provider & Filter Bar Card */}
      <Card className="border-border bg-surface shadow-xs">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Provider Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-primary" />
                Select Evaluation Model / Provider:
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { id: "rules", label: "Rules Baseline", icon: SlidersHorizontal },
                  { id: "ollama", label: "Local Ollama (llama3.2:1b)", icon: Cpu },
                  { id: "groq", label: "Groq LPU (Cloud)", icon: Lightning },
                  { id: "gemini", label: "Gemini 3.8", icon: Sparkle },
                  { id: "cerebras", label: "Cerebras CS-3", icon: Cpu },
                ].map((prov) => {
                  const Icon = prov.icon;
                  const isSelected = selectedProvider === prov.id;
                  return (
                    <button
                      key={prov.id}
                      type="button"
                      onClick={() => setSelectedProvider(prov.id)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                        isSelected
                          ? "border-primary bg-primary-soft text-primary font-semibold shadow-2xs"
                          : "border-border text-muted-foreground hover:bg-surface-soft hover:text-foreground"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" weight={isSelected ? "bold" : "regular"} />
                      <span>{prov.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Category Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Funnel className="h-3.5 w-3.5 text-primary" />
                Category Filter:
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="h-8 rounded-md border border-border bg-surface px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="all">All Categories ({overview?.dataset.totalCases ?? 40} cases)</option>
                {overview?.dataset.categories &&
                  Object.entries(overview.dataset.categories).map(([cat, count]) => (
                    <option key={cat} value={cat}>
                      {cat.replace(/_/g, " ")} ({count})
                    </option>
                  ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Banner */}
      {runError && (
        <div className="flex items-center gap-2 p-3.5 rounded-lg border border-danger/30 bg-danger-soft text-xs text-danger">
          <XCircle className="h-4 w-4 shrink-0 text-danger" weight="fill" />
          <span>{runError}</span>
        </div>
      )}

      {/* Headline Metric KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {/* Pass Rate */}
        <Card className="border-border bg-surface shadow-xs">
          <CardContent className="p-4 sm:p-5 space-y-1">
            <div className="text-xs text-muted-foreground font-medium flex items-center justify-between">
              <span>Overall Pass Rate</span>
              <CheckCircle className="h-4 w-4 text-success" />
            </div>
            <div className="text-2xl font-bold tracking-tight text-foreground">
              {report ? `${(report.passRate * 100).toFixed(1)}%` : overviewLoading ? "..." : "Ready"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {report ? `${report.passedCases} of ${report.totalCases} cases passed` : "Click 'Run Evaluation' to score"}
            </div>
          </CardContent>
        </Card>

        {/* Action Accuracy */}
        <Card className="border-border bg-surface shadow-xs">
          <CardContent className="p-4 sm:p-5 space-y-1">
            <div className="text-xs text-muted-foreground font-medium flex items-center justify-between">
              <span>Action Accuracy</span>
              <ShieldCheck className="h-4 w-4 text-primary" />
            </div>
            <div className="text-2xl font-bold tracking-tight text-foreground">
              {report ? `${(report.accuracy.actionAccuracy * 100).toFixed(1)}%` : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Quote vs follow-up vs human review
            </div>
          </CardContent>
        </Card>

        {/* Quantity Exact Match */}
        <Card className="border-border bg-surface shadow-xs">
          <CardContent className="p-4 sm:p-5 space-y-1">
            <div className="text-xs text-muted-foreground font-medium flex items-center justify-between">
              <span>Quantity Match (All Units)</span>
              <Cpu className="h-4 w-4 text-warning" />
            </div>
            <div className="text-2xl font-bold tracking-tight text-foreground">
              {report ? `${(report.accuracy.exactMatchRate * 100).toFixed(1)}%` : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {report ? `F1: ${(report.accuracy.overallQuantityF1 * 100).toFixed(1)}% (P: ${(report.accuracy.overallQuantityPrecision * 100).toFixed(0)}%, R: ${(report.accuracy.overallQuantityRecall * 100).toFixed(0)}%)` : "Exact unit sizing accuracy"}
            </div>
          </CardContent>
        </Card>

        {/* Hallucination Rate */}
        <Card className="border-border bg-surface shadow-xs">
          <CardContent className="p-4 sm:p-5 space-y-1">
            <div className="text-xs text-muted-foreground font-medium flex items-center justify-between">
              <span>Hallucination-Free</span>
              <WarningCircle className="h-4 w-4 text-danger" />
            </div>
            <div className="text-2xl font-bold tracking-tight text-foreground">
              {report ? `${(report.hallucination.hallucinationFreeRate * 100).toFixed(1)}%` : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {report ? `${report.hallucination.casesWithHallucination} cases flagged with hallucinations` : "Ungrounded claims & pricing leaks"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("results")}
          className={cn(
            "px-4 py-2 text-xs font-semibold border-b-2 transition-all flex items-center gap-2",
            activeTab === "results"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <ChartBar className="h-4 w-4" />
          <span>Evaluation Results</span>
          {report && (
            <Badge variant="primary" className="text-[10px] py-0 px-1.5 font-bold">
              {report.totalCases}
            </Badge>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("taxonomy")}
          className={cn(
            "px-4 py-2 text-xs font-semibold border-b-2 transition-all flex items-center gap-2",
            activeTab === "taxonomy"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <ShieldCheck className="h-4 w-4" />
          <span>Hallucination Taxonomy</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("dataset")}
          className={cn(
            "px-4 py-2 text-xs font-semibold border-b-2 transition-all flex items-center gap-2",
            activeTab === "dataset"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>Dataset Explorer ({overview?.dataset.totalCases ?? 40})</span>
        </button>
      </div>

      {/* Tab 1: Evaluation Results */}
      {activeTab === "results" && (
        <div className="space-y-6">
          {!report && (
            <div className="p-8 text-center rounded-xl border border-dashed border-border bg-surface-soft/30 space-y-3">
              <Play className="h-8 w-8 text-muted-foreground mx-auto" />
              <div className="text-sm font-semibold text-foreground">
                No active benchmark run loaded
              </div>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Click <span className="font-semibold text-foreground">Run Evaluation</span> above to execute the benchmark against <span className="font-semibold">{selectedProvider.toUpperCase()}</span> across all 40 ground-truth cases.
              </p>
              <Button size="sm" onClick={handleRunBenchmark} disabled={isRunning} className="text-xs gap-1.5">
                <Play className="h-3.5 w-3.5" weight="fill" />
                Run Benchmark Now
              </Button>
            </div>
          )}

          {report && (
            <>
              {/* Category Breakdown Table */}
              <Card className="border-border bg-surface shadow-xs">
                <div className="p-4 border-b border-border/60">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Performance by Category ({report.modelOrEngine})
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-surface-soft/40 text-muted-foreground">
                        <th className="p-3 font-semibold">Category</th>
                        <th className="p-3 font-semibold text-center">Cases</th>
                        <th className="p-3 font-semibold text-center">Pass Rate</th>
                        <th className="p-3 font-semibold text-center">Action Accuracy</th>
                        <th className="p-3 font-semibold text-center">Exact Match</th>
                        <th className="p-3 font-semibold text-center">Hallucinations</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {Object.entries(report.categoryBreakdown).map(([cat, stat]) => (
                        <tr key={cat} className="hover:bg-surface-soft/40 transition-colors">
                          <td className="p-3 font-medium text-foreground capitalize">
                            {cat.replace(/_/g, " ")}
                          </td>
                          <td className="p-3 text-center text-muted-foreground font-mono">{stat.total}</td>
                          <td className="p-3 text-center">
                            <span className={cn(
                              "font-semibold font-mono",
                              stat.passRate >= 0.8 ? "text-success" : stat.passRate >= 0.5 ? "text-warning" : "text-danger"
                            )}>
                              {(stat.passRate * 100).toFixed(0)}%
                            </span>
                          </td>
                          <td className="p-3 text-center font-mono">
                            {(stat.actionAccuracy * 100).toFixed(0)}%
                          </td>
                          <td className="p-3 text-center font-mono">
                            {(stat.exactMatchRate * 100).toFixed(0)}%
                          </td>
                          <td className="p-3 text-center">
                            {stat.hallucinations > 0 ? (
                              <Badge variant="danger" className="text-[10px] py-0 px-1.5 font-bold font-mono">
                                {stat.hallucinations}
                              </Badge>
                            ) : (
                              <span className="text-success font-mono font-medium">0</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Case-by-Case Result List */}
              <Card className="border-border bg-surface shadow-xs">
                <div className="p-4 border-b border-border/60 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Detailed Case Evaluation Results
                  </h3>
                  <Badge variant="neutral" className="text-[10px] font-mono">
                    {report.caseResults.length} cases evaluated
                  </Badge>
                </div>
                <div className="divide-y divide-border/40">
                  {report.caseResults.map((c) => (
                    <div key={c.caseId} className="p-4 hover:bg-surface-soft/30 transition-colors space-y-2.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {c.passed ? (
                            <CheckCircle className="h-4 w-4 text-success shrink-0" weight="fill" />
                          ) : (
                            <XCircle className="h-4 w-4 text-danger shrink-0" weight="fill" />
                          )}
                          <span className="font-mono font-semibold text-xs text-foreground">{c.caseId}</span>
                          <span className="text-xs text-muted-foreground">— {c.caseName}</span>
                          <Badge variant="neutral" className="text-[10px] py-0 px-1.5 capitalize">
                            {c.category.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
                          <span>{c.latencyMs}ms</span>
                          <Badge variant={c.passed ? "success" : "danger"} className="text-[10px] py-0 px-1.5 uppercase font-bold">
                            {c.passed ? "PASSED" : "FAILED"}
                          </Badge>
                        </div>
                      </div>

                      {/* Action & Unit Match Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs bg-surface-soft/60 p-2.5 rounded-lg border border-border/40">
                        <div>
                          <span className="text-muted-foreground text-[11px]">Action Decision:</span>
                          <div className="font-mono mt-0.5 flex items-center gap-1.5">
                            <span className={c.actionMatch ? "text-success font-medium" : "text-danger font-medium line-through"}>
                              {c.actionActual}
                            </span>
                            {!c.actionMatch && (
                              <span className="text-success text-[11px]">(expected: {c.actionExpected})</span>
                            )}
                          </div>
                        </div>

                        <div>
                          <span className="text-muted-foreground text-[11px]">Quantities Sizing:</span>
                          <div className="font-mono mt-0.5">
                            {c.quantityAccuracy.exactMatches === c.quantityAccuracy.totalExpected ? (
                              <span className="text-success font-medium">Exact match on all units</span>
                            ) : (
                              <span className="text-warning font-medium">
                                {c.quantityAccuracy.exactMatches}/{c.quantityAccuracy.totalExpected} units matched
                              </span>
                            )}
                          </div>
                        </div>

                        <div>
                          <span className="text-muted-foreground text-[11px]">Hallucination Guard:</span>
                          <div className="font-mono mt-0.5">
                            {c.hasHallucination ? (
                              <span className="text-danger font-semibold flex items-center gap-1">
                                <WarningCircle className="h-3.5 w-3.5 text-danger" weight="fill" />
                                {c.hallucinations.length} finding(s)
                              </span>
                            ) : (
                              <span className="text-success font-medium">Clean (No hallucinations)</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Hallucination Details if present */}
                      {c.hallucinations.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          {c.hallucinations.map((h, i) => (
                            <div key={i} className="text-xs p-2 rounded border border-danger/30 bg-danger-soft text-danger flex items-start gap-2">
                              <WarningCircle className="h-4 w-4 shrink-0 mt-0.5" weight="fill" />
                              <div className="space-y-0.5">
                                <span className="font-mono font-bold uppercase text-[10px] tracking-wider">
                                  [{h.type} - {h.severity}]
                                </span>
                                <div className="text-[11px]">{h.description}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {/* Tab 2: Hallucination Taxonomy */}
      {activeTab === "taxonomy" && (
        <div className="space-y-4">
          <Card className="border-border bg-surface shadow-xs">
            <CardContent className="p-5 sm:p-6 space-y-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Hallucination Detection Taxonomy &amp; Two-Layer Evaluation
                </h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Every run evaluates both the <span className="font-mono font-medium">raw_model</span> (the LLM output before safety guards) and the <span className="font-mono font-medium">final_system</span> (after deterministic evidence guards, bounds enforcement, and rules reconciliation).
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
                {[
                  {
                    type: "fabricated_quantity",
                    title: "Fabricated Quantity",
                    desc: "Model claims a positive quantity for a unit the customer never requested (e.g. adding 10 servers when customer only asked for website monitoring).",
                  },
                  {
                    type: "contradicted_negation",
                    title: "Contradicted Negation",
                    desc: "Customer explicitly wrote 'no logs needed' or 'skip website monitoring', but the model extracted a non-zero count.",
                  },
                  {
                    type: "distractor_value",
                    title: "Distractor Number Value",
                    desc: "Model extracts a phone number, calendar year, port number (e.g. 443, 8080), or competitor price as a billable unit quantity.",
                  },
                  {
                    type: "unfaithful_evidence",
                    title: "Unfaithful / Invented Evidence",
                    desc: "The quoted evidence string attributed to the customer does not exist in the raw email text.",
                  },
                  {
                    type: "commercial_pricing_leak",
                    title: "Commercial Pricing Leak",
                    desc: "Model hallucinates and presents dollar/rupee pricing amounts. The pricing engine strictly owns all monetary calculations.",
                  },
                  {
                    type: "premature_quote",
                    title: "Premature Quotation",
                    desc: "Model issues a prepare_quote decision when essential information is still missing, bypassing clarification steps.",
                  },
                  {
                    type: "unsupported_category",
                    title: "Unsupported Category / Phantom Plan",
                    desc: "Model refers to plans or add-ons not in the authorized Site24x7 catalog.",
                  },
                  {
                    type: "schema_contradiction",
                    title: "Schema Contradiction",
                    desc: "A unit is simultaneously marked as known and missing, violating schema invariant logic.",
                  },
                  {
                    type: "system_prompt_leak",
                    title: "System Prompt Leak",
                    desc: "Model leaks instruction phrasing, API keys, or system instructions in its conversational response.",
                  },
                ].map((item) => (
                  <div key={item.type} className="p-3.5 rounded-lg border border-border/70 bg-surface-soft/40 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-foreground">{item.title}</span>
                      <Badge variant="neutral" className="text-[10px] font-mono py-0 px-1.5">
                        {item.type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab 3: Dataset Explorer */}
      {activeTab === "dataset" && (
        <div className="space-y-4">
          {/* Search & Category Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <MagnifyingGlass className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search benchmark cases..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border bg-surface text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              Showing <span className="font-semibold text-foreground">{filteredCases.length}</span> of {overview?.dataset.totalCases ?? 40} cases
            </div>
          </div>

          {/* Cases Table */}
          <Card className="border-border bg-surface shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-surface-soft/40 text-muted-foreground">
                    <th className="p-3 font-semibold">ID</th>
                    <th className="p-3 font-semibold">Category</th>
                    <th className="p-3 font-semibold">Subject &amp; Description</th>
                    <th className="p-3 font-semibold">Expected Action</th>
                    <th className="p-3 font-semibold">Expected Units</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredCases.map((c) => (
                    <tr key={c.id} className="hover:bg-surface-soft/40 transition-colors">
                      <td className="p-3 font-mono font-bold text-primary align-top">{c.id}</td>
                      <td className="p-3 align-top">
                        <Badge variant="neutral" className="text-[10px] py-0 px-1.5 capitalize">
                          {c.category.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="p-3 max-w-sm align-top space-y-1">
                        <div className="font-semibold text-foreground">{c.subject}</div>
                        <div className="text-[11px] text-muted-foreground leading-relaxed">{c.description}</div>
                        <div className="mt-1.5 text-[10px] font-mono text-muted-foreground/80 bg-surface-soft/80 p-2 rounded border border-border/30 whitespace-pre-wrap">
                          {c.turns.join("\n\n---\n\n")}
                        </div>
                      </td>
                      <td className="p-3 font-mono font-medium align-top">
                        <Badge variant={c.expectedAction === "prepare_quote" ? "success" : "warning"} className="text-[10px] py-0 px-1.5">
                          {c.expectedAction}
                        </Badge>
                      </td>
                      <td className="p-3 font-mono text-[11px] align-top text-muted-foreground">
                        {Object.entries(c.expectedRequirements).length > 0 ? (
                          <div className="space-y-0.5">
                            {Object.entries(c.expectedRequirements).map(([unit, qty]) => (
                              <div key={unit}>
                                <span className="font-semibold text-foreground">{qty}</span> {unit}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span>— (requires follow-up)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
