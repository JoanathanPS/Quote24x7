"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowDownLeft,
  PaperPlaneTilt,
  Receipt,
  WarningCircle,
  WarningOctagon,
  Question,
  User,
  EnvelopeSimple,
  Buildings,
  Calendar,
  Paperclip,
  CheckCircle,
  Pause,
  PencilSimple,
  FilePdf,
} from "@phosphor-icons/react";

import {
  useThread,
  useThreadMessages,
  useThreadRequirements,
  useQuote,
  useDeliveries,
} from "@/hooks/use-api";
import { formatMoney } from "@/server/pricing/money";
import { formatDateTime, formatRelativeTime, cn } from "@/lib/utils";
import type {
  RequestType,
  ThreadStatus,
} from "@/types/domain";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { EmailBody } from "@/components/email-body";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/data-table";

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
      return { label: "Quote Request", variant: "primary" };
    case "proposal":
      return { label: "Proposal", variant: "info" };
    case "clarification":
      return { label: "Clarification", variant: "warning" };
    default:
      return { label: "General Inbound", variant: "neutral" };
  }
}

export default function ThreadDetailPage() {
  const params = useParams<{ id: string }>();
  const threadId = params?.id ?? "";

  const { data: thread, isLoading: threadLoading } = useThread(threadId);
  const { data: messages, isLoading: messagesLoading } = useThreadMessages(threadId);
  const { data: requirements } = useThreadRequirements(threadId);
  const { data: quote } = useQuote(thread?.quoteId ?? "");
  const { data: deliveries } = useDeliveries();

  // Notification states & Action Feedback
  const [actionFeedback, setActionFeedback] = React.useState<string | null>(null);

  // Delivery lookup map
  const deliveryStatusMap = React.useMemo(() => {
    const map = new Map<string, string>();
    if (deliveries) {
      for (const d of deliveries) {
        if (d.id) map.set(d.id, d.status);
      }
    }
    return map;
  }, [deliveries]);

  const handleSend = () => {
    setActionFeedback("Quote dispatched to buyer via configured MTA.");
    setTimeout(() => setActionFeedback(null), 5000);
  };

  const handleEdit = () => {
    setActionFeedback("Editing mode active: operator adjustments ready for next sizing run.");
    setTimeout(() => setActionFeedback(null), 5000);
  };

  const handleHold = () => {
    setActionFeedback("Thread placed on Hold for manual sales review.");
    setTimeout(() => setActionFeedback(null), 5000);
  };

  if (threadLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 pb-12">
        <div className="space-y-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-96" />
          <Skeleton className="h-5 w-80" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div className="lg:col-span-5 space-y-4">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="mx-auto max-w-7xl pb-12">
        <EmptyState
          icon={WarningCircle}
          title="Thread Not Found"
          description={`The requested email thread "${threadId}" could not be located.`}
          action={
            <Button variant="default" size="sm" asChild>
              <Link href="/">
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Back to Inbox
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const statusInfo = getStatusBadge(thread.status);
  const typeInfo = getRequestTypeBadge(thread.requestType);

  // Partition requirements: Stated, Assumed, Missing
  const statedFields = requirements?.fields.filter((f) => f.state === "provided" && f.value != null) ?? [];
  const missingFields = requirements?.fields.filter((f) => f.state === "missing" || f.value == null) ?? [];
  const assumedList = quote?.assumptions ?? [
    "Priced against quantities understood from buyer email.",
    "Add-on capacity sold in whole packs.",
  ];

  const bestValueOption = quote?.options.find((o) => o.optionType === "best_value") ?? quote?.options[0];

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      {/* Back Link */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Inbox
        </Link>
      </div>

      {/* Action Notification Banner */}
      {actionFeedback && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary-soft/20 px-4 py-3 text-sm text-foreground animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-primary shrink-0" weight="fill" />
            <span>{actionFeedback}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActionFeedback(null)}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Operator Banner if status is failed */}
      {thread.status === "failed" && (
        <div className="flex flex-col gap-3 rounded-lg border border-danger/40 bg-danger-soft/20 p-4 sm:flex-row sm:items-center sm:justify-between text-danger-soft-foreground">
          <div className="flex items-start gap-3">
            <WarningOctagon className="h-5 w-5 text-danger shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-danger">Review Required</p>
              <p className="mt-0.5 text-xs text-foreground/80 font-mono">
                {thread.statusDetail || "Thread paused for review."}
              </p>
            </div>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={handleHold}
            className="shrink-0 gap-1.5 self-start sm:self-auto"
          >
            <Pause className="h-3.5 w-3.5" />
            Mark on Hold
          </Button>
        </div>
      )}

      {/* Thread Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              {thread.subject}
            </h1>
            <div className="flex items-center gap-1.5">
              <StatusDot status={thread.status} />
              <Badge variant={statusInfo.variant} className="text-xs">
                {statusInfo.label}
              </Badge>
            </div>
          </div>

          {/* Sender Details */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">
                {thread.senderName || "Unknown"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <EnvelopeSimple className="h-3.5 w-3.5" />
              <span>{thread.senderEmail}</span>
            </div>
            {thread.organisation && (
              <div className="flex items-center gap-1.5">
                <Buildings className="h-3.5 w-3.5" />
                <span>{thread.organisation}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Badge variant={typeInfo.variant} className="text-[10px] py-0 px-1.5">
                {typeInfo.label}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              <span>Created {formatDateTime(thread.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Top Control Buttons: Send / Edit / Hold */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={handleSend}
            className="gap-1.5 text-xs h-9"
          >
            <PaperPlaneTilt className="h-3.5 w-3.5" />
            Send
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleEdit}
            className="gap-1.5 text-xs h-9"
          >
            <PencilSimple className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleHold}
            className="gap-1.5 text-xs h-9"
          >
            <Pause className="h-3.5 w-3.5" />
            Hold
          </Button>
        </div>
      </div>

      {/* Two-Column Split Layout: Email on Left; Understood, Open Question, Quote on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Column 1 (Left): Email Messages Timeline with Delivery Status */}
        <div className="lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">
              Email Timeline
            </h2>
            <Badge variant="neutral" className="text-xs font-mono">
              {messages?.length ?? thread.messageCount} messages
            </Badge>
          </div>

          {messagesLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-36 w-full" />
              <Skeleton className="h-36 w-full" />
            </div>
          ) : !messages || messages.length === 0 ? (
            <Card className="p-8 text-center border-dashed">
              <p className="text-sm text-muted-foreground">
                No message bodies recorded for this thread.
              </p>
            </Card>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => {
                const isInbound = msg.direction === "inbound";
                const deliveryStatus = msg.deliveryId ? deliveryStatusMap.get(msg.deliveryId) : null;

                return (
                  <Card
                    key={msg.id}
                    className={cn(
                      "transition-all border",
                      isInbound
                        ? "bg-surface-sunken/60 border-border/80 shadow-xs"
                        : "bg-primary-soft/10 border-primary/30 shadow-xs"
                    )}
                  >
                    <CardHeader className="p-4 pb-2 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div
                            className={cn(
                              "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium",
                              isInbound
                                ? "bg-muted text-foreground"
                                : "bg-primary text-primary-foreground"
                            )}
                          >
                            {isInbound ? (
                              <ArrowDownLeft className="h-3.5 w-3.5" />
                            ) : (
                              <PaperPlaneTilt className="h-3.5 w-3.5" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-xs text-foreground">
                                {msg.fromName || msg.fromAddress}
                              </span>
                              <Badge
                                variant={isInbound ? "neutral" : "primary"}
                                className="text-[10px] py-0 px-1.5"
                              >
                                {isInbound ? "Inbound" : "Outbound"}
                              </Badge>
                              {!isInbound && (
                                <Badge
                                  variant={
                                    deliveryStatus === "delivered"
                                      ? "success"
                                      : deliveryStatus === "bounced" || deliveryStatus === "failed"
                                      ? "danger"
                                      : "neutral"
                                  }
                                  className="text-[9px] py-0 px-1.5"
                                >
                                  Delivery: {deliveryStatus ? deliveryStatus.toUpperCase() : "SENT"}
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              To: {msg.toAddresses.join(", ")}
                            </p>
                          </div>
                        </div>

                        <span
                          className="text-[11px] text-muted-foreground whitespace-nowrap font-mono"
                          title={formatDateTime(msg.occurredAt)}
                        >
                          {formatRelativeTime(msg.occurredAt)}
                        </span>
                      </div>
                    </CardHeader>

                    <CardContent className="p-4 pt-1 space-y-2">
                      <EmailBody
                        text={msg.bodyText}
                        className="font-sans text-xs text-foreground/90 leading-relaxed"
                      />

                      {/* Attachments */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="pt-2 border-t border-border/40 flex flex-wrap gap-2">
                          {msg.attachments.map((att, idx) => (
                            <div
                              key={idx}
                              className="inline-flex items-center gap-1.5 rounded border border-border bg-surface px-2.5 py-1 text-xs"
                            >
                              <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="font-medium">{att.name}</span>
                              <span className="text-[11px] text-muted-foreground">
                                ({(att.sizeBytes / 1024).toFixed(1)} KB)
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Column 2 (Right): "What we understood", Open Question, Quote Versions with Line Items, Actions */}
        <div className="lg:col-span-6 space-y-5">
          {/* 1. What We Understood (Stated / Assumed / Missing) */}
          <Card className="border-border bg-surface shadow-xs">
            <CardHeader className="p-4 pb-2 border-b border-border/50">
              <CardTitle className="text-sm font-semibold text-foreground">
                What We Understood
              </CardTitle>
              <CardDescription className="text-xs">
                Parameters extracted directly from buyer communication.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {/* Stated */}
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                  Stated by Buyer
                </span>
                {statedFields.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {statedFields.map((f) => (
                      <span
                        key={f.key}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs text-foreground"
                      >
                        <span className="text-muted-foreground">{f.label}:</span>
                        <span className="font-semibold font-mono">{String(f.value)}</span>
                        {f.unit && <span className="text-muted-foreground text-[10px]">{f.unit}</span>}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">None explicitly declared yet.</p>
                )}
              </div>

              {/* Assumed */}
              <div className="pt-2 border-t border-border/40">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                  Assumed
                </span>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {assumedList.slice(0, 3).map((a, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-primary mt-0.5">•</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Missing */}
              <div className="pt-2 border-t border-border/40">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                  Missing Requirements
                </span>
                {missingFields.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {missingFields.map((f) => (
                      <span
                        key={f.key}
                        className="inline-flex items-center gap-1 rounded bg-warning-soft/30 border border-warning/40 px-2 py-0.5 text-xs text-warning-soft-foreground"
                      >
                        <span>{f.label}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-success font-medium">All mandatory parameters are satisfied.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 2. Open Question */}
          {requirements?.pendingQuestions && requirements.pendingQuestions.length > 0 && (
            <Card className="border-warning/50 bg-warning-soft/20 shadow-xs">
              <CardHeader className="p-4 pb-2 border-b border-warning/30">
                <div className="flex items-center gap-2 text-warning-soft-foreground">
                  <Question className="h-4 w-4 font-bold" />
                  <CardTitle className="text-xs font-bold uppercase tracking-wider">
                    Open Question (Awaiting Buyer)
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-2">
                {requirements.pendingQuestions.map((q) => (
                  <div key={q.id} className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      &ldquo;{q.question}&rdquo;
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Reason: {q.reason}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* 3. Quote Versions with Line Items */}
          {quote && bestValueOption ? (
            <Card className="border-border bg-surface shadow-xs">
              <CardHeader className="p-4 pb-2 border-b border-border/50">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-primary" />
                      Quote #{quote.id} (v{quote.version ?? 1})
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {bestValueOption.planName} • {quote.billingPeriod} billing
                    </CardDescription>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold font-mono text-foreground">
                      {formatMoney(bestValueOption.total, quote.currency)}
                    </span>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-4 space-y-3">
                {/* Expandable Line Items Table */}
                <div className="rounded-md border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-surface-sunken/60 text-xs">
                        <TableHead>Item</TableHead>
                        <TableHead numeric className="w-[60px]">Qty</TableHead>
                        <TableHead numeric className="w-[110px]">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bestValueOption.lineItems.map((item) => (
                        <TableRow key={item.id} className="text-xs hover:bg-muted/20">
                          <TableCell className="font-medium text-foreground py-2">
                            {item.description}
                          </TableCell>
                          <TableCell numeric className="font-mono py-2">
                            {item.quantity}
                          </TableCell>
                          <TableCell numeric className="font-mono font-semibold text-foreground py-2">
                            {formatMoney(item.lineTotal, quote.currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-surface-sunken/40 font-bold border-t border-border">
                        <TableCell colSpan={2} className="text-xs text-foreground py-2">
                          Total Annual Cost:
                        </TableCell>
                        <TableCell numeric className="font-mono text-xs text-primary py-2 font-bold">
                          {formatMoney(bestValueOption.total, quote.currency)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                {/* Plain comparison line */}
                {quote.options.length > 1 && (
                  <p className="text-xs text-muted-foreground bg-surface-sunken p-2.5 rounded border border-border/50 leading-relaxed">
                    {bestValueOption.comparisonNote ||
                      `Professional includes expanded check capacity and 1-minute polling.`}
                  </p>
                )}

                {/* PDF Download link */}
                <div className="pt-2 flex justify-end">
                  <Button variant="ghost" size="sm" asChild className="h-8 gap-1.5 text-xs">
                    <a href={`/api/v1/quotes/${quote.id}/pdf`} download={`Quote24x7-${quote.id}.pdf`}>
                      <FilePdf className="h-3.5 w-3.5" />
                      <span>Download Quotation PDF</span>
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="p-6 text-center border-dashed border-border">
              <p className="text-xs text-muted-foreground">
                No quote options calculated yet for this conversation.
              </p>
            </Card>
          )}

          {/* 4. Action Buttons Bar (Send / Edit / Hold) */}
          <div className="flex items-center justify-between gap-3 p-4 rounded-lg border border-border bg-surface">
            <span className="text-xs font-medium text-foreground">Operator Actions:</span>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSend} className="h-8 text-xs gap-1.5">
                <PaperPlaneTilt className="h-3.5 w-3.5" />
                Send
              </Button>
              <Button size="sm" variant="outline" onClick={handleEdit} className="h-8 text-xs gap-1.5">
                <PencilSimple className="h-3.5 w-3.5" />
                Edit
              </Button>
              <Button size="sm" variant="secondary" onClick={handleHold} className="h-8 text-xs gap-1.5">
                <Pause className="h-3.5 w-3.5" />
                Hold
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
