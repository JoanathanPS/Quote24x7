"use client";

import * as React from "react";
import Link from "next/link";
import {
  Tray,
  MagnifyingGlass,
  ArrowClockwise,
  ChatCircleText,
  CaretRight,
  User,
  PaperPlaneTilt,
  ArrowDownLeft,
  FilePdf,
  WarningOctagon,
  ClockCountdown,
  GearSix,
  HardDrives,
  Network,
  Globe,
  Database,
  FileText,
  Calendar,
  Buildings,
  EnvelopeSimple,
  Paperclip,
} from "@phosphor-icons/react";

import {
  useThreads,
  useThreadMessages,
  useThreadRequirements,
} from "@/hooks/use-api";
import { formatMoney } from "@/server/pricing/money";
import { formatRelativeTime, formatDateTime, cn } from "@/lib/utils";
import type {
  EmailThread,
  ThreadStatus,
} from "@/types/domain";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { EmailBody } from "@/components/email-body";

type HumanFilter = "all" | "needs_reply" | "configuring" | "proposal_ready" | "needs_review";

const HUMAN_FILTERS: { label: string; value: HumanFilter }[] = [
  { label: "All", value: "all" },
  { label: "Needs Reply", value: "needs_reply" },
  { label: "Configuring", value: "configuring" },
  { label: "Proposal Ready", value: "proposal_ready" },
  { label: "Needs Review", value: "needs_review" },
];

function getHumanStatus(status: ThreadStatus): {
  label: string;
  variant: "default" | "primary" | "success" | "warning" | "danger" | "info" | "neutral";
  category: HumanFilter;
} {
  switch (status) {
    case "completed":
      return { label: "Proposal Ready", variant: "success", category: "proposal_ready" };
    case "awaiting_reply":
      return { label: "Needs Reply", variant: "warning", category: "needs_reply" };
    case "pricing":
    case "extracting":
    case "document_generation":
    case "sending":
      return { label: "Configuring", variant: "primary", category: "configuring" };
    case "received":
      return { label: "Received", variant: "info", category: "configuring" };
    case "failed":
    case "unsupported":
      return { label: "Needs Review", variant: "danger", category: "needs_review" };
    default:
      return { label: status, variant: "default", category: "all" };
  }
}

