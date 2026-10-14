"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Tray,
  ClockCountdown,
  Receipt,
  WarningCircle,
  Timer,
  MagnifyingGlass,
  ArrowClockwise,
  ChatCircleText,
  CaretRight,
  ArrowsClockwise,
} from "@phosphor-icons/react";

import { useOverviewMetrics, useThreads } from "@/hooks/use-api";
import { formatMoney } from "@/server/pricing/money";
import { formatRelativeTime, formatDateTime, cn } from "@/lib/utils";
import type { RequestType, ThreadStatus } from "@/types/domain";

import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

type FilterStatus = "all" | "completed" | "awaiting_reply" | "pricing" | "received" | "failed";

const STATUS_FILTERS: { label: string; value: FilterStatus }[] = [
  { label: "All", value: "all" },
  { label: "Completed", value: "completed" },
  { label: "Awaiting Reply", value: "awaiting_reply" },
  { label: "Pricing", value: "pricing" },
  { label: "Received", value: "received" },
  { label: "Failed", value: "failed" },
];

function getStatusBadge(status: ThreadStatus): {
  label: string;
  variant: "default" | "primary" | "success" | "warning" | "danger" | "info" | "neutral";
} {
  switch (status) {
    case "completed":
      return { label: "Completed", variant: "success" };
    case "awaiting_reply":
      return { label: "Awaiting Reply", variant: "warning" };
    case "pricing":
      return { label: "Pricing", variant: "primary" };
    case "extracting":
      return { label: "Extracting", variant: "info" };
    case "document_generation":
      return { label: "Generating Doc", variant: "primary" };
    case "sending":
      return { label: "Sending", variant: "primary" };
    case "received":
      return { label: "Received", variant: "info" };
    case "failed":
      return { label: "Failed", variant: "danger" };
    case "unsupported":
      return { label: "Unsupported", variant: "neutral" };
    default:
      return { label: status, variant: "default" };
  }
}

function getRequestTypeBadge(type: RequestType): {
  label: string;
  variant: "default" | "primary" | "success" | "warning" | "danger" | "info" | "neutral";
} {
  switch (type) {
    case "quote":
      return { label: "Quote", variant: "primary" };
    case "proposal":
      return { label: "Proposal", variant: "info" };
    case "clarification":
      return { label: "Clarification", variant: "warning" };
    default:
      return { label: "General", variant: "neutral" };
  }
}

