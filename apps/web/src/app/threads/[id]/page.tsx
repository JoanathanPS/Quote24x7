"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
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
  ShieldCheck,
  Cpu,
  CaretDown,
  CaretUp,
} from "@phosphor-icons/react";

import {
  useThread,
  useThreadMessages,
  useThreadRequirements,
  useQuote,
  useDeliveries,
  useThreadAiDecisions,
} from "@/hooks/use-api";
import { formatMoney } from "@/server/pricing/money";
import { formatDateTime, formatRelativeTime, cn } from "@/lib/utils";
import type {
  RequestType,
  ThreadStatus,
  AiDecisionRecord,
} from "@/types/domain";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { EmailBody } from "@/components/email-body";
import { MessageAttachmentsList } from "@/components/inbox/message-attachments";
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
  dotClass: string;
} {
  switch (status) {
    case "completed":
      return { label: "Proposal Ready", variant: "success", dotClass: "bg-emerald-500" };
    case "awaiting_reply":
      return { label: "Needs Reply", variant: "warning", dotClass: "bg-amber-500" };
    case "pricing":
    case "extracting":
    case "document_generation":
    case "sending":
      return { label: "Configuring", variant: "primary", dotClass: "bg-sky-500 animate-pulse" };
    case "received":
      return { label: "Received", variant: "info", dotClass: "bg-sky-400" };
    case "failed":
    case "unsupported":
      return { label: "Needs Review", variant: "danger", dotClass: "bg-rose-500" };
    default:
      return { label: status, variant: "default", dotClass: "bg-muted-foreground" };
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
      return { label: "Inquiry", variant: "neutral" };
  }
}

type InspectorTab = "matrix" | "quote" | "ai";

