"use client";

import * as React from "react";
import Link from "next/link";
import {
  PaperPlaneTilt,
  CheckCircle,
  XCircle,
  ClockCountdown,
  WarningCircle,
  ArrowsClockwise,
  MagnifyingGlass,
  ArrowSquareOut,
  EnvelopeSimple,
  Receipt,
  Funnel,
  Info,
  Clock,
  Warning,
  Eye,
} from "@phosphor-icons/react";

import { useDeliveries } from "@/hooks/use-api";
import { formatDateTime, formatRelativeTime, formatShortRef, cn } from "@/lib/utils";
import type { DeliveryRecord, DeliveryStatus, DeliveryEvent } from "@/types/domain";

import {
  Card,
  CardContent,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type FilterStatus = "all" | "delivered" | "bounced" | "queued" | "failed";

const STATUS_FILTERS: { label: string; value: FilterStatus }[] = [
  { label: "All", value: "all" },
  { label: "Delivered", value: "delivered" },
  { label: "Bounced", value: "bounced" },
  { label: "Queued", value: "queued" },
  { label: "Failed", value: "failed" },
];

function getDeliveryStatusBadge(status: DeliveryStatus): {
  label: string;
  variant: "default" | "primary" | "success" | "warning" | "danger" | "info" | "neutral";
  icon: React.ElementType;
} {
  switch (status) {
    case "delivered":
      return { label: "Delivered", variant: "success", icon: CheckCircle };
    case "accepted":
      return { label: "Accepted", variant: "info", icon: Clock };
    case "queued":
      return { label: "Queued", variant: "warning", icon: ClockCountdown };
    case "bounced":
      return { label: "Bounced", variant: "danger", icon: XCircle };
    case "failed":
      return { label: "Failed", variant: "danger", icon: XCircle };
    case "complained":
      return { label: "Complaint", variant: "danger", icon: WarningCircle };
    case "suppressed":
      return { label: "Suppressed", variant: "neutral", icon: Warning };
    default:
      return { label: status, variant: "default", icon: Info };
  }
}

export default function DeliveriesPage() {
  const { data: deliveries, isLoading, error, refetch } = useDeliveries();

  const [statusFilter, setStatusFilter] = React.useState<FilterStatus>("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedDelivery, setSelectedDelivery] = React.useState<DeliveryRecord | null>(null);
  const [retryingId, setRetryingId] = React.useState<string | null>(null);
  const [retryFeedback, setRetryFeedback] = React.useState<string | null>(null);

  // Summary counts
  const summary = React.useMemo(() => {
    if (!deliveries) {
      return { total: 0, delivered: 0, queued: 0, failed: 0 };
    }
    return {
      total: deliveries.length,
      delivered: deliveries.filter((d) => d.status === "delivered").length,
      queued: deliveries.filter((d) => d.status === "queued" || d.status === "accepted").length,
      failed: deliveries.filter((d) => d.status === "bounced" || d.status === "failed" || d.status === "complained").length,
    };
  }, [deliveries]);

  // Filtered deliveries
  const filteredDeliveries = React.useMemo(() => {
    if (!deliveries) return [];
    return deliveries.filter((d) => {
      // Status filter
      if (statusFilter !== "all") {
        if (statusFilter === "queued" && d.status !== "queued" && d.status !== "accepted") {
          return false;
        }
        if (statusFilter === "failed" && d.status !== "failed" && d.status !== "bounced" && d.status !== "complained") {
          return false;
        }
        if (statusFilter === "delivered" && d.status !== "delivered") {
          return false;
        }
        if (statusFilter === "bounced" && d.status !== "bounced") {
          return false;
        }
      }

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchRecipient = d.recipient.toLowerCase().includes(q);
        const matchSubject = d.subject.toLowerCase().includes(q);
        const matchProviderId = (d.providerMessageId ?? "").toLowerCase().includes(q);
        const matchThread = d.threadId.toLowerCase().includes(q);
        if (!matchRecipient && !matchSubject && !matchProviderId && !matchThread) {
          return false;
        }
      }

      return true;
    });
  }, [deliveries, statusFilter, searchQuery]);

  const handleRetryNow = (e: React.MouseEvent, delivery: DeliveryRecord) => {
    e.stopPropagation();
    setRetryingId(delivery.id);
    setTimeout(() => {
      setRetryingId(null);
      setRetryFeedback(`Retry triggered for ${delivery.recipient}. Outbound dispatch queue updated.`);
      setTimeout(() => setRetryFeedback(null), 4000);
    }, 800);
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={XCircle}
        title="Failed to load deliveries"
        description="Could not retrieve email delivery logs and provider events."
        action={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
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
            <PaperPlaneTilt className="h-6 w-6 text-primary" weight="duotone" />
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Email Deliveries & Provider Logs
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Outbound quotation transmissions, provider webhook events, retry queues, and dead-letter monitoring.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="h-9"
          >
            <ArrowsClockwise className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary KPI Badges */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-border bg-surface shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block font-medium">Total Outbound Sent</span>
              <span className="text-2xl font-bold text-foreground mt-0.5 block">
                {summary.total}
              </span>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <EnvelopeSimple className="h-5 w-5" weight="bold" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-surface shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block font-medium">Successfully Delivered</span>
              <span className="text-2xl font-bold text-success mt-0.5 block">
                {summary.delivered}
              </span>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-soft text-success">
              <CheckCircle className="h-5 w-5" weight="bold" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-surface shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block font-medium">In-flight / Queued</span>
              <span className="text-2xl font-bold text-warning mt-0.5 block">
                {summary.queued}
              </span>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-soft text-warning">
              <ClockCountdown className="h-5 w-5" weight="bold" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-surface shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block font-medium">Bounced / Failed</span>
              <span className="text-2xl font-bold text-danger mt-0.5 block">
                {summary.failed}
              </span>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-danger-soft text-danger">
              <XCircle className="h-5 w-5" weight="bold" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Feedback Toast Banner */}
      {retryFeedback && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-primary/30 bg-primary-soft text-xs text-primary-soft-foreground animate-fade-in">
          <CheckCircle className="h-4 w-4 shrink-0 text-primary" weight="fill" />
          <span>{retryFeedback}</span>
        </div>
      )}

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Status Filter Buttons */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {STATUS_FILTERS.map((filter) => {
            const isActive = statusFilter === filter.value;
            return (
              <Button
                key={filter.value}
                variant={isActive ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter(filter.value)}
                className={cn(
                  "h-8 px-3 text-xs whitespace-nowrap rounded-md font-medium",
                  isActive
                    ? "bg-surface text-foreground shadow-xs border border-border"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {filter.label}
              </Button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative flex-1 max-w-sm">
          <MagnifyingGlass className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by recipient, subject, thread..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>
      </div>

      {/* Deliveries Table */}
      <Card className="border-border bg-surface shadow-xs overflow-hidden">
        {filteredDeliveries.length === 0 ? (
          <EmptyState
            icon={Funnel}
            title="No matching deliveries"
            description="No outbound delivery records match the selected status filter and search query."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStatusFilter("all");
                  setSearchQuery("");
                }}
              >
                Clear Filters
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Recipient & Subject</TableHead>
                <TableHead>Links</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Last Error / Diagnostic</TableHead>
                <TableHead>Next Retry</TableHead>
                <TableHead numeric>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDeliveries.map((delivery) => {
                const s = getDeliveryStatusBadge(delivery.status);
                const Icon = s.icon;
                return (
                  <TableRow
                    key={delivery.id}
                    onClick={() => setSelectedDelivery(delivery)}
                    className="cursor-pointer hover:bg-muted/40 transition-colors"
                  >
                    {/* Status */}
                    <TableCell>
                      <Badge variant={s.variant} className="gap-1 text-[11px] font-medium py-0.5">
                        <Icon className="h-3 w-3" weight="bold" />
                        <span>{s.label}</span>
                      </Badge>
                    </TableCell>

                    {/* Recipient & Subject */}
                    <TableCell className="max-w-xs sm:max-w-md">
                      <div className="font-medium text-foreground truncate" title={delivery.recipient}>
                        {delivery.recipient}
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5" title={delivery.subject}>
                        {delivery.subject}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono mt-0.5">
                        {delivery.threadId.startsWith("th_") ? (
                          <Badge variant="primary" className="text-[9px] py-0 px-1 font-mono">Live</Badge>
                        ) : (
                          <Badge variant="neutral" className="text-[9px] py-0 px-1 font-mono">Seed</Badge>
                        )}
                        <span>{delivery.provider} • ID: {delivery.providerMessageId ?? "pending"}</span>
                      </div>
                    </TableCell>

                    {/* Thread / Quote Links */}
                    <TableCell>
                      <div className="flex flex-col gap-1 text-xs" onClick={(e) => e.stopPropagation()}>
                        <Link
                          href={`/?thread=${delivery.threadId}`}
                          className="inline-flex items-center gap-1 text-primary hover:underline font-mono text-[11px]"
                          title="View Email Thread"
                        >
                          <EnvelopeSimple className="h-3 w-3" />
                          <span>{delivery.threadId}</span>
                        </Link>
                        {delivery.quoteId ? (
                          <Link
                            href={`/quotes/${delivery.quoteId}`}
                            className="inline-flex items-center gap-1 text-primary hover:underline font-mono text-[11px]"
                            title="View Quote Document"
                          >
                            <Receipt className="h-3 w-3" />
                            <span>#{formatShortRef(delivery.quoteId)}</span>
                          </Link>
                        ) : (
                          <span className="text-[11px] text-muted-foreground italic">No quote attached</span>
                        )}
                      </div>
                    </TableCell>

                    {/* Attempts */}
                    <TableCell>
                      <div className="text-xs font-mono">
                        <span className={cn(
                          "font-semibold",
                          delivery.attemptCount >= delivery.maxAttempts && delivery.status !== "delivered"
                            ? "text-danger"
                            : "text-foreground"
                        )}>
                          {delivery.attemptCount}
                        </span>
                        <span className="text-muted-foreground"> / {delivery.maxAttempts}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground block">
                        {formatRelativeTime(delivery.updatedAt)}
                      </span>
                    </TableCell>

                    {/* Last Error */}
                    <TableCell className="max-w-[200px]">
                      {delivery.lastErrorCode ? (
                        <div className="space-y-0.5">
                          <Badge variant="danger" className="font-mono text-[10px] py-0">
                            {delivery.lastErrorCode}
                          </Badge>
                          <div
                            className="text-[11px] text-danger-soft-foreground truncate"
                            title={delivery.lastErrorMessage ?? undefined}
                          >
                            {delivery.lastErrorMessage ?? "Transmission error"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    {/* Next Retry */}
                    <TableCell>
                      {delivery.nextRetryAt ? (
                        <div className="text-xs font-mono text-warning">
                          {formatDateTime(delivery.nextRetryAt)}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">None</span>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell numeric onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {delivery.retryEligible ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={retryingId === delivery.id}
                            onClick={(e) => handleRetryNow(e, delivery)}
                            className="h-7 text-xs px-2 text-primary hover:text-primary-hover"
                          >
                            {retryingId === delivery.id ? (
                              <ArrowsClockwise className="h-3.5 w-3.5 animate-spin mr-1" />
                            ) : (
                              <ArrowsClockwise className="h-3.5 w-3.5 mr-1" />
                            )}
                            Retry Now
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled
                            className="h-7 text-xs px-2 opacity-40 cursor-not-allowed"
                            title="Not eligible for automatic retry"
                          >
                            No Retry
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedDelivery(delivery)}
                          className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                          title="View Delivery Timeline"
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          Events
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Delivery Detail Modal */}
      <Dialog
        open={!!selectedDelivery}
        onOpenChange={(open) => !open && setSelectedDelivery(null)}
      >
        {selectedDelivery && (
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between pr-6">
                <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                  <PaperPlaneTilt className="h-5 w-5 text-primary" weight="duotone" />
                  Delivery Events & Audit Trace
                </DialogTitle>
                {(() => {
                  const s = getDeliveryStatusBadge(selectedDelivery.status);
                  return (
                    <Badge variant={s.variant} className="text-xs">
                      {s.label}
                    </Badge>
                  );
                })()}
              </div>
              <DialogDescription className="text-xs">
                Comprehensive provider dispatch events, recipient mailbox responses, and diagnostic records.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              {/* Delivery Meta Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-muted/40 border border-border/40">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Recipient Address:</span>
                  <span className="font-semibold text-foreground break-all">
                    {selectedDelivery.recipient}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Subject:</span>
                  <span className="text-foreground font-medium">{selectedDelivery.subject}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Provider Message ID:</span>
                  <span className="font-mono text-foreground font-medium">
                    {selectedDelivery.providerMessageId ?? "Pending generation"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Provider & Attempts:</span>
                  <span className="text-foreground capitalize font-medium">
                    {selectedDelivery.provider} • Attempt {selectedDelivery.attemptCount} of {selectedDelivery.maxAttempts}
                  </span>
                </div>
              </div>

              {/* Error Diagnostic (if error exists) */}
              {selectedDelivery.lastErrorMessage && (
                <div className="p-3.5 rounded-lg border border-danger/30 bg-danger-soft/50 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-danger">
                    <XCircle className="h-4 w-4 shrink-0" weight="fill" />
                    <span>Last Transmission Diagnostic</span>
                    {selectedDelivery.lastErrorCode && (
                      <Badge variant="danger" className="font-mono text-[10px] ml-auto">
                        Code: {selectedDelivery.lastErrorCode}
                      </Badge>
                    )}
                  </div>
                  <p className="text-foreground leading-relaxed pl-6">
                    {selectedDelivery.lastErrorMessage}
                  </p>
                </div>
              )}

              {/* Chronological Event Timeline */}
              <div className="space-y-2 pt-2">
                <h4 className="font-semibold text-foreground uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  Chronological Event Timeline ({selectedDelivery.events.length} events)
                </h4>

                <div className="relative pl-6 space-y-4 border-l-2 border-border/60 ml-2 py-1">
                  {selectedDelivery.events.map((event: DeliveryEvent, idx: number) => {
                    const eventBadge =
                      event.status === "delivered"
                        ? "bg-success text-white"
                        : event.status === "bounced" || event.status === "failed"
                        ? "bg-danger text-white"
                        : event.status === "retry_scheduled"
                        ? "bg-warning text-white"
                        : "bg-primary text-white";

                    return (
                      <div key={idx} className="relative group">
                        {/* Dot on line */}
                        <span
                          className={cn(
                            "absolute -left-[31px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ring-4 ring-surface",
                            eventBadge
                          )}
                        >
                          {idx + 1}
                        </span>

                        <div className="bg-surface border border-border/60 rounded-md p-3 shadow-2xs space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-foreground uppercase tracking-wider text-[10px]">
                              {event.status.replace("_", " ")}
                            </span>
                            <span className="text-[11px] text-muted-foreground font-mono">
                              {formatDateTime(event.at)}
                            </span>
                          </div>
                          <p className="text-foreground text-xs leading-relaxed">
                            {event.detail}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Related Links */}
              <div className="flex items-center justify-between pt-3 border-t border-border/40 text-xs">
                <div className="flex items-center gap-3">
                  <Link
                    href={`/?thread=${selectedDelivery.threadId}`}
                    className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                  >
                    <span>Inspect Thread</span>
                    <ArrowSquareOut className="h-3.5 w-3.5" />
                  </Link>
                  {selectedDelivery.quoteId && (
                    <Link
                      href={`/quotes/${selectedDelivery.quoteId}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                    >
                      <span>Inspect Quote (#{formatShortRef(selectedDelivery.quoteId)})</span>
                      <ArrowSquareOut className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>

                {selectedDelivery.retryEligible && (
                  <Button
                    variant="default"
                    size="sm"
                    disabled={retryingId === selectedDelivery.id}
                    onClick={(e) => handleRetryNow(e, selectedDelivery)}
                    className="h-8 text-xs"
                  >
                    <ArrowsClockwise className="h-3.5 w-3.5 mr-1" />
                    Trigger Immediate Retry
                  </Button>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedDelivery(null)}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
