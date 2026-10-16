"use client";

import * as React from "react";
import Link from "next/link";
import {
  Heartbeat,
  XCircle,
  ArrowsClockwise,
  Clock,
  Queue,
  Lightning,
  Tray,
} from "@phosphor-icons/react";

import { useSystemHealth } from "@/hooks/use-api";
import { formatDateTime, cn } from "@/lib/utils";
import type { HealthLevel } from "@/types/domain";

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
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/data-table";

function getHealthLevelBadge(level: HealthLevel): {
  label: string;
  variant: "default" | "primary" | "success" | "warning" | "danger" | "info" | "neutral";
} {
  switch (level) {
    case "ok":
      return { label: "Healthy", variant: "success" };
    case "degraded":
      return { label: "Degraded", variant: "warning" };
    case "down":
      return { label: "Down", variant: "danger" };
    default:
      return { label: "Unknown", variant: "neutral" };
  }
}

export default function HealthPage() {
  const {
    data: health,
    isLoading,
    error,
    refetch,
  } = useSystemHealth();

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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !health) {
    return (
      <EmptyState
        icon={XCircle}
        title="Failed to load system health"
        description="Could not query system readiness checks and measured metrics."
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <ArrowsClockwise className="h-4 w-4 mr-1.5" />
            Retry
          </Button>
        }
      />
    );
  }

  const overallBadge = getHealthLevelBadge(health.overall);
  const sendingStatusLabel = health.sendingEnabled ? "Sending: ON" : "Sending: OFF";

  const threadStateCounts = health.countsByThreadState ?? {};
  const threadStateEntries = Object.entries(threadStateCounts);
  const totalThreads = threadStateEntries.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Heartbeat className="h-6 w-6 text-primary" weight="duotone" />
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              System Health &amp; Measured Telemetry
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Measured runtime metrics: queue depths, stuck message monitors, thread states, and component latencies.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            className="h-9 gap-1.5"
          >
            <ArrowsClockwise className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Status & Sending Flag Banner */}
      <Card className="border-border bg-surface shadow-xs overflow-hidden">
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge variant={overallBadge.variant} className="px-2.5 py-1 text-xs font-semibold">
                Overall: {overallBadge.label}
              </Badge>
              <Badge
                variant={health.sendingEnabled ? "success" : "warning"}
                className="px-2.5 py-1 text-xs font-bold font-mono"
              >
                {sendingStatusLabel}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Checked: {formatDateTime(health.checkedAt)}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <Link href="/settings" className="text-primary hover:underline font-medium">
                Change in Settings →
              </Link>
            </div>
          </div>
        </div>
      </Card>

      {/* Measured Telemetry Cards (Phase 10 specification) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Queue Depth */}
        <Card className="border-border bg-surface shadow-xs">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">Queue Depth</span>
              <Queue className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold font-mono text-foreground">
              {health.queueDepth ?? 0}
            </div>
            <span className="text-[11px] text-muted-foreground block">
              Queued or in-flight dispatches
            </span>
          </CardContent>
        </Card>

        {/* 2. Messages Stuck Over 10 Minutes */}
        <Card className="border-border bg-surface shadow-xs">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">Stuck Messages (&gt;10m)</span>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
            <div
              className={cn(
                "text-2xl font-bold font-mono",
                (health.stuckMessagesOver10m ?? 0) > 0 ? "text-danger" : "text-success"
              )}
            >
              {health.stuckMessagesOver10m ?? 0}
            </div>
            <span className="text-[11px] text-muted-foreground block">
              {(health.stuckMessagesOver10m ?? 0) > 0 ? "Requires operator reconciliation" : "Zero stuck messages"}
            </span>
          </CardContent>
        </Card>

        {/* 3. Last Webhook Time */}
        <Card className="border-border bg-surface shadow-xs">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">Last Webhook Inbound</span>
              <Tray className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-sm font-semibold font-mono text-foreground truncate mt-1">
              {health.lastWebhookAt ? formatDateTime(health.lastWebhookAt) : "None observed"}
            </div>
            <span className="text-[11px] text-muted-foreground block">
              Recent MTA event receipt
            </span>
          </CardContent>
        </Card>

        {/* 4. Live Test-Call Latency */}
        <Card className="border-border bg-surface shadow-xs">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">Live AI Call Latency</span>
              <Lightning className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold font-mono text-foreground">
              {health.liveLatencyMs !== null && health.liveLatencyMs !== undefined
                ? `${health.liveLatencyMs} ms`
                : "None measured"}
            </div>
            <span className="text-[11px] text-muted-foreground block">
              Observed provider response time
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Counts by Thread State (Phase 10 specification) */}
      <Card className="border-border bg-surface shadow-xs">
        <CardHeader className="p-5 pb-3 border-b border-border/40">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-foreground">
              Counts by Thread State
            </CardTitle>
            <Badge variant="neutral" className="text-xs font-mono">
              {totalThreads} total threads
            </Badge>
          </div>
          <CardDescription className="text-xs">
            Measured distribution of customer threads across active lifecycle states.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          {threadStateEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              No threads recorded in store yet.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {threadStateEntries.map(([state, count]) => (
                <div
                  key={state}
                  className="rounded-lg border border-border/60 bg-surface-sunken/40 p-3 text-center space-y-1"
                >
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block">
                    {state.replace("_", " ")}
                  </span>
                  <div className="text-xl font-bold font-mono text-foreground">
                    {count}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI vs Rules Fallback Decision Counts (Phase 11 specification) */}
      {health.aiDecisionCounts && (
        <Card className="border-border bg-surface shadow-xs">
          <CardHeader className="p-5 pb-3 border-b border-border/40">
            <CardTitle className="text-sm font-semibold text-foreground">
              AI vs Rules Engine Decisions (Last 24h)
            </CardTitle>
            <CardDescription className="text-xs">
              How many thread decisions were made by the AI sales engineer versus the deterministic rules fallback, with the last error category.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-lg border border-border/60 bg-surface-sunken/40 p-4 text-center space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block">
                  AI Decisions
                </span>
                <div className="text-2xl font-bold font-mono text-success">
                  {health.aiDecisionCounts.aiCount}
                </div>
                <span className="text-[11px] text-muted-foreground block">
                  Gemini or Groq provider
                </span>
              </div>

              <div className="rounded-lg border border-border/60 bg-surface-sunken/40 p-4 text-center space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block">
                  Rules Fallback
                </span>
                <div
                  className={cn(
                    "text-2xl font-bold font-mono",
                    health.aiDecisionCounts.rulesFallbackCount > 0 ? "text-warning" : "text-success"
                  )}
                >
                  {health.aiDecisionCounts.rulesFallbackCount}
                </div>
                <span className="text-[11px] text-muted-foreground block">
                  Deterministic engine took over
                </span>
              </div>

              <div className="rounded-lg border border-border/60 bg-surface-sunken/40 p-4 text-center space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block">
                  Last Error
                </span>
                <div className="text-sm font-semibold font-mono text-foreground truncate mt-1">
                  {health.aiDecisionCounts.lastError ?? "None"}
                </div>
                <span className="text-[11px] text-muted-foreground block">
                  Most recent failure category
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Component Readiness Table */}
      <Card className="border-border bg-surface shadow-xs">
        <CardHeader className="p-5 pb-3 border-b border-border/40">
          <CardTitle className="text-sm font-semibold text-foreground">
            Pipeline Components Status
          </CardTitle>
          <CardDescription className="text-xs">
            Deterministic status of internal engines, webhooks, and persistence providers.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-surface-sunken/60 text-xs">
                <TableHead>Component</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead>Diagnostic Detail</TableHead>
                <TableHead numeric className="w-[120px]">Latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.components.map((comp) => {
                const badge = getHealthLevelBadge(comp.level);
                return (
                  <TableRow key={comp.id} className="text-xs hover:bg-muted/20">
                    <TableCell className="font-medium text-foreground py-3">
                      {comp.name}
                    </TableCell>
                    <TableCell className="py-3">
                      <Badge variant={badge.variant} className="text-[10px]">
                        {badge.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground py-3">
                      {comp.detail}
                    </TableCell>
                    <TableCell numeric className="font-mono text-muted-foreground py-3">
                      {comp.latencyMs !== null ? `${comp.latencyMs} ms` : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
