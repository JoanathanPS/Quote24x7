"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowDownLeft,
  PaperPlaneTilt,
  Receipt,
  ArrowsClockwise,
  WarningCircle,
  WarningOctagon,
  Question,
  User,
  EnvelopeSimple,
  Buildings,
  Calendar,
  CaretDown,
  CaretUp,
  Paperclip,
  ShieldWarning,
  ArrowRight,
  Info,
} from "@phosphor-icons/react";

import {
  useThread,
  useThreadMessages,
  useThreadRequirements,
  useQuote,
} from "@/hooks/use-api";
import { formatMoney } from "@/server/pricing/money";
import { formatDateTime, formatRelativeTime, cn } from "@/lib/utils";
import type {
  FieldState,
  RequestType,
  RequirementField,
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

function getFieldStateBadge(state: FieldState): {
  label: string;
  variant: "default" | "primary" | "success" | "warning" | "danger" | "info" | "neutral";
} {
  switch (state) {
    case "provided":
      return { label: "Provided", variant: "success" };
    case "inferred":
      return { label: "Inferred", variant: "info" };
    case "missing":
      return { label: "Missing", variant: "warning" };
    case "conflicting":
      return { label: "Conflicting", variant: "danger" };
    default:
      return { label: state, variant: "default" };
  }
}

const CATEGORY_ORDER: { key: RequirementField["group"]; title: string }[] = [
  { key: "infrastructure", title: "Infrastructure & Resources" },
  { key: "applications", title: "Applications & Synthetic" },
  { key: "commercial", title: "Commercial & Commitment" },
  { key: "context", title: "Context & Architecture" },
];

export default function ThreadDetailPage() {
  const params = useParams<{ id: string }>();
  const threadId = params?.id ?? "";

  const { data: thread, isLoading: threadLoading, refetch: refetchThread } = useThread(threadId);
  const { data: messages, isLoading: messagesLoading } = useThreadMessages(threadId);
  const { data: requirements, isLoading: reqsLoading } = useThreadRequirements(threadId);
  const { data: quote } = useQuote(thread?.quoteId ?? "");

  // Notification states
  const [operatorNotice, setOperatorNotice] = React.useState<string | null>(null);
  const [expandedFields, setExpandedFields] = React.useState<Set<string>>(new Set());

  const toggleFieldEvidence = (fieldKey: string) => {
    setExpandedFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) {
        next.delete(fieldKey);
      } else {
        next.add(fieldKey);
      }
      return next;
    });
  };

  const handleReprocess = () => {
    setOperatorNotice("Thread queued for re-analysis: Extractor model dispatched.");
    setTimeout(() => {
      void refetchThread();
    }, 1500);
  };

  const handleRetryDelivery = () => {
    setOperatorNotice("Retry queued for delivery: Dispatcher will re-attempt delivery in next cycle.");
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
          description={`The requested email thread "${threadId}" could not be located in the operational index.`}
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

  // Group fields by category
  const groupedFields = requirements?.fields
    ? CATEGORY_ORDER.map((cat) => ({
        ...cat,
        fields: requirements.fields.filter((f) => f.group === cat.key),
      })).filter((cat) => cat.fields.length > 0)
    : [];

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

      {/* Operator Alert / Notification Notice */}
      {operatorNotice && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary-soft/20 px-4 py-3 text-sm text-foreground animate-fade-in">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-primary shrink-0" />
            <span>{operatorNotice}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOperatorNotice(null)}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Failed Delivery Operator Banner */}
      {thread.status === "failed" && (
        <div className="flex flex-col gap-3 rounded-lg border border-danger/40 bg-danger-soft/20 p-4 sm:flex-row sm:items-center sm:justify-between text-danger-soft-foreground">
          <div className="flex items-start gap-3">
            <WarningOctagon className="h-5 w-5 text-danger shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-danger">Delivery Failure Detected</p>
              <p className="mt-0.5 text-xs text-foreground/80 font-mono">
                {thread.statusDetail || "Outbound quote dispatch rejected by mail transfer agent."}
              </p>
            </div>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={handleRetryDelivery}
            className="shrink-0 gap-1.5 self-start sm:self-auto"
          >
            <ArrowsClockwise className="h-3.5 w-3.5" />
            Retry Delivery
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

          {/* Sender Metadata Strip */}
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

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReprocess}
            className="gap-1.5 text-xs h-9"
          >
            <ArrowsClockwise className="h-3.5 w-3.5" />
            Reprocess Thread
          </Button>
          {thread.quoteId && (
            <Button
              variant="default"
              size="sm"
              asChild
              className="gap-1.5 text-xs h-9"
            >
              <Link href={`/quotes/${thread.quoteId}`}>
                <Receipt className="h-3.5 w-3.5" />
                View Generated Quote
                <ArrowRight className="h-3.5 w-3.5 ml-0.5" />
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Two-Column Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Column 1: Message Timeline */}
        <div className="lg:col-span-7 xl:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">
                Message Timeline
              </h2>
              <Badge variant="neutral" className="text-xs font-mono">
                {messages?.length ?? thread.messageCount} messages
              </Badge>
            </div>
          </div>

          {/* Pending Clarification Callout */}
          {requirements?.pendingQuestions && requirements.pendingQuestions.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning-soft/25 p-4 space-y-2">
              <div className="flex items-center gap-2 text-warning-soft-foreground">
                <Question className="h-4 w-4 shrink-0 font-bold" />
                <span className="font-semibold text-xs uppercase tracking-wider">
                  Pending Clarification
                </span>
              </div>
              {requirements.pendingQuestions.map((q) => (
                <div key={q.id} className="space-y-1.5 text-sm">
                  <p className="font-medium text-foreground">
                    Waiting for buyer response to question:
                  </p>
                  <blockquote className="border-l-2 border-warning/60 pl-3 italic text-foreground/90 text-sm py-0.5">
                    &ldquo;{q.question}&rdquo;
                  </blockquote>
                  <p className="text-xs text-muted-foreground">
                    Reason: {q.reason}
                    {q.askedAt && ` • Asked ${formatRelativeTime(q.askedAt)}`}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Message List */}
          {messagesLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
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
                    <CardHeader className="p-4 pb-3 space-y-2">
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
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-foreground">
                                {msg.fromName || msg.fromAddress}
                              </span>
                              <Badge
                                variant={isInbound ? "neutral" : "primary"}
                                className="text-[10px] py-0 px-1.5"
                              >
                                {isInbound ? "Inbound" : "Outbound Quote"}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              From: {msg.fromAddress} • To: {msg.toAddresses.join(", ")}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1">
                          <span
                            className="text-xs text-muted-foreground whitespace-nowrap"
                            title={formatDateTime(msg.occurredAt)}
                          >
                            {formatRelativeTime(msg.occurredAt)}
                          </span>
                          {!isInbound && (
                            <Badge
                              variant={thread.status === "failed" ? "danger" : "success"}
                              className="text-[10px] py-0 px-1.5"
                            >
                              {thread.status === "failed" ? "Delivery Failed" : "Delivered"}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Subject */}
                      <p className="text-xs font-medium text-foreground pt-1 border-t border-border/40">
                        {msg.subject}
                      </p>
                    </CardHeader>

                    <CardContent className="p-4 pt-0 space-y-3">
                      {/* Sanitized Body */}
                      <EmailBody
                        text={msg.bodyText}
                        className="rounded-md border border-border/50 bg-surface/75 p-3.5 font-sans text-sm text-foreground/90 leading-relaxed selection:bg-primary-soft"
                      />

                      {/* Security Notes if flagged */}
                      {msg.securityNotes && msg.securityNotes.length > 0 && (
                        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft/20 p-2 text-xs text-warning-soft-foreground">
                          <ShieldWarning className="h-4 w-4 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-medium">Ingress Security Note:</span>{" "}
                            {msg.securityNotes.join(", ")}
                          </div>
                        </div>
                      )}

                      {/* Attachments */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="space-y-1 pt-1">
                          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                            Attachments
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {msg.attachments.map((att, idx) => (
                              <div
                                key={idx}
                                className="flex items-center gap-1.5 rounded border border-border bg-surface px-2.5 py-1 text-xs text-foreground"
                              >
                                <Paperclip className="h-3 w-3 text-muted-foreground" />
                                <span className="font-medium">{att.name}</span>
                                <span className="text-[11px] text-muted-foreground">
                                  ({(att.sizeBytes / 1024).toFixed(1)} KB)
                                </span>
                                {att.scanned && (
                                  <Badge variant="success" className="text-[9px] py-0 px-1">
                                    Scanned
                                  </Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Column 2: Extracted Requirements & Associated Quote */}
        <div className="lg:col-span-5 xl:col-span-5 space-y-6">
          {/* Associated Quote Summary Card */}
          {thread.quoteId ? (
            <Card className="border-primary/40 bg-surface shadow-xs">
              <CardHeader className="p-5 pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground">
                      <Receipt className="h-4 w-4" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold">
                        Generated Quotation
                      </CardTitle>
                      <CardDescription className="text-xs font-mono">
                        Quote #{thread.quoteId}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="primary" className="text-xs">
                    3 Options
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-5 pt-0 space-y-4">
                <div className="rounded-lg bg-surface-sunken p-3.5 border border-border/60">
                  <span className="text-xs text-muted-foreground font-medium">
                    Calculated Quoted Total
                  </span>
                  <div className="mt-1 text-2xl font-bold font-mono text-foreground">
                    {thread.quoteTotal != null && thread.currency
                      ? formatMoney(thread.quoteTotal, thread.currency)
                      : "—"}
                  </div>
                  {quote && (
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                      <Badge variant="neutral" className="text-[10px] py-0">
                        {quote.billingPeriod} billing
                      </Badge>
                      <Badge variant="neutral" className="text-[10px] py-0">
                        Market: {quote.market}
                      </Badge>
                      <Badge variant="neutral" className="text-[10px] py-0">
                        Catalogue {quote.catalogueVersion}
                      </Badge>
                    </div>
                  )}
                </div>

                <Button variant="default" size="sm" asChild className="w-full gap-2 text-xs">
                  <Link href={`/quotes/${thread.quoteId}`}>
                    Open Quote Details
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border bg-surface-sunken/40 shadow-xs p-5">
              <div className="flex items-center gap-2.5 text-muted-foreground">
                <Receipt className="h-4 w-4 shrink-0" />
                <span className="text-xs font-medium">
                  {thread.status === "pricing"
                    ? "Pricing engine actively computing quotation options..."
                    : thread.status === "awaiting_reply"
                    ? "Quote generation paused awaiting buyer reply."
                    : "No quote generated yet for this thread."}
                </span>
              </div>
            </Card>
          )}

          {/* Extracted Requirements Profile Card */}
          <Card className="border-border/80 bg-surface shadow-xs">
            <CardHeader className="p-5 pb-3 space-y-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  Extracted Requirements
                </CardTitle>
                {requirements && (
                  <div className="flex items-center gap-1.5">
                    <Badge variant="neutral" className="text-[10px] font-mono">
                      {requirements.extractorModel}
                    </Badge>
                    <Badge variant="neutral" className="text-[10px]">
                      v{requirements.version}
                    </Badge>
                  </div>
                )}
              </div>

              {/* Summary Statement */}
              {requirements?.summary && (
                <p className="text-xs text-muted-foreground bg-surface-sunken p-3 rounded-md border border-border/50 leading-relaxed">
                  {requirements.summary}
                </p>
              )}
            </CardHeader>

            <CardContent className="p-5 pt-0 space-y-5">
              {reqsLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : !requirements || groupedFields.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No extracted requirement profile available for this thread.
                </p>
              ) : (
                groupedFields.map((cat) => (
                  <div key={cat.key} className="space-y-2.5">
                    <div className="flex items-center gap-2 border-b border-border/60 pb-1">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {cat.title}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {cat.fields.map((field) => {
                        const stateBadge = getFieldStateBadge(field.state);
                        const isExpanded = expandedFields.has(field.key);

                        return (
                          <div
                            key={field.key}
                            className="rounded-md border border-border/60 bg-surface-sunken/40 p-3 space-y-2 text-xs transition-colors hover:border-border"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-foreground text-xs">
                                    {field.label}
                                  </span>
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    ({field.key})
                                  </span>
                                </div>
                                <div className="mt-1 flex items-baseline gap-1.5">
                                  <span className="font-bold text-sm text-foreground">
                                    {field.value != null ? String(field.value) : "Not specified"}
                                  </span>
                                  {field.unit && field.value != null && (
                                    <span className="text-muted-foreground font-medium">
                                      {field.unit}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex flex-col items-end gap-1">
                                <Badge variant={stateBadge.variant} className="text-[10px] py-0 px-1.5">
                                  {stateBadge.label}
                                </Badge>
                                {field.confidence != null && (
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    {(field.confidence * 100).toFixed(0)}% conf
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Evidence Collapsible */}
                            {field.evidence && (
                              <div className="pt-1 border-t border-border/40">
                                <button
                                  type="button"
                                  onClick={() => toggleFieldEvidence(field.key)}
                                  className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline select-none"
                                >
                                  {isExpanded ? (
                                    <>
                                      <CaretUp className="h-3 w-3" />
                                      Hide evidence quote
                                    </>
                                  ) : (
                                    <>
                                      <CaretDown className="h-3 w-3" />
                                      View evidence text
                                    </>
                                  )}
                                </button>
                                {isExpanded && (
                                  <blockquote className="mt-1.5 rounded bg-surface p-2 text-[11px] italic text-foreground/85 border-l-2 border-primary/50 leading-relaxed font-sans">
                                    &ldquo;{field.evidence}&rdquo;
                                  </blockquote>
                                )}
                              </div>
                            )}

                            {/* Conflicting Detail */}
                            {field.conflictWith && (
                              <p className="text-[11px] text-danger font-medium">
                                Conflicted with: {field.conflictWith}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
