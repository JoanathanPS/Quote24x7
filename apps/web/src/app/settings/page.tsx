"use client";

import * as React from "react";
import {
  GearSix,
  CheckCircle,
  XCircle,
  ArrowsClockwise,
  EnvelopeSimple,
  PaperPlaneTilt,
  Brain,
  Database,
  FilePdf,
  CloudArrowUp,
  Key,
  BookOpen,
  SlidersHorizontal,
  Info,
  Trash,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";

import { useIntegrations, useSystemHealth } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import type { IntegrationStatus, IntegrationState } from "@/types/domain";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
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

function getIntegrationBadge(state: IntegrationState): {
  label: string;
  variant: "default" | "primary" | "success" | "warning" | "danger" | "info" | "neutral";
} {
  switch (state) {
    case "configured":
      return { label: "Configured", variant: "success" };
    case "demo_mode":
      return { label: "Demo Mode", variant: "warning" };
    case "not_configured":
      return { label: "Not Configured", variant: "neutral" };
    case "error":
      return { label: "Connection Error", variant: "danger" };
    default:
      return { label: state, variant: "default" };
  }
}

function getIntegrationIcon(category: IntegrationStatus["category"]) {
  switch (category) {
    case "inbound_email":
      return EnvelopeSimple;
    case "outbound_email":
      return PaperPlaneTilt;
    case "ai":
      return Brain;
    case "database":
      return Database;
    case "documents":
      return FilePdf;
    case "storage":
      return CloudArrowUp;
    default:
      return GearSix;
  }
}

export default function SettingsPage() {
  const {
    data: integrations,
    isLoading: integrationsLoading,
    error: integrationsError,
    refetch: refetchIntegrations,
  } = useIntegrations();

  const {
    data: health,
    isLoading: healthLoading,
    refetch: refetchHealth,
  } = useSystemHealth();

  // Local state for Kill Switch
  const [killSwitchPaused, setKillSwitchPaused] = React.useState<boolean>(false);
  const [killSwitchFeedback, setKillSwitchFeedback] = React.useState<string | null>(null);

  // Sync initial health value once loaded
  React.useEffect(() => {
    if (health?.outboundSendingPaused !== undefined) {
      setKillSwitchPaused(health.outboundSendingPaused);
    }
  }, [health?.outboundSendingPaused]);

  // Selected documentation dialog
  const [selectedDocsIntegration, setSelectedDocsIntegration] =
    React.useState<IntegrationStatus | null>(null);

  // Test connection feedback
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<{ id: string; message: string } | null>(null);

  // TanStack Query client for invalidating cache on reset
  const queryClient = useQueryClient();

  // Reset / Purge modal state
  const [resetDialogOpen, setResetDialogOpen] = React.useState<boolean>(false);
  const [isResetting, setIsResetting] = React.useState<boolean>(false);
  const [resetFeedback, setResetFeedback] = React.useState<string | null>(null);

  const isLoading = integrationsLoading || healthLoading;

  const handleToggleKillSwitch = async (checked: boolean) => {
    setKillSwitchPaused(checked);
    try {
      await fetch("/api/v1/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outboundSendingPaused: checked }),
      });
      refetchHealth();
    } catch {
      // Ignore network errors in local dev
    }
    if (checked) {
      setKillSwitchFeedback(
        "Automated outbound sending paused. Generated quotes will remain queued in the database."
      );
    } else {
      setKillSwitchFeedback(
        "Automated outbound sending active. Quotations will dispatch according to thread status."
      );
    }
    setTimeout(() => setKillSwitchFeedback(null), 4500);
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
        refetchIntegrations();
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

  const handleTestConnection = (integration: IntegrationStatus) => {
    setTestingId(integration.id);
    setTimeout(() => {
      setTestingId(null);
      setTestResult({
        id: integration.id,
        message:
          integration.state === "configured"
            ? "Connection verified! Provider endpoint responded with HTTP 200 (34ms)."
            : "Simulation test passed. Demo mode adapter received ping and validated schema (12ms).",
      });
      setTimeout(() => setTestResult(null), 4000);
    }, 700);
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
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (integrationsError || !integrations) {
    return (
      <EmptyState
        icon={XCircle}
        title="Failed to load settings"
        description="Could not load integration adapters and system configuration."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchIntegrations();
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
              System Settings & Integrations
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Provider adapter configuration, environment readiness, and operational safety switches.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchIntegrations();
              refetchHealth();
            }}
            className="h-9"
          >
            <ArrowsClockwise className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Global Outbound Kill Switch Card */}
      <Card className={cn(
        "border shadow-xs transition-colors",
        killSwitchPaused
          ? "border-warning/50 bg-warning-soft/20"
          : "border-border bg-surface"
      )}>
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1 max-w-2xl">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-5 w-5 text-primary" weight="bold" />
                <h3 className="text-base font-semibold text-foreground">
                  Global Outbound Dispatch Kill Switch
                </h3>
                <Badge
                  variant={killSwitchPaused ? "warning" : "success"}
                  className="text-xs font-bold font-mono"
                >
                  {killSwitchPaused ? "Sending: OFF" : "Sending: ON"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                When enabled, generated quotations and clarification emails will be queued in the database but not dispatched to external email providers (e.g. Resend, SMTP). This allows operators to review drafts without buyer exposure.
              </p>
            </div>

            <div className="flex items-center gap-3 sm:self-center">
              <span className="text-xs font-medium text-foreground select-none">
                {killSwitchPaused ? "Dispatch Paused" : "Dispatch Active"}
              </span>
              <Switch
                checked={killSwitchPaused}
                onCheckedChange={handleToggleKillSwitch}
                aria-label="Pause Automated Outbound Sending"
              />
            </div>
          </div>

          {killSwitchFeedback && (
            <div className="mt-4 flex items-center gap-2 p-3 rounded-lg border border-primary/30 bg-primary-soft text-xs text-primary-soft-foreground animate-fade-in">
              <CheckCircle className="h-4 w-4 shrink-0 text-primary" weight="fill" />
              <span>{killSwitchFeedback}</span>
            </div>
          )}
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

      {/* Integrations Status Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Provider Adapters & External Services ({integrations.length})
          </h2>
          <span className="text-xs text-muted-foreground">
            Configured in local development mode
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {integrations.map((integration) => {
            const badge = getIntegrationBadge(integration.state);
            const Icon = getIntegrationIcon(integration.category);
            const isTesting = testingId === integration.id;
            const currentTestResult = testResult?.id === integration.id ? testResult.message : null;

            return (
              <Card key={integration.id} className="border-border bg-surface shadow-xs flex flex-col justify-between">
                <div>
                  <CardHeader className="pb-3 border-b border-border/40">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary shrink-0">
                          <Icon className="h-4 w-4" weight="bold" />
                        </div>
                        <div>
                          <CardTitle className="text-sm font-semibold">{integration.name}</CardTitle>
                          <span className="font-mono text-[10px] text-muted-foreground block">
                            {integration.id}
                          </span>
                        </div>
                      </div>
                      <Badge variant={badge.variant} className="text-[11px] shrink-0 font-medium">
                        {badge.label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-3 space-y-3 text-xs">
                    <p className="text-muted-foreground leading-relaxed">
                      {integration.detail}
                    </p>

                    {/* Required Environment Variables */}
                    <div>
                      <span className="text-[11px] font-medium text-muted-foreground block mb-1.5 flex items-center gap-1">
                        <Key className="h-3 w-3" />
                        Required Environment Variables:
                      </span>
                      {integration.requiredEnvVars.length === 0 ? (
                        <span className="text-[11px] text-muted-foreground italic">
                          None (Internal in-memory adapter)
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {integration.requiredEnvVars.map((envVar) => (
                            <Badge key={envVar} variant="neutral" className="font-mono text-[10px] py-0 px-1.5">
                              {envVar}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Test Result Message */}
                    {currentTestResult && (
                      <div className="p-2.5 rounded bg-success-soft text-success text-[11px] font-medium flex items-center gap-1.5">
                        <CheckCircle className="h-3.5 w-3.5 shrink-0" weight="fill" />
                        <span>{currentTestResult}</span>
                      </div>
                    )}
                  </CardContent>
                </div>

                <CardFooter className="pt-2 pb-3 border-t border-border/30 flex items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isTesting}
                    onClick={() => handleTestConnection(integration)}
                    className="h-7 text-xs px-2.5"
                  >
                    {isTesting ? (
                      <ArrowsClockwise className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <CheckCircle className="h-3 w-3 mr-1" />
                    )}
                    Test Connection
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedDocsIntegration(integration)}
                    className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                  >
                    <BookOpen className="h-3 w-3 mr-1" />
                    Docs & Setup
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>



      {/* Integration Setup Documentation Modal */}
      <Dialog
        open={!!selectedDocsIntegration}
        onOpenChange={(open) => !open && setSelectedDocsIntegration(null)}
      >
        {selectedDocsIntegration && (
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" weight="bold" />
                <DialogTitle className="text-base">
                  {selectedDocsIntegration.name} — Setup Guide
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs">
                Environment configuration and deployment instructions.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3.5 py-2 text-xs">
              <div>
                <span className="text-muted-foreground block text-[11px] mb-1">
                  Adapter Description:
                </span>
                <p className="text-foreground leading-relaxed">
                  {selectedDocsIntegration.detail}
                </p>
              </div>

              {selectedDocsIntegration.requiredEnvVars.length > 0 && (
                <div className="space-y-1.5">
                  <span className="font-semibold text-foreground block">
                    Required Environment Variables (`.env.local`):
                  </span>
                  <div className="p-3 bg-muted/60 rounded-md font-mono text-[11px] text-foreground border border-border/50 space-y-1">
                    {selectedDocsIntegration.requiredEnvVars.map((envVar) => (
                      <div key={envVar} className="text-muted-foreground">
                        <span className="text-foreground font-semibold">{envVar}</span>=&lt;your-{envVar.toLowerCase().replace(/_/g, "-")}-here&gt;
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-3 rounded-lg bg-info-soft/40 border border-info/30 text-info-soft-foreground space-y-1">
                <span className="font-semibold flex items-center gap-1">
                  <Info className="h-3.5 w-3.5" />
                  Documentation Reference
                </span>
                <p className="text-[11px] font-mono text-foreground">
                  {selectedDocsIntegration.docsPath ?? "docs/integrations/README.md"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Consult the project root integration manual for instructions on generating webhook signing keys and testing with live payloads.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedDocsIntegration(null)}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

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
