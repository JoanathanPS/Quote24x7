"use client";

import * as React from "react";
import Link from "next/link";
import {
  Heartbeat,
  XCircle,
  ArrowsClockwise,
} from "@phosphor-icons/react";

import { useSystemHealth, useOverviewMetrics } from "@/hooks/use-api";
import { formatDateTime, cn } from "@/lib/utils";
import type { HealthLevel, ActivityBucket, ThreadStatus } from "@/types/domain";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

function getHealthLevelBadge(level: HealthLevel): {
  label: string;
  variant: "default" | "primary" | "success" | "warning" | "danger" | "info" | "neutral";
  colorClass: string;
} {
  switch (level) {
    case "ok":
      return { label: "Healthy", variant: "success", colorClass: "bg-success text-success" };
    case "degraded":
      return { label: "Degraded Performance", variant: "warning", colorClass: "bg-warning text-warning" };
    case "down":
      return { label: "Outage / Offline", variant: "danger", colorClass: "bg-danger text-danger" };
    default:
      return { label: "Status Unknown", variant: "neutral", colorClass: "bg-muted-foreground text-muted-foreground" };
  }
}

export default function HealthPage() {
  const {
    data: health,
    isLoading: healthLoading,
    error: healthError,
    refetch: refetchHealth,
  } = useSystemHealth();

  const {
    data: metrics,
    isLoading: metricsLoading,
    error: metricsError,
    refetch: refetchMetrics,
  } = useOverviewMetrics();

  const isLoading = healthLoading || metricsLoading;
  const isError = healthError || metricsError;

  const handleRefresh = () => {
    refetchHealth();
    refetchMetrics();
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96" />
          </div>
          <Skeleton className="h-9 w-32" />
        </div>
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !health) {
    return (
      <EmptyState
        icon={XCircle}
        title="Failed to load system health"
        description="Could not query system readiness checks and operational metrics."
        action={
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <ArrowsClockwise className="h-4 w-4 mr-1.5" />
            Retry
          </Button>
        }
      />
    );
  }

  const overallBadge = getHealthLevelBadge(health.overall);

  // Compute max daily total for activity visualization
  const maxDailyCount = metrics?.activity
    ? Math.max(...metrics.activity.map((a) => a.received + a.quoted + a.clarified), 1)
    : 1;

  // Status breakdown list
  const statusEntries = metrics?.threadsByStatus
    ? (Object.entries(metrics.threadsByStatus) as [ThreadStatus, number][])
    : [];

  const totalStatusThreads = statusEntries.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Heartbeat className="h-6 w-6 text-primary" weight="duotone" />
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              System Health
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Service status and pipeline activity metrics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            className="h-9"
          >
            <ArrowsClockwise className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Status Banner */}
      <Card className="border-border bg-surface shadow-xs overflow-hidden">
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={overallBadge.variant} className="px-2.5 py-0.5 text-xs font-semibold">
                <span className="flex h-2 w-2 rounded-full bg-current mr-1.5" />
                {overallBadge.label}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Last checked: {formatDateTime(health.checkedAt)}
              </span>
            </div>

            {/* Kill switch indicator */}
            <div className="flex items-center gap-2">
              {health.outboundSendingPaused ? (
                <Badge variant="warning" className="text-xs font-semibold">
                  Kill Switch: Outbound Dispatch Paused
                </Badge>
              ) : (
                <Badge variant="success" className="text-xs font-semibold">
                  Kill Switch: Outbound Dispatch Active
                </Badge>
              )}
              <Link href="/settings" className="text-xs text-primary hover:underline font-medium">
                Configure in Settings →
              </Link>
            </div>
          </div>
        </div>
      </Card>

      {/* Operational Metrics & Activity */}
      {metrics && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Activity Metrics
            </h2>
          </div>

          {/* Metric KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Card className="border-border bg-surface shadow-xs">
              <CardContent className="p-4">
                <span className="text-xs text-muted-foreground block font-medium">Emails Processed</span>
                <span className="text-2xl font-bold text-foreground mt-0.5 block">
                  {metrics.emailsReceived}
                </span>
                <span className="text-[10px] text-muted-foreground block mt-1">Inbound transmissions</span>
              </CardContent>
            </Card>

            <Card className="border-border bg-surface shadow-xs">
              <CardContent className="p-4">
                <span className="text-xs text-muted-foreground block font-medium">Quotes Generated</span>
                <span className="text-2xl font-bold text-primary mt-0.5 block">
                  {metrics.quotesGenerated}
                </span>
                <span className="text-[10px] text-muted-foreground block mt-1">Validated price options</span>
              </CardContent>
            </Card>

            <Card className="border-border bg-surface shadow-xs">
              <CardContent className="p-4">
                <span className="text-xs text-muted-foreground block font-medium">Pending Clarifications</span>
                <span className="text-2xl font-bold text-warning mt-0.5 block">
                  {metrics.pendingClarifications}
                </span>
                <span className="text-[10px] text-muted-foreground block mt-1">Awaiting buyer response</span>
              </CardContent>
            </Card>

            <Card className="border-border bg-surface shadow-xs">
              <CardContent className="p-4">
                <span className="text-xs text-muted-foreground block font-medium">Dead-letter Depth</span>
                <span className={cn("text-2xl font-bold mt-0.5 block", metrics.deadLetterCount > 0 ? "text-danger" : "text-success")}>
                  {metrics.deadLetterCount}
                </span>
                <span className="text-[10px] text-muted-foreground block mt-1">Unrecoverable queue</span>
              </CardContent>
            </Card>

            <Card className="border-border bg-surface shadow-xs">
              <CardContent className="p-4">
                <span className="text-xs text-muted-foreground block font-medium">Median Turnaround</span>
                <span className="text-2xl font-bold text-foreground mt-0.5 block">
                  {metrics.medianProcessingSeconds !== null ? `${metrics.medianProcessingSeconds}s` : "N/A"}
                </span>
                <span className="text-[10px] text-muted-foreground block mt-1">Email to quote document</span>
              </CardContent>
            </Card>
          </div>

          {/* Daily Activity Visual & Status Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 7-Day Activity Visualization */}
            <Card className="lg:col-span-2 border-border bg-surface shadow-xs">
              <CardHeader className="pb-3 border-b border-border/40">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold">Daily Pipeline Activity</CardTitle>
                    <CardDescription className="text-xs">
                      Emails received, quotations built, and clarifications dispatched per day.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded bg-info" />
                      Received
                    </span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded bg-primary" />
                      Quoted
                    </span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded bg-warning" />
                      Clarified
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  {metrics.activity.map((bucket: ActivityBucket) => {
                    const totalDay = bucket.received + bucket.quoted + bucket.clarified;
                    return (
                      <div key={bucket.date} className="flex items-center gap-3 text-xs">
                        <span className="w-20 font-mono text-muted-foreground text-[11px] shrink-0">
                          {bucket.date.slice(5)}
                        </span>
                        <div className="flex-1 flex items-center h-5 bg-muted/30 rounded overflow-hidden">
                          {bucket.received > 0 && (
                            <div
                              className="h-full bg-info text-white text-[10px] flex items-center justify-center font-bold px-1 transition-all"
                              style={{ width: `${(bucket.received / maxDailyCount) * 100}%` }}
                              title={`Received: ${bucket.received}`}
                            >
                              {bucket.received}
                            </div>
                          )}
                          {bucket.quoted > 0 && (
                            <div
                              className="h-full bg-primary text-white text-[10px] flex items-center justify-center font-bold px-1 transition-all"
                              style={{ width: `${(bucket.quoted / maxDailyCount) * 100}%` }}
                              title={`Quoted: ${bucket.quoted}`}
                            >
                              {bucket.quoted}
                            </div>
                          )}
                          {bucket.clarified > 0 && (
                            <div
                              className="h-full bg-warning text-white text-[10px] flex items-center justify-center font-bold px-1 transition-all"
                              style={{ width: `${(bucket.clarified / maxDailyCount) * 100}%` }}
                              title={`Clarified: ${bucket.clarified}`}
                            >
                              {bucket.clarified}
                            </div>
                          )}
                          {totalDay === 0 && (
                            <div className="w-full text-center text-[10px] text-muted-foreground/60 italic">
                              0 events
                            </div>
                          )}
                        </div>
                        <span className="w-12 text-right font-mono text-[11px] text-muted-foreground">
                          {totalDay}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Status Distribution */}
            <Card className="border-border bg-surface shadow-xs">
              <CardHeader className="pb-3 border-b border-border/40">
                <CardTitle className="text-sm font-semibold">Thread Status Distribution</CardTitle>
                <CardDescription className="text-xs">
                  Active thread breakdown across lifecycle states.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-2.5">
                {statusEntries.map(([status, count]) => {
                  const pct = totalStatusThreads > 0 ? ((count / totalStatusThreads) * 100).toFixed(0) : "0";
                  return (
                    <div key={status} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-foreground capitalize font-medium">
                          {status.replace("_", " ")}
                        </span>
                        <span className="font-mono text-muted-foreground text-[11px]">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            status === "completed"
                              ? "bg-success"
                              : status === "pricing" || status === "sending"
                              ? "bg-primary"
                              : status === "awaiting_reply"
                              ? "bg-warning"
                              : status === "failed"
                              ? "bg-danger"
                              : "bg-info"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

    </div>
  );
}
