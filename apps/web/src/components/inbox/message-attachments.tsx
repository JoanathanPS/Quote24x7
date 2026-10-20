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
  FileDoc,
  Image as ImageIcon,
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
  if (
    name.endsWith(".docx") ||
    name.endsWith(".doc") ||
    ct.includes("word") ||
    ct.includes("officedocument.wordprocessingml")
  ) {
    return "word";
  }
  if (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    ct.includes("spreadsheet") ||
    ct.includes("excel")
  ) {
    return "excel";
  }
  if (name.endsWith(".csv") || ct.includes("csv")) return "csv";
  if (
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".webp") ||
    ct.startsWith("image/")
  ) {
    return "image";
  }
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

  const handleDownload = () => {
    if (!att.contentBase64 && !att.extractedText) return;

    try {
      let url: string;
      if (att.contentBase64) {
        url = `data:${att.contentType || "application/octet-stream"};base64,${att.contentBase64}`;
      } else {
        const blob = new Blob([att.extractedText || ""], { type: "text/plain;charset=utf-8" });
        url = URL.createObjectURL(blob);
      }

      const a = document.createElement("a");
      a.href = url;
      a.download = att.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      if (!att.contentBase64) {
        URL.revokeObjectURL(url);
      }
    } catch {
      // ignore download failure
    }
  };

  const renderIcon = () => {
    switch (kind) {
      case "pdf":
        return <FilePdf className="h-4 w-4 text-red-500" />;
      case "word":
        return <FileDoc className="h-4 w-4 text-blue-500" />;
      case "excel":
      case "csv":
        return <Table className="h-4 w-4 text-emerald-600" />;
      case "image":
        return <ImageIcon className="h-4 w-4 text-indigo-500" />;
      default:
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const formatBadgeVariant = () => {
    switch (kind) {
      case "pdf":
        return "danger" as const;
      case "word":
        return "primary" as const;
      case "excel":
      case "csv":
        return "success" as const;
      case "image":
        return "info" as const;
      default:
        return "neutral" as const;
    }
  };

  const sizeKb = (att.sizeBytes / 1024).toFixed(1);
  const hasExtractedText = Boolean(att.extractedText && att.extractedText.trim().length > 0);
  const lineCount = att.extractedText ? att.extractedText.split("\n").length : 0;

  return (
    <div className="rounded-lg border border-border/70 bg-surface shadow-xs transition-colors hover:border-border">
      <div className="flex items-center justify-between p-2.5 gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-md bg-surface-sunken border border-border/50">
            {renderIcon()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-foreground truncate max-w-[240px]">
                {att.name}
              </span>
              <Badge variant={formatBadgeVariant()} className="text-[10px] uppercase font-mono px-1.5 py-0 h-4">
                {kind}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {sizeKb} KB
              {hasExtractedText && ` • ${lineCount} line${lineCount === 1 ? "" : "s"} extracted`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {(att.contentBase64 || hasExtractedText) && (
            <button
              type="button"
              onClick={handleDownload}
              title="Download attachment"
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-sunken"
            >
              <DownloadSimple className="h-3.5 w-3.5" />
            </button>
          )}

          {hasExtractedText && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline px-1.5 py-0.5 rounded select-none"
            >
              {expanded ? (
                <>
                  <CaretUp className="h-3 w-3" />
                  Hide Extracted
                </>
              ) : (
                <>
                  <CaretDown className="h-3 w-3" />
                  View Text
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {expanded && hasExtractedText && (
        <div className="border-t border-border/50 bg-surface-sunken/40 p-2.5 text-xs">
          <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-border/40">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Extracted Specification Content
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-emerald-600" />
                  <span className="text-emerald-600 font-medium">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <pre className="font-mono text-[11px] text-foreground/90 whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed p-2 rounded bg-surface border border-border/40">
            {att.extractedText}
          </pre>
        </div>
      )}
    </div>
  );
}