export default function InboxPage() {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<FilterStatus>("all");

  const queryParams = React.useMemo(() => {
    const params: Record<string, string | undefined> = {};
    if (statusFilter !== "all") {
      params.status = statusFilter;
    }
    if (search.trim()) {
      params.search = search.trim();
    }
    return params;
  }, [statusFilter, search]);

  const {
    data: threads,
    isLoading: threadsLoading,
    isFetching: threadsFetching,
    refetch: refetchThreads,
  } = useThreads(queryParams);

  const {
    data: metrics,
    isLoading: metricsLoading,
    isFetching: metricsFetching,
    refetch: refetchMetrics,
  } = useOverviewMetrics();

  const handleRefresh = React.useCallback(() => {
    void refetchThreads();
    void refetchMetrics();
  }, [refetchThreads, refetchMetrics]);

  const isRefreshing = threadsFetching || metricsFetching;

  // Filter threads client-side as well for immediate UX responsiveness
  const filteredThreads = React.useMemo(() => {
    if (!threads) return [];
    return threads.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesSender = t.senderEmail.toLowerCase().includes(q);
        const matchesName = t.senderName?.toLowerCase().includes(q) ?? false;
        const matchesOrg = t.organisation?.toLowerCase().includes(q) ?? false;
        const matchesSubject = t.subject.toLowerCase().includes(q);
        return matchesSender || matchesName || matchesOrg || matchesSubject;
      }
      return true;
    });
  }, [threads, statusFilter, search]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Operations Overview &amp; Inbox
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time inbound email threads, requirement extraction, and automated quote generation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-8 gap-1.5 text-xs"
          >
            <ArrowClockwise
              className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin text-primary")}
            />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Top Summary Metric Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {/* Metric 1: Total Received */}
        <Card className="border-border/80 bg-surface shadow-xs transition-shadow hover:shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
            <span className="text-xs font-medium text-muted-foreground">
              Total Received
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground">
              <Tray className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {metricsLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="text-2xl font-bold tracking-tight text-foreground">
                {metrics?.emailsReceived ?? 0}
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">Inbound pipeline</p>
          </CardContent>
        </Card>

        {/* Metric 2: Awaiting Reply */}
        <Card className="border-border/80 bg-surface shadow-xs transition-shadow hover:shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
            <span className="text-xs font-medium text-muted-foreground">
              Awaiting Reply
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-warning-soft text-warning-soft-foreground">
              <ClockCountdown className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {metricsLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="text-2xl font-bold tracking-tight text-warning-soft-foreground">
                {metrics?.pendingClarifications ?? 0}
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">Pending clarification</p>
          </CardContent>
        </Card>

        {/* Metric 3: Quotes Generated */}
        <Card className="border-border/80 bg-surface shadow-xs transition-shadow hover:shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
            <span className="text-xs font-medium text-muted-foreground">
              Quotes Generated
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-success-soft text-success-soft-foreground">
              <Receipt className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {metricsLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="text-2xl font-bold tracking-tight text-success-soft-foreground">
                {metrics?.quotesGenerated ?? 0}
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">Valid price options</p>
          </CardContent>
        </Card>

        {/* Metric 4: Delivery Failures */}
        <Card className="border-border/80 bg-surface shadow-xs transition-shadow hover:shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
            <span className="text-xs font-medium text-muted-foreground">
              Delivery Failures
            </span>
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md",
                (metrics?.deliveryFailures ?? 0) > 0
                  ? "bg-danger-soft text-danger-soft-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <WarningCircle className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {metricsLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div
                className={cn(
                  "text-2xl font-bold tracking-tight",
                  (metrics?.deliveryFailures ?? 0) > 0
                    ? "text-danger-soft-foreground"
                    : "text-foreground"
                )}
              >
                {metrics?.deliveryFailures ?? 0}
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">Requires attention</p>
          </CardContent>
        </Card>

        {/* Metric 5: Median Processing Time */}
        <Card className="col-span-2 border-border/80 bg-surface shadow-xs transition-shadow hover:shadow-sm sm:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
            <span className="text-xs font-medium text-muted-foreground">
              Median Processing
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-info-soft text-info-soft-foreground">
              <Timer className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {metricsLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="text-2xl font-bold tracking-tight text-foreground font-mono">
                {metrics?.medianProcessingSeconds ? `${metrics.medianProcessingSeconds}s` : "—"}
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">Ingress to quotation</p>
          </CardContent>
        </Card>
      </div>

      {/* Controls Bar */}
      <Card className="border-border/80 bg-surface shadow-xs">
        <div className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between">
          {/* Search Box */}
          <div className="relative flex-1 sm:max-w-md">
            <MagnifyingGlass className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by sender, organisation, or subject..."
              className="flex h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 py-1.5 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>

          {/* Status Tabs / Filter Pills */}
          <div className="flex flex-wrap items-center gap-1 overflow-x-auto">
            {STATUS_FILTERS.map((f) => {
              const active = statusFilter === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setStatusFilter(f.value)}
                  className={cn(
                    "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors select-none",
                    active
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Thread List Table */}
      <Card className="border-border/80 bg-surface shadow-xs overflow-hidden">
        {threadsLoading ? (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-20" />
            </div>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4 py-3 border-b border-border/50">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-5 w-64" />
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-6 w-20" />
              </div>
            ))}
          </div>
        ) : filteredThreads.length === 0 ? (
          <EmptyState
            icon={Tray}
            title="No threads found"
            description={
              search.trim() || statusFilter !== "all"
                ? "No email threads match the current filter criteria. Try adjusting your query or resetting filters."
                : "No inbound email threads received yet."
            }
            action={
              (search.trim() || statusFilter !== "all") && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("all");
                  }}
                >
                  Reset all filters
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border bg-surface-sunken/60 hover:bg-surface-sunken/60">
                  <TableHead className="w-[140px]">Status</TableHead>
                  <TableHead className="min-w-[190px]">Sender</TableHead>
                  <TableHead className="min-w-[260px]">Subject</TableHead>
                  <TableHead className="w-[110px]">Type</TableHead>
                  <TableHead className="w-[120px]">Last Activity</TableHead>
                  <TableHead numeric className="w-[130px]">Quote Amount</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredThreads.map((thread) => {
                  const statusInfo = getStatusBadge(thread.status);
                  const typeInfo = getRequestTypeBadge(thread.requestType);

                  let quoteDisplay: React.ReactNode = "—";
                  if (thread.quoteTotal != null && thread.currency) {
                    quoteDisplay = (
                      <span className="font-mono font-medium text-foreground">
                        {formatMoney(thread.quoteTotal, thread.currency)}
                      </span>
                    );
                  } else if (thread.status === "pricing" || thread.status === "extracting") {
                    quoteDisplay = (
                      <span className="text-xs text-primary font-medium inline-flex items-center gap-1">
                        <ArrowsClockwise className="h-3 w-3 animate-spin" />
                        Calculating...
                      </span>
                    );
                  } else if (thread.status === "awaiting_reply") {
                    quoteDisplay = (
                      <span className="text-xs text-muted-foreground italic">
                        Pending reply
                      </span>
                    );
                  }

                  return (
                    <TableRow
                      key={thread.id}
                      onClick={() => router.push(`/threads/${thread.id}`)}
                      className="group cursor-pointer border-b border-border transition-colors hover:bg-muted/40"
                    >
                      {/* Status Column */}
                      <TableCell className="py-3.5">
                        <div className="flex items-center gap-2">
                          <StatusDot status={thread.status} />
                          <Badge variant={statusInfo.variant} className="text-[11px] font-medium">
                            {statusInfo.label}
                          </Badge>
                        </div>
                      </TableCell>

                      {/* Sender Column */}
                      <TableCell className="py-3.5">
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground text-sm leading-tight">
                            {thread.senderName || "Unknown Sender"}
                          </span>
                          <span className="text-xs text-muted-foreground mt-0.5 truncate max-w-[220px]">
                            {thread.senderEmail}
                            {thread.organisation ? ` • ${thread.organisation}` : ""}
                          </span>
                        </div>
                      </TableCell>

                      {/* Subject + Message Count Column */}
                      <TableCell className="py-3.5">
                        <div className="flex items-center gap-2 max-w-md">
                          <span className="font-medium text-foreground text-sm line-clamp-1 group-hover:text-primary transition-colors">
                            {thread.subject}
                          </span>
                          <Badge
                            variant="neutral"
                            className="shrink-0 text-[10px] py-0 px-1.5 font-mono text-muted-foreground flex items-center gap-1"
                          >
                            <ChatCircleText className="h-3 w-3" />
                            {thread.messageCount}
                          </Badge>
                        </div>
                        {thread.status === "failed" && thread.statusDetail && (
                          <p className="mt-1 text-xs text-danger line-clamp-1">
                            {thread.statusDetail}
                          </p>
                        )}
                      </TableCell>

                      {/* Request Type Column */}
                      <TableCell className="py-3.5">
                        <Badge variant={typeInfo.variant} className="text-[11px] capitalize">
                          {typeInfo.label}
                        </Badge>
                      </TableCell>

                      {/* Last Activity Column */}
                      <TableCell className="py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                        <span title={formatDateTime(thread.lastMessageAt || thread.updatedAt)}>
                          {formatRelativeTime(thread.lastMessageAt || thread.updatedAt)}
                        </span>
                      </TableCell>

                      {/* Quote Amount Column */}
                      <TableCell numeric className="py-3.5 text-sm tabular">
                        {quoteDisplay}
                      </TableCell>

                      {/* Row Click Indicator */}
                      <TableCell className="py-3.5 text-right pr-3">
                        <CaretRight className="h-4 w-4 text-muted-foreground opacity-30 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all inline-block" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
