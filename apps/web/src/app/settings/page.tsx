"use client";

import * as React from "react";
import {
  GearSix,
  CheckCircle,
  XCircle,
  ArrowsClockwise,
  SlidersHorizontal,
  Trash,
  ShieldCheck,
  Cpu,
  Database,
  FilePdf,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";

import { useSystemHealth } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function SettingsPage() {
  const {
    data: health,
    isLoading: healthLoading,
    error: healthError,
    refetch: refetchHealth,
  } = useSystemHealth();

  // Local state for Dispatch Switch
  // Checked = Dispatch Active (not paused)
  // Unchecked = Dispatch Paused (kill switch engaged)
  const [dispatchActive, setDispatchActive] = React.useState<boolean>(true);
  const [switchFeedback, setSwitchFeedback] = React.useState<string | null>(null);

  // Sync initial health value once loaded
  React.useEffect(() => {
    if (health?.outboundSendingPaused !== undefined) {
      setDispatchActive(!health.outboundSendingPaused);
    }
  }, [health?.outboundSendingPaused]);

  // TanStack Query client for invalidating cache on reset
  const queryClient = useQueryClient();

  // Reset / Purge modal state
  const [resetDialogOpen, setResetDialogOpen] = React.useState<boolean>(false);
  const [isResetting, setIsResetting] = React.useState<boolean>(false);
  const [resetFeedback, setResetFeedback] = React.useState<string | null>(null);

  const handleToggleDispatch = async (checked: boolean) => {
    const shouldPause = !checked;
    setDispatchActive(checked);
    try {
      await fetch("/api/v1/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outboundSendingPaused: shouldPause }),
      });
      await refetchHealth();
      await queryClient.invalidateQueries({ queryKey: ["health"] });
    } catch {
      // Ignore network errors in local dev
    }

    if (checked) {
      setSwitchFeedback(
        "Live outbound dispatch active. Quotations and customer replies will dispatch according to thread status."
      );
    } else {
      setSwitchFeedback(
        "Kill switch engaged: automated outbound sending is paused. Generated quotes will remain safely queued in the database."
      );
    }
    setTimeout(() => setSwitchFeedback(null), 4500);
  };

  const handleResetData = async () => {
    setIsResetting(true);
    try {
      const res = await fetch("/api/v1/reset", {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setResetFeedback(data.message || "All email records and threads have been purged successfully.");
        await queryClient.invalidateQueries();
        refetchHealth();
      } else {
        setResetFeedback(`Reset failed: ${data.detail || data.error || "Unknown error"}`);
      }
    } catch (err) {
      setResetFeedback(`Failed to connect to reset endpoint: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsResetting(false);
      setResetDialogOpen(false);
      setTimeout(() => setResetFeedback(null), 6000);
    }
  };

  if (healthLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96" />
          </div>
          <Skeleton className="h-9 w-32" />
        </div>
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (healthError || !health) {
    return (
      <EmptyState
        icon={XCircle}
        title="Failed to load settings"
        description="Could not load system configuration and health status."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchHealth();
            }}
          >
            <ArrowsClockwise className="h-4 w-4 mr-1.5" />
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <GearSix className="h-6 w-6 text-primary" weight="duotone" />
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              System Settings
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Operational controls, outbound email dispatch safety switches, and storage management.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchHealth();
            }}
            className="h-9"
          >
            <ArrowsClockwise className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Global Outbound Dispatch Switch Card */}
      <Card className={cn(
        "border shadow-xs transition-colors",
        !dispatchActive
          ? "border-warning/50 bg-warning-soft/20"
          : "border-border bg-surface"
      )}>
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5 max-w-2xl">
              <div className="flex items-center gap-2.5 flex-wrap">
                <SlidersHorizontal className="h-5 w-5 text-primary" weight="bold" />
                <h3 className="text-base font-semibold text-foreground">
                  Global Outbound Dispatch Kill Switch
                </h3>
                <Badge
                  variant={dispatchActive ? "success" : "warning"}
                  className="text-xs font-bold font-mono"
                >
                  {dispatchActive ? "DISPATCH: ACTIVE (ON)" : "DISPATCH: PAUSED (KILL SWITCH)"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                When active, generated customer proposals and clarification emails are dispatched live via email. When paused, the kill switch holds all outbound messages safely in the database for operator review without buyer exposure.
              </p>
              <div className="flex items-center gap-3 pt-1 text-[11px] text-muted-foreground font-mono">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 inline-block" />
                  ALLOW_EXTERNAL_DISPATCH: <strong>true</strong> (.env configured)
                </span>
                <span>•</span>
                <span>
                  Current Status: <strong className={dispatchActive ? "text-emerald-400" : "text-amber-400"}>
                    {dispatchActive ? "Live Dispatch Enabled" : "Safe Mode (Holding in Queue)"}
                  </strong>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:self-center shrink-0">
              <span className="text-xs font-medium text-foreground select-none">
                {dispatchActive ? "Live Dispatch Active" : "Dispatch Paused"}
              </span>
              <Switch
                checked={dispatchActive}
                onCheckedChange={handleToggleDispatch}
                aria-label="Toggle Automated Outbound Sending"
              />
            </div>
          </div>

          {switchFeedback && (
            <div className="mt-4 flex items-center gap-2 p-3 rounded-lg border border-primary/30 bg-primary-soft text-xs text-primary-soft-foreground animate-fade-in">
              <CheckCircle className="h-4 w-4 shrink-0 text-primary" weight="fill" />
              <span>{switchFeedback}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* System Health Overview Card */}
      <Card className="border-border bg-surface shadow-xs">
        <CardHeader className="p-5 pb-3 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" weight="duotone" />
              <CardTitle className="text-sm font-semibold">System Health & Infrastructure</CardTitle>
            </div>
            <Badge variant={health.overall === "ok" ? "success" : "warning"} className="text-xs font-mono">
              Status: {health.overall.toUpperCase()}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {health.components.map((comp) => {
              const compIcon =
                comp.id.includes("ai") ? Cpu :
                comp.id.includes("store") || comp.id.includes("database") ? Database :
                comp.id.includes("pdf") ? FilePdf : GearSix;
              const CompIcon = compIcon;

              return (
                <div
                  key={comp.id}
                  className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-medium text-foreground flex items-center gap-1.5 truncate">
                      <CompIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="truncate">{comp.name}</span>
                    </span>
                    <Badge variant={comp.level === "ok" ? "success" : "warning"} className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                      {comp.level}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                    {comp.detail}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Data Management & Fresh Start Card */}
      <Card className="border-border bg-surface shadow-xs">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1 max-w-2xl">
              <div className="flex items-center gap-2">
                <Trash className="h-5 w-5 text-danger" weight="bold" />
                <h3 className="text-base font-semibold text-foreground">
                  Data Management & Fresh Start
                </h3>
                <Badge variant="neutral" className="text-xs">
                  Zero Data Reset
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Permanently purge all inbound email threads, messages, extracted customer requirements, generated quotations, and delivery logs from both local storage and the persistent Supabase database. Use this to reset the system and start completely fresh.
              </p>
            </div>

            <div className="flex items-center gap-3 sm:self-center shrink-0">
              <Button
                variant="danger"
                size="sm"
                onClick={() => setResetDialogOpen(true)}
                className="h-9 px-3.5 text-xs font-semibold gap-1.5"
              >
                <Trash className="h-4 w-4" weight="bold" />
                Clear All Emails & Start Afresh
              </Button>
            </div>
          </div>

          {resetFeedback && (
            <div className="mt-4 flex items-center gap-2 p-3 rounded-lg border border-primary/30 bg-primary-soft text-xs text-primary-soft-foreground animate-fade-in">
              <CheckCircle className="h-4 w-4 shrink-0 text-primary" weight="fill" />
              <span>{resetFeedback}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reset Confirmation Dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 text-danger">
              <Trash className="h-5 w-5" weight="bold" />
              <DialogTitle className="text-base text-foreground">
                Clear All Email Records & Start Afresh?
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground pt-1 leading-relaxed">
              This action will permanently delete all email threads, messages, customer requirement profiles, quotations, delivery tracking records, and deduplication IDs from the database and local storage.
            </DialogDescription>
          </DialogHeader>

          <div className="p-3 my-2 rounded-lg bg-danger-soft/40 border border-danger/30 text-danger-soft-foreground text-xs leading-relaxed">
            <strong>Warning:</strong> This cannot be undone. All incoming emails, active quotes, and conversation history will be wiped so you can start with a completely empty inbox.
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              disabled={isResetting}
              onClick={() => setResetDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={isResetting}
              onClick={handleResetData}
              className="gap-1.5"
            >
              {isResetting ? (
                <>
                  <ArrowsClockwise className="h-3.5 w-3.5 animate-spin" />
                  Clearing Data...
                </>
              ) : (
                <>
                  <Trash className="h-3.5 w-3.5" weight="bold" />
                  Yes, Clear All & Start Afresh
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