export default function InboxPage() {
  const [search, setSearch] = React.useState("");
  const [activeFilter, setActiveFilter] = React.useState<HumanFilter>("all");
  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(null);

  const {
    data: threads,
    isLoading: threadsLoading,
    isFetching: threadsFetching,
    refetch: refetchThreads,
  } = useThreads();

  // Filter threads client-side
  const filteredThreads = React.useMemo(() => {
    if (!threads) return [];
    return threads.filter((t) => {
      const human = getHumanStatus(t.status);
      if (activeFilter !== "all" && human.category !== activeFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesSender = t.senderEmail?.toLowerCase().includes(q) ?? false;
        const matchesName = t.senderName?.toLowerCase().includes(q) ?? false;
        const matchesOrg = t.organisation?.toLowerCase().includes(q) ?? false;
        const matchesSubject = t.subject?.toLowerCase().includes(q) ?? false;
        return matchesSender || matchesName || matchesOrg || matchesSubject;
      }
      return true;
    });
  }, [threads, activeFilter, search]);

  // Counts for tabs
  const counts = React.useMemo(() => {
    if (!threads) return { all: 0, needs_reply: 0, configuring: 0, proposal_ready: 0, needs_review: 0 };
    return {
      all: threads.length,
      needs_reply: threads.filter((t) => getHumanStatus(t.status).category === "needs_reply").length,
      configuring: threads.filter((t) => getHumanStatus(t.status).category === "configuring").length,
      proposal_ready: threads.filter((t) => getHumanStatus(t.status).category === "proposal_ready").length,
      needs_review: threads.filter((t) => getHumanStatus(t.status).category === "needs_review").length,
    };
  }, [threads]);

  // Auto-select first thread if none selected or if current selection is not in list
  React.useEffect(() => {
    if (filteredThreads.length > 0) {
      if (!selectedThreadId || !filteredThreads.some((t) => t.id === selectedThreadId)) {
        const first = filteredThreads[0];
        if (first) {
          setSelectedThreadId(first.id);
        }
      }
    } else {
      setSelectedThreadId(null);
    }
  }, [filteredThreads, selectedThreadId]);

  const selectedThread = React.useMemo(
    () => threads?.find((t) => t.id === selectedThreadId) ?? null,
    [threads, selectedThreadId]
  );

  return (
    <div className="mx-auto max-w-7xl w-full flex-1 min-h-0 flex flex-col space-y-3">
      {/* Top Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-3 shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Tray className="h-5 w-5 text-primary" />
            Autonomous Quotation Inbox
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time inbound email requests, autonomous sizing clarification, and AI-configured Site24x7 proposals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetchThreads()}
            disabled={threadsFetching}
            className="h-8 gap-1.5 text-xs"
          >
            <ArrowClockwise
              className={cn("h-3.5 w-3.5", threadsFetching && "animate-spin text-primary")}
            />
            {threadsFetching ? "Syncing..." : "Sync"}
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between shrink-0">
        {/* Search */}
        <div className="relative flex-1 sm:max-w-md">
          <MagnifyingGlass className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sender, organisation, subject..."
            className="flex h-8 w-full rounded-md border border-border bg-surface pl-8 pr-3 py-1 text-xs text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        {/* Human Status Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto">
          {HUMAN_FILTERS.map((f) => {
            const active = activeFilter === f.value;
            const count = counts[f.value];
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setActiveFilter(f.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors select-none",
                  active
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-surface border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <span>{f.label}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                    active
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Split Pane: Thread List (Left) + Detail & Timeline (Right) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 flex-1 min-h-0">
        {/* Left Pane: Thread List */}
        <div className="lg:col-span-5 flex flex-col min-h-0 h-full">
          {threadsLoading ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="p-3 rounded-lg border border-border bg-surface space-y-2">
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-14" />
                  </div>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="p-8 border border-border rounded-xl bg-surface text-center">
              <EmptyState
                icon={Tray}
                title="No conversations found"
                description={
                  search.trim() || activeFilter !== "all"
                    ? "No email threads match the current filter. Try adjusting your search query."
                    : "No inbound email requests yet."
                }
              />
            </div>
          ) : (
            <div className="space-y-2 overflow-y-auto pr-1 flex-1 min-h-0">
              {filteredThreads.map((thread) => {
                const isSelected = thread.id === selectedThreadId;
                const statusInfo = getHumanStatus(thread.status);

                return (
                  <div
                    key={thread.id}
                    onClick={() => setSelectedThreadId(thread.id)}
                    className={cn(
                      "cursor-pointer rounded-lg border p-3.5 transition-all text-left",
                      isSelected
                        ? "border-primary bg-primary/5 shadow-xs ring-1 ring-primary/25"
                        : "border-border/80 bg-surface hover:border-border hover:bg-muted/30"
                    )}
                  >
                    {/* Top Row: Sender + Relative Time */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-semibold text-xs text-foreground truncate">
                          {thread.senderName || thread.senderEmail}
                        </span>
                        {thread.organisation && (
                          <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">
                            • {thread.organisation}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                        {formatRelativeTime(thread.lastMessageAt || thread.updatedAt)}
                      </span>
                    </div>

                    {/* Subject Line */}
                    <p
                      className={cn(
                        "mt-1 text-xs font-medium line-clamp-1",
                        isSelected ? "text-primary" : "text-foreground"
                      )}
                    >
                      {thread.subject}
                    </p>

                    {/* Bottom Metadata Row: Badges, Status, and Amount */}
                    <div className="mt-2.5 flex items-center justify-between gap-2 pt-2 border-t border-border/40">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Status Badge */}
                        <Badge variant={statusInfo.variant} className="text-[9px] py-0 px-1.5 font-medium">
                          {statusInfo.label}
                        </Badge>
                      </div>

                      {/* Quoted Amount or Message Count */}
                      <div className="flex items-center gap-2">
                        {thread.quoteTotal != null && thread.currency ? (
                          <span className="text-xs font-semibold font-mono text-foreground">
                            {formatMoney(thread.quoteTotal, thread.currency)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1 font-mono">
                            <ChatCircleText className="h-3 w-3" />
                            {thread.messageCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Pane: Selected Thread Detail & Timeline */}
        <div className="lg:col-span-7 h-full flex flex-col min-h-0">
          {selectedThread ? (
            <SelectedThreadPanel thread={selectedThread} />
          ) : (
            <div className="flex h-full min-h-[400px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface p-8 text-center">
              <Tray className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <h3 className="text-sm font-semibold text-foreground">No thread selected</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Select an inbound email conversation from the list to review the thread timeline, extracted requirements, and proposal.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selected Thread Panel Component
// ---------------------------------------------------------------------------

function SelectedThreadPanel({ thread }: { thread: EmailThread }) {
  const { data: messages, isLoading: messagesLoading } = useThreadMessages(thread.id);
  const { data: requirements, isLoading: reqsLoading } = useThreadRequirements(thread.id);

  const statusInfo = getHumanStatus(thread.status);

  // Format extracted parameters helper with support for domain keys and legacy keys
  const getFieldVal = (keys: string[]) => {
    const f = requirements?.fields.find((item) => keys.includes(item.key));
    return f && f.state !== "missing" ? f.value : null;
  };

  const extractedHosts = getFieldVal(["servers", "host_count"]);
  const extractedNetwork = getFieldVal(["network_devices", "network_device_count"]);
  const extractedSynthetic = getFieldVal(["advanced_monitors", "synthetic_monitors_count"]);
  const extractedBasic = getFieldVal(["basic_monitors"]);
  const extractedRum = getFieldVal(["rum_pageviews", "rum_pageviews_monthly"]);
  const extractedLogs = getFieldVal(["applogs_volume", "applogs_gb_monthly"]);
  const extractedBilling = getFieldVal(["billing_period", "billing_cycle"]);

  const missingFields = requirements?.fields.filter((f) => f.state === "missing") ?? [];

  return (
    <Card className="border-border bg-surface shadow-xs flex flex-col h-full min-h-0 overflow-hidden">
      {/* Thread Detail Header */}
      <CardHeader className="p-4 border-b border-border bg-surface-sunken/40 space-y-3 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <StatusDot status={thread.status} />
                <Badge variant={statusInfo.variant} className="text-[11px] font-medium">
                  {statusInfo.label}
                </Badge>
              </div>
              <span className="text-[11px] font-mono text-muted-foreground">
                #{thread.id}
              </span>
            </div>
            <h2 className="text-base font-bold text-foreground tracking-tight leading-snug">
              {thread.subject}
            </h2>
          </div>

          {/* Action Links */}
          <div className="flex items-center gap-2 shrink-0">
            {thread.quoteId && (
              <Button variant="default" size="sm" asChild className="h-8 gap-1.5 text-xs shadow-xs" title="Download Official Vector PDF">
                <a href={`/api/v1/quotes/${thread.quoteId}/pdf`} download={`Quote24x7-Proposal-${thread.quoteId}.pdf`}>
                  <FilePdf className="h-3.5 w-3.5" />
                  <span>PDF Quote</span>
                </a>
              </Button>
            )}
            <Button variant="ghost" size="sm" asChild className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
              <Link href={`/threads/${thread.id}`} title="Inspect Operator Diagnostics">
                <span>Details</span>
                <CaretRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Sender details row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1 border-t border-border/40">
          <div className="flex items-center gap-1">
            <User className="h-3.5 w-3.5 text-foreground/70" />
            <span className="font-medium text-foreground">{thread.senderName || "Unknown"}</span>
          </div>
          <div className="flex items-center gap-1">
            <EnvelopeSimple className="h-3.5 w-3.5 text-foreground/70" />
            <a href={`mailto:${thread.senderEmail}`} className="hover:underline">
              {thread.senderEmail}
            </a>
          </div>
          {thread.organisation && (
            <div className="flex items-center gap-1">
              <Buildings className="h-3.5 w-3.5 text-foreground/70" />
              <span>{thread.organisation}</span>
            </div>
          )}
          <div className="flex items-center gap-1 ml-auto font-mono text-[11px]">
            <Calendar className="h-3.5 w-3.5" />
            <span>{formatDateTime(thread.lastMessageAt || thread.updatedAt)}</span>
          </div>
        </div>
      </CardHeader>

      {/* Extracted Workload Sizing Strip */}
      <div className="px-4 py-2.5 bg-surface border-b border-border text-xs shrink-0">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="font-semibold text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <GearSix className="h-3.5 w-3.5 text-primary" />
            Extracted Monitoring Sizing
          </span>
          {thread.quoteTotal != null && thread.currency && (
            <span className="font-mono font-bold text-foreground text-xs">
              Total: {formatMoney(thread.quoteTotal, thread.currency)} ({thread.currency})
            </span>
          )}
        </div>

        {reqsLoading ? (
          <Skeleton className="h-6 w-full" />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {extractedHosts != null && (
              <span className="inline-flex items-center gap-1 rounded bg-muted/60 border border-border px-2 py-0.5 text-[11px] text-foreground font-mono">
                <HardDrives className="h-3 w-3 text-primary" />
                {String(extractedHosts)} Hosts
              </span>
            )}
            {extractedNetwork != null && (
              <span className="inline-flex items-center gap-1 rounded bg-muted/60 border border-border px-2 py-0.5 text-[11px] text-foreground font-mono">
                <Network className="h-3 w-3 text-primary" />
                {String(extractedNetwork)} Network Devices
              </span>
            )}
            {extractedSynthetic != null && (
              <span className="inline-flex items-center gap-1 rounded bg-muted/60 border border-border px-2 py-0.5 text-[11px] text-foreground font-mono">
                <Globe className="h-3 w-3 text-primary" />
                {String(extractedSynthetic)} Synthetic
              </span>
            )}
            {extractedBasic != null && (
              <span className="inline-flex items-center gap-1 rounded bg-muted/60 border border-border px-2 py-0.5 text-[11px] text-foreground font-mono">
                <Globe className="h-3 w-3 text-primary" />
                {String(extractedBasic)} Basic Monitors
              </span>
            )}
            {extractedRum != null && (
              <span className="inline-flex items-center gap-1 rounded bg-muted/60 border border-border px-2 py-0.5 text-[11px] text-foreground font-mono">
                <FileText className="h-3 w-3 text-primary" />
                {Number(extractedRum) >= 1_000_000
                  ? `${(Number(extractedRum) / 1_000_000).toFixed(0)}M`
                  : Number(extractedRum).toLocaleString()}{" "}
                RUM Views/mo
              </span>
            )}
            {extractedLogs != null && (
              <span className="inline-flex items-center gap-1 rounded bg-muted/60 border border-border px-2 py-0.5 text-[11px] text-foreground font-mono">
                <Database className="h-3 w-3 text-primary" />
                {String(extractedLogs)} GB Logs/mo
              </span>
            )}
            {extractedBilling && (
              <span className="inline-flex items-center gap-1 rounded bg-muted/60 border border-border px-2 py-0.5 text-[11px] text-foreground font-mono capitalize">
                {String(extractedBilling)} Billing
              </span>
            )}
          </div>
        )}

        {/* Clarification Alert if missing items */}
        {missingFields.length > 0 && thread.status === "awaiting_reply" && (
          <div className="mt-2 rounded border border-warning/40 bg-warning-soft/20 p-2 text-[11px] text-warning-soft-foreground flex items-center gap-2">
            <ClockCountdown className="h-4 w-4 shrink-0 text-warning" />
            <span>
              <strong>Clarification Sent:</strong> Awaiting buyer clarification for{" "}
              {missingFields.map((f) => f.label).join(", ")}.
            </span>
          </div>
        )}

        {/* Review Alert if failed/unsupported */}
        {(thread.status === "failed" || thread.status === "unsupported") && (
          <div className="mt-2 rounded border border-danger/40 bg-danger-soft/20 p-2 text-[11px] text-danger-soft-foreground flex items-center gap-2">
            <WarningOctagon className="h-4 w-4 shrink-0 text-danger" />
            <span>
              <strong>Attention Required:</strong> {thread.statusDetail || "Custom enterprise review needed."}
            </span>
          </div>
        )}
      </div>

      {/* Message Timeline */}
      <CardContent className="p-4 flex-1 min-h-0 overflow-y-auto space-y-4">
        {messagesLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !messages || messages.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            No messages recorded in this conversation yet.
          </p>
        ) : (
          messages.map((msg) => {
            const isInbound = msg.direction === "inbound";

            return (
              <div
                key={msg.id}
                className={cn(
                  "rounded-lg border p-3.5 space-y-2 transition-all",
                  isInbound
                    ? "border-border/80 bg-surface/90"
                    : "border-primary/20 bg-primary-soft/10"
                )}
              >
                {/* Message Header */}
                <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-full text-xs",
                        isInbound
                          ? "bg-muted text-muted-foreground"
                          : "bg-primary text-primary-foreground"
                      )}
                    >
                      {isInbound ? (
                        <ArrowDownLeft className="h-3 w-3" />
                      ) : (
                        <PaperPlaneTilt className="h-3 w-3" />
                      )}
                    </div>
                    <div>
                      <span className="font-semibold text-xs text-foreground">
                        {isInbound ? msg.fromName || msg.fromAddress : "Quote24x7 AI Assistant"}
                      </span>
                      {" "}
                      <span className="text-[11px] text-muted-foreground ml-1">
                        {isInbound ? `to ${msg.toAddresses[0] || "Quote24x7"}` : `to ${msg.toAddresses[0]}`}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono" title={formatDateTime(msg.occurredAt)}>
                    {formatRelativeTime(msg.occurredAt)}
                  </span>
                </div>

                {/* Message Body */}
                <EmailBody
                  text={msg.bodyText}
                  className="font-sans text-xs text-foreground/90 leading-relaxed"
                />

                {/* Attachments if any */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="pt-2 border-t border-border/40 flex flex-wrap gap-2">
                    {msg.attachments.map((att, idx) => (
                      <div
                        key={idx}
                        className="inline-flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 text-xs"
                      >
                        <Paperclip className="h-3 w-3 text-muted-foreground" />
                        <span className="font-medium text-[11px] text-foreground">{att.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          ({(att.sizeBytes / 1024).toFixed(0)} KB)
                        </span>
                        {thread.quoteId && (
                          <a
                            href={`/api/v1/quotes/${thread.quoteId}/pdf`}
                            download={att.name}
                            className="ml-1 text-[10px] text-primary hover:underline font-medium"
                          >
                            Download
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