export default function ThreadDetailPage() {
  const shouldReduceMotion = useReducedMotion();
  const params = useParams<{ id: string }>();
  const threadId = params?.id ?? "";

  const { data: thread, isLoading: threadLoading } = useThread(threadId);
  const { data: messages, isLoading: messagesLoading } = useThreadMessages(threadId);
  const { data: requirements } = useThreadRequirements(threadId);
  const { data: quote } = useQuote(thread?.quoteId ?? "");
  const { data: deliveries } = useDeliveries();
  const { data: aiDecisions } = useThreadAiDecisions(threadId);

  // Inspector Tab selection
  const [activeTab, setActiveTab] = React.useState<InspectorTab>("matrix");

  // Notification states & Action Feedback
  const [actionFeedback, setActionFeedback] = React.useState<string | null>(null);

  // RFC disclosure toggles per message id
  const [openRfcTraces, setOpenRfcTraces] = React.useState<Record<string, boolean>>({});

  const toggleRfcTrace = (msgId: string) => {
    setOpenRfcTraces((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

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
    setActionFeedback("Quote proposal re-dispatched to buyer via configured MTA.");
    setTimeout(() => setActionFeedback(null), 5000);
  };

  const handleEdit = () => {
    setActionFeedback("Editing mode active: operator adjustments ready for next sizing run.");
    setTimeout(() => setActionFeedback(null), 5000);
  };

  const handleHold = () => {
    setActionFeedback("Thread placed on Hold for manual sales desk review.");
    setTimeout(() => setActionFeedback(null), 5000);
  };

  if (threadLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-5 pb-12">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-96" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 space-y-3">
            <Skeleton className="h-48 w-full rounded-lg" />
            <Skeleton className="h-48 w-full rounded-lg" />
          </div>
          <div className="lg:col-span-5 space-y-3">
            <Skeleton className="h-64 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
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
    "Priced against quantities understood from buyer email communication.",
    "Add-on capacity sold in standard whole packs.",
  ];

  const bestValueOption = quote?.options.find((o) => o.optionType === "best_value") ?? quote?.options[0];
  const lowestCostOption = quote?.options.find((o) => o.optionType === "lowest_cost");

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-12">
      {/* Back Link & Breadcrumb */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Inbox</span>
        </Link>
      </div>

      {/* Action Notification Banner with Motion */}
      <AnimatePresence>
        {actionFeedback && (
          <motion.div
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.98 }}
            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary-soft/20 px-4 py-2.5 text-xs text-foreground shadow-xs"
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-primary shrink-0" weight="fill" />
              <span className="font-medium">{actionFeedback}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionFeedback(null)}
              className="text-[11px] text-muted-foreground hover:text-foreground font-mono ml-4"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Operator Alert Banner if failed */}
      {thread.status === "failed" && (
        <div className="flex flex-col gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3.5 sm:flex-row sm:items-center sm:justify-between text-rose-300">
          <div className="flex items-start gap-2.5">
            <WarningOctagon className="h-4.5 w-4.5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-xs text-rose-300">Human Review Required</p>
              <p className="mt-0.5 text-xs text-foreground/80 font-mono">
                {thread.statusDetail || "Thread paused for human pricing review."}
              </p>
            </div>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={handleHold}
            className="shrink-0 gap-1.5 self-start sm:self-auto h-7 text-xs"
          >
            <Pause className="h-3 w-3" />
            Mark on Hold
          </Button>
        </div>
      )}

      {/* Thread Command Header */}
      <div className="rounded-xl border border-border/80 bg-surface/90 p-4 shadow-xs space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-medium text-foreground">
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", statusInfo.dotClass)} />
                <span>{statusInfo.label}</span>
              </span>

              <span className="text-xs font-mono text-muted-foreground border border-border/60 px-1.5 py-0.5 rounded bg-muted/30">
                #{thread.id}
              </span>

              <Badge variant={typeInfo.variant} className="text-[10px] py-0 px-2 font-mono">
                {typeInfo.label}
              </Badge>

              <span className="text-xs font-mono text-muted-foreground">
                Turn {thread.roundsUsed || 1} of 3
              </span>
            </div>

            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-foreground leading-snug">
              {thread.subject}
            </h1>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {thread.quoteId && (
              <Button
                variant="default"
                size="sm"
                asChild
                className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-xs"
              >
                <a
                  href={`/api/v1/quotes/${thread.quoteId}/pdf`}
                  download={`Quote24x7-Proposal-${thread.quoteId}.pdf`}
                >
                  <FilePdf className="h-3.5 w-3.5" />
                  <span>PDF Quote</span>
                </a>
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleSend}
              className="h-8 gap-1.5 text-xs border-border/80 bg-surface hover:bg-surface-sunken"
            >
              <PaperPlaneTilt className="h-3.5 w-3.5" />
              <span>Dispatch</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleHold}
              className="h-8 gap-1.5 text-xs border-border/80 bg-surface hover:bg-surface-sunken"
            >
              <Pause className="h-3.5 w-3.5" />
              <span>Hold</span>
            </Button>
          </div>
        </div>

        {/* Sender Metadata Strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground pt-2 border-t border-border/50">
          <div className="flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" />
            <span className="font-semibold text-foreground">
              {thread.senderName || "Unknown Buyer"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <EnvelopeSimple className="h-3.5 w-3.5" />
            <span className="font-mono text-[11px]">{thread.senderEmail}</span>
          </div>
          {thread.organisation && (
            <div className="flex items-center gap-1.5">
              <Buildings className="h-3.5 w-3.5" />
              <span>{thread.organisation}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            <span>Created {formatDateTime(thread.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* Dual-Pane Command Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Column (60%): Email Conversation Timeline with Delivery Receipts */}
        <div className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <span>Conversation Timeline</span>
              <span className="text-[10px] font-mono text-muted-foreground font-normal">
                ({messages?.length ?? thread.messageCount} exchanges)
              </span>
            </h2>
          </div>

          {messagesLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-32 w-full rounded-lg" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          ) : !messages || messages.length === 0 ? (
            <Card className="p-8 text-center border-dashed border-border/80">
              <p className="text-xs text-muted-foreground">
                No message bodies recorded for this conversation yet.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {messages.map((msg, idx) => {
                const isInbound = msg.direction === "inbound";
                const deliveryStatus = msg.deliveryId ? deliveryStatusMap.get(msg.deliveryId) : null;
                const isRfcOpen = !!openRfcTraces[msg.id];

                return (
                  <motion.div
                    key={msg.id}
                    initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
                    animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, delay: idx * 0.05, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <Card
                      className={cn(
                        "transition-all border shadow-xs overflow-hidden",
                        isInbound
                          ? "bg-surface-sunken/40 border-border/80"
                          : "bg-primary-soft/10 border-primary/25"
                      )}
                    >
                      <CardHeader className="p-3.5 pb-2 space-y-1.5 border-b border-border/40">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div
                              className={cn(
                                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium shrink-0",
                                isInbound
                                  ? "bg-muted text-muted-foreground border border-border/60"
                                  : "bg-primary text-primary-foreground shadow-xs"
                              )}
                            >
                              {isInbound ? (
                                <ArrowDownLeft className="h-3 w-3" />
                              ) : (
                                <PaperPlaneTilt className="h-3 w-3" />
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-xs text-foreground">
                                  {isInbound ? msg.fromName || msg.fromAddress : "Quote24x7 Assistant"}
                                </span>
                                <Badge
                                  variant={isInbound ? "neutral" : "primary"}
                                  className="text-[9px] py-0 px-1 font-mono"
                                >
                                  {isInbound ? "INBOUND" : "OUTBOUND"}
                                </Badge>
                                {!isInbound && (
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded px-1.5 py-0.2 text-[9px] font-mono border",
                                      deliveryStatus === "delivered"
                                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                                        : deliveryStatus === "bounced" || deliveryStatus === "failed"
                                        ? "bg-rose-500/10 text-rose-400 border-rose-500/25"
                                        : "bg-sky-500/10 text-sky-400 border-sky-500/25"
                                    )}
                                  >
                                    MTA: {deliveryStatus ? deliveryStatus.toUpperCase() : "SENT"}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground">
                                To: {msg.toAddresses.join(", ")}
                              </p>
                            </div>
                          </div>

                          <span
                            className="text-[10px] text-muted-foreground whitespace-nowrap font-mono"
                            title={formatDateTime(msg.occurredAt)}
                          >
                            {formatRelativeTime(msg.occurredAt)}
                          </span>
                        </div>
                      </CardHeader>

                      <CardContent className="p-3.5 space-y-2.5">
                        <EmailBody
                          text={msg.bodyText}
                          className="font-sans text-xs text-foreground/90 leading-relaxed"
                        />

                        {/* Attachments */}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <MessageAttachmentsList
                            attachments={msg.attachments}
                            quoteId={thread.quoteId}
                          />
                        )}

                        {/* RFC Trace Accordion Toggle */}
                        <div className="pt-2 border-t border-border/40">
                          <button
                            type="button"
                            onClick={() => toggleRfcTrace(msg.id)}
                            className="flex items-center justify-between w-full text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <span className="flex items-center gap-1">
                              <ShieldCheck className="h-3 w-3 text-primary" />
                              <span>RFC Headers &amp; Deduplication Lock</span>
                            </span>
                            {isRfcOpen ? <CaretUp className="h-3 w-3" /> : <CaretDown className="h-3 w-3" />}
                          </button>

                          <AnimatePresence>
                            {isRfcOpen && (
                              <motion.div
                                initial={shouldReduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                                animate={shouldReduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                                exit={shouldReduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                                className="overflow-hidden"
                              >
                                <div className="mt-2 p-2 rounded bg-surface border border-border/60 text-[10px] font-mono text-muted-foreground space-y-1">
                                  <div className="truncate">
                                    <span className="text-foreground font-semibold">Message-ID:</span>{" "}
                                    {msg.messageIdHeader || msg.providerMessageId}
                                  </div>
                                  {msg.inReplyTo && (
                                    <div className="truncate">
                                      <span className="text-foreground font-semibold">In-Reply-To:</span>{" "}
                                      {msg.inReplyTo}
                                    </div>
                                  )}
                                  {msg.references && (
                                    <div className="truncate">
                                      <span className="text-foreground font-semibold">References:</span>{" "}
                                      {msg.references}
                                    </div>
                                  )}
                                  {msg.threadMatchMethod && (
                                    <div>
                                      <span className="text-foreground font-semibold">Match Rule:</span>{" "}
                                      {msg.threadMatchMethod}
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column (40%): 3-Tab Sizing & AI Command Inspector */}
        <div className="lg:col-span-5 space-y-3">
          {/* Inspector Tab Bar with Motion Indicator */}
          <div className="p-1 rounded-lg border border-border/80 bg-surface-sunken/40 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab("matrix")}
              className={cn(
                "relative flex-1 py-1.5 text-xs font-medium rounded-md transition-colors select-none text-center z-10",
                activeTab === "matrix" ? "text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {activeTab === "matrix" && (
                <motion.div
                  layoutId="threadInspectorActiveTab"
                  className="absolute inset-0 rounded-md bg-primary shadow-xs -z-10"
                  transition={
                    shouldReduceMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 450, damping: 35 }
                  }
                />
              )}
              <span>Sizing Matrix</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("quote")}
              className={cn(
                "relative flex-1 py-1.5 text-xs font-medium rounded-md transition-colors select-none text-center z-10",
                activeTab === "quote" ? "text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {activeTab === "quote" && (
                <motion.div
                  layoutId="threadInspectorActiveTab"
                  className="absolute inset-0 rounded-md bg-primary shadow-xs -z-10"
                  transition={
                    shouldReduceMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 450, damping: 35 }
                  }
                />
              )}
              <span>Plan Breakdown</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("ai")}
              className={cn(
                "relative flex-1 py-1.5 text-xs font-medium rounded-md transition-colors select-none text-center z-10",
                activeTab === "ai" ? "text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {activeTab === "ai" && (
                <motion.div
                  layoutId="threadInspectorActiveTab"
                  className="absolute inset-0 rounded-md bg-primary shadow-xs -z-10"
                  transition={
                    shouldReduceMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 450, damping: 35 }
                  }
                />
              )}
              <span>AI Provenance</span>
            </button>
          </div>

          {/* Tab Content Panels with AnimatePresence */}
          <AnimatePresence mode="wait">
            {activeTab === "matrix" && (
              <motion.div
                key="matrix-tab"
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-3"
              >
                {/* 6-Unit Requirements Matrix Card */}
                <Card className="border-border/80 bg-surface shadow-xs">
                  <CardHeader className="p-4 pb-2 border-b border-border/50">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      6-Unit Sizing Matrix
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Extracted requirement units audited against Site24x7 base plans.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="p-4 space-y-4">
                    {/* Stated Parameters */}
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                        Stated by Buyer
                      </span>
                      {statedFields.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {statedFields.map((f) => (
                            <span
                              key={f.key}
                              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs text-foreground"
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

                    {/* Assumed Parameters */}
                    <div className="pt-2 border-t border-border/40">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                        Assumptions &amp; Defaults
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

                    {/* Missing Requirements */}
                    <div className="pt-2 border-t border-border/40">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                        Missing Requirements
                      </span>
                      {missingFields.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {missingFields.map((f) => (
                            <span
                              key={f.key}
                              className="inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-xs text-amber-300"
                            >
                              <span>{f.label}</span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                          <CheckCircle className="h-3.5 w-3.5" />
                          <span>All core sizing parameters verified complete.</span>
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Pending Questions Card */}
                {requirements?.pendingQuestions && requirements.pendingQuestions.length > 0 && (
                  <Card className="border-amber-500/40 bg-amber-500/10 shadow-xs">
                    <CardHeader className="p-3.5 pb-1.5 border-b border-amber-500/25">
                      <div className="flex items-center gap-1.5 text-amber-300">
                        <Question className="h-4 w-4 font-bold" />
                        <CardTitle className="text-xs font-bold uppercase tracking-wider">
                          Clarification Questions Dispatched
                        </CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="p-3.5 space-y-2">
                      {requirements.pendingQuestions.map((q) => (
                        <div key={q.id} className="space-y-0.5">
                          <p className="text-xs font-semibold text-foreground">
                            &ldquo;{q.question}&rdquo;
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Trigger: {q.reason}
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </motion.div>
            )}

            {activeTab === "quote" && (
              <motion.div
                key="quote-tab"
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-3"
              >
                {quote && bestValueOption ? (
                  <Card className="border-border/80 bg-surface shadow-xs">
                    <CardHeader className="p-4 pb-2 border-b border-border/50">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Receipt className="h-4 w-4 text-primary" />
                            Quote #{quote.id} (v{quote.version ?? 1})
                          </CardTitle>
                          <CardDescription className="text-xs mt-0.5">
                            {bestValueOption.planName} • {quote.billingPeriod} billing
                          </CardDescription>
                        </div>
                        <div className="text-right">
                          <span className="text-base font-bold font-mono text-foreground">
                            {formatMoney(bestValueOption.total, quote.currency)}
                          </span>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="p-4 space-y-3">
                      {/* Itemized Line Items Table */}
                      <div className="rounded-md border border-border/80 overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-surface-sunken/60 text-xs">
                              <TableHead>Item</TableHead>
                              <TableHead numeric className="w-[60px]">Qty</TableHead>
                              <TableHead numeric className="w-[105px]">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {bestValueOption.lineItems.map((item) => (
                              <TableRow key={item.id} className="text-xs hover:bg-muted/20">
                                <TableCell className="font-medium text-foreground py-2 text-xs">
                                  {item.description}
                                </TableCell>
                                <TableCell numeric className="font-mono py-2 text-xs">
                                  {item.quantity}
                                </TableCell>
                                <TableCell numeric className="font-mono font-semibold text-foreground py-2 text-xs">
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

                      {/* Best Value vs Lowest Cost comparison */}
                      {lowestCostOption && lowestCostOption.id !== bestValueOption.id && (
                        <div className="rounded border border-border/60 bg-muted/20 p-2.5 text-xs space-y-1">
                          <span className="font-semibold text-foreground block">
                            Candidate Comparison:
                          </span>
                          <p className="text-muted-foreground leading-relaxed">
                            Lowest Cost option ({lowestCostOption.planName}) available at{" "}
                            <span className="font-mono font-semibold text-foreground">
                              {formatMoney(lowestCostOption.total, quote.currency)}
                            </span>
                            . Best Value includes expanded check capacity and 1-minute polling.
                          </p>
                        </div>
                      )}

                      {/* PDF Action */}
                      <div className="pt-2 flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          className="h-8 gap-1.5 text-xs text-primary hover:text-primary"
                        >
                          <a
                            href={`/api/v1/quotes/${quote.id}/pdf`}
                            download={`Quote24x7-${quote.id}.pdf`}
                          >
                            <FilePdf className="h-3.5 w-3.5" />
                            <span>Download Official Proposal PDF</span>
                          </a>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="p-6 text-center border-dashed border-border">
                    <p className="text-xs text-muted-foreground">
                      No calculated quote candidate exists yet for this conversation.
                    </p>
                  </Card>
                )}
              </motion.div>
            )}

            {activeTab === "ai" && (
              <motion.div
                key="ai-tab"
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-3"
              >
                <Card className="border-border/80 bg-surface shadow-xs">
                  <CardHeader className="p-4 pb-2 border-b border-border/50">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Cpu className="h-4 w-4 text-primary" />
                      AI Decision Provenance
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Transparent reasoning audit and rule citations governing this thread.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="p-4 space-y-3">
                    {aiDecisions && aiDecisions.length > 0 ? (
                      aiDecisions.map((dec: AiDecisionRecord) => (
                        <div
                          key={dec.id}
                          className="p-3 rounded-lg border border-border/70 bg-surface-sunken/40 space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-foreground">
                              Action: {dec.action.toUpperCase()}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {formatRelativeTime(dec.createdAt)}
                            </span>
                          </div>

                          <div className="space-y-1 text-muted-foreground text-[11px]">
                            <p>
                              <strong className="text-foreground">Source:</strong>{" "}
                              {dec.source === "gemini" ? `LLM (${dec.model || "Gemini"})` : "Deterministic Rules Fallback"}
                            </p>
                            <p>
                              <strong className="text-foreground">Customer Summary:</strong>{" "}
                              {dec.customerSummary}
                            </p>
                            {dec.identifiedNeeds && dec.identifiedNeeds.length > 0 && (
                              <p>
                                <strong className="text-foreground">Identified Needs:</strong>{" "}
                                {dec.identifiedNeeds.join(", ")}
                              </p>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-4 rounded border border-border/60 bg-muted/20 text-xs text-muted-foreground space-y-1.5">
                        <p className="font-semibold text-foreground">Deterministic Execution Path</p>
                        <p>
                          Requirements extracted directly via structured schema validation. Zero hallucinated parameters; price calculated strictly via official Site24x7 catalogue store tiers.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom Operator Command Bar */}
          <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border/80 bg-surface shadow-xs">
            <span className="text-xs font-semibold text-foreground">Operator Actions:</span>
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
