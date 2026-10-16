"use client";

import * as React from "react";
import {
  FilePdf,
  FileText,
  Table,
  Paperclip,
  CaretDown,
  CaretUp,
  DownloadSimple,
  Copy,
  Check,
  ShieldCheck,
} from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MessageAttachment, DocumentFormatKind } from "@/types/domain";

interface MessageAttachmentsListProps {
  attachments: MessageAttachment[];
  quoteId?: string | null;
  className?: string;
}

export function getAttachmentKind(att: MessageAttachment): DocumentFormatKind {
  if (att.documentKind) return att.documentKind;
  const name = att.name.toLowerCase();
  const ct = att.contentType.toLowerCase();

  if (name.endsWith(".pdf") || ct.includes("pdf")) return "pdf";
  if (name.endsWith(".docx") || name.endsWith(".doc") || ct.includes("word") || ct.includes("officedocument.wordprocessingml")) return "word";
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv") || ct.includes("spreadsheet") || ct.includes("excel") || ct.includes("csv")) return "excel";
  if (name.endsWith(".txt") || ct.includes("text/plain")) return "text";
  return "other";
}

export function MessageAttachmentsList({
  attachments,
  quoteId,
  className,
}: MessageAttachmentsListProps) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className={cn("space-y-2 pt-2 border-t border-border/40", className)}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        <Paperclip className="h-3 w-3" />
        <span>Attachments ({attachments.length})</span>
      </div>

      <div className="flex flex-col gap-2">
        {attachments.map((att, idx) => (
          <AttachmentCard key={idx} att={att} quoteId={quoteId} />
        ))}
      </div>
    </div>
  );
}

function AttachmentCard({
  att,
  quoteId,
}: {
  att: MessageAttachment;
  quoteId?: string | null;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const kind = getAttachmentKind(att);

  const handleCopy = async () => {
    if (!att.extractedText) return;
    try {
      await navigator.clipboard.writeText(att.extractedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const downloadUrl = att.contentBase64
    ? `data:${att.contentType};base64,${att.contentBase64}`
    : quoteId && kind === "pdf"
    ? `/api/v1/quotes/${quoteId}/pdf`
    : null;

  return (
    <div className="rounded-md border border-border/70 bg-surface/80 p-2.5 transition-colors shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FormatIcon kind={kind} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs text-foreground truncate max-w-[240px] sm:max-w-[340px]" title={att.name}>
                {att.name}
              </span>
              <FormatBadge kind={kind} />
              {att.scanned && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1 py-0.2 rounded font-medium">
                  <ShieldCheck className="h-3 w-3" />
                  Scanned
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {(att.sizeBytes / 1024).toFixed(1)} KB &bull; {att.contentType || "document"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={att.name}
              className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
            >
              <DownloadSimple className="h-3 w-3 text-muted-foreground" />
              Download
            </a>
          )}

          {att.extractedText && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className={cn(
                "inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors",
                expanded
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {expanded ? (
                <>
                  <CaretUp className="h-3 w-3" />
                  Hide Extracted
                </>
              ) : (
                <>
                  <CaretDown className="h-3 w-3" />
                  Extracted Text
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {expanded && att.extractedText && (
        <div className="mt-2.5 pt-2.5 border-t border-border/50">
          <div className="flex items-center justify-between mb-1 text-[11px]">
            <span className="text-muted-foreground font-medium">
              Extracted Inbound Document Text (used for requirement parsing):
            </span>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground underline"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-emerald-500" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <pre className="rounded bg-muted/60 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap max-h-48 overflow-y-auto border border-border/40 select-text">
            {att.extractedText}
          </pre>
        </div>
      )}
    </div>
  );
}

function FormatIcon({ kind }: { kind: DocumentFormatKind }) {
  switch (kind) {
    case "pdf":
      return (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/25">
          <FilePdf className="h-4 w-4" />
        </div>
      );
    case "word":
      return (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/25">
          <FileText className="h-4 w-4" />
        </div>
      );
    case "excel":
      return (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
          <Table className="h-4 w-4" />
        </div>
      );
    case "text":
      return (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25">
          <FileText className="h-4 w-4" />
        </div>
      );
    default:
      return (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground border border-border">
          <Paperclip className="h-4 w-4" />
        </div>
      );
  }
}

function FormatBadge({ kind }: { kind: DocumentFormatKind }) {
  switch (kind) {
    case "pdf":
      return (
        <Badge variant="danger" className="text-[9px] py-0 px-1 font-semibold uppercase tracking-wider">
          PDF
        </Badge>
      );
    case "word":
      return (
        <Badge variant="primary" className="text-[9px] py-0 px-1 font-semibold uppercase tracking-wider">
          Word
        </Badge>
      );
    case "excel":
      return (
        <Badge variant="success" className="text-[9px] py-0 px-1 font-semibold uppercase tracking-wider">
          Excel
        </Badge>
      );
    case "text":
      return (
        <Badge variant="warning" className="text-[9px] py-0 px-1 font-semibold uppercase tracking-wider">
          Text
        </Badge>
      );
    default:
      return (
        <Badge variant="neutral" className="text-[9px] py-0 px-1 font-semibold uppercase tracking-wider">
          File
        </Badge>
      );
  }
}
