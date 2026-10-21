"use client";

import * as React from "react";
import { formatEmailBody } from "@/server/email/body-format";
import { cn } from "@/lib/utils";

export interface EmailBodyProps {
  text: string;
  className?: string;
}

/**
 * Renders a stored plain-text email body as paragraphs and lists, with quoted
 * reply history folded away behind a toggle.
 */
export function EmailBody({ text, className }: EmailBodyProps) {
  const body = React.useMemo(() => formatEmailBody(text), [text]);
  const [showQuoted, setShowQuoted] = React.useState(false);

  return (
    <div className={cn("space-y-2.5 break-words", className)}>
      {body.blocks.map((block, idx) => {
        if (block.type === "paragraph") {
          return (
            <p key={idx} className="whitespace-pre-line">
              {block.text}
            </p>
          );
        }
        if (block.type === "table") {
          return (
            <div
              key={idx}
              className="my-3 overflow-x-auto rounded-lg border border-border bg-card/60 shadow-xs"
            >
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-muted-foreground font-semibold">
                    {block.headers.map((h, hIdx) => {
                      const isLast = hIdx === block.headers.length - 1;
                      const isQty = hIdx === 1 && block.headers.length === 4;
                      return (
                        <th
                          key={hIdx}
                          scope="col"
                          className={cn(
                            "px-3.5 py-2.5 font-semibold text-foreground tracking-tight",
                            isLast ? "text-right" : isQty ? "text-right sm:text-center" : "text-left"
                          )}
                        >
                          {h}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {block.rows.map((row, rIdx) => {
                    const isTotal = row[0]?.trim().toLowerCase().startsWith("total");
                    return (
                      <tr
                        key={rIdx}
                        className={cn(
                          "transition-colors",
                          isTotal
                            ? "bg-muted/40 font-semibold text-foreground"
                            : "hover:bg-muted/25"
                        )}
                      >
                        {row.map((cell, cIdx) => {
                          const isLast = cIdx === row.length - 1;
                          const isQty = cIdx === 1 && row.length === 4;
                          return (
                            <td
                              key={cIdx}
                              className={cn(
                                "px-3.5 py-2 text-xs",
                                isLast
                                  ? "text-right font-medium tabular-nums font-mono whitespace-nowrap"
                                  : isQty
                                  ? "text-right sm:text-center tabular-nums"
                                  : "text-left",
                                isTotal && isLast && "text-primary font-bold text-sm"
                              )}
                            >
                              {cell}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }
        const ListTag = block.ordered ? "ol" : "ul";
        return (
          <ListTag
            key={idx}
            className={cn("space-y-1 pl-5", block.ordered ? "list-decimal" : "list-disc")}
          >
            {block.items.map((item, itemIdx) => (
              <li key={itemIdx}>{item}</li>
            ))}
          </ListTag>
        );
      })}

      {body.quoted && (
        <div>
          <button
            type="button"
            onClick={() => setShowQuoted((v) => !v)}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {showQuoted ? "Hide quoted text" : "Show quoted text"}
          </button>
          {showQuoted && (
            <div className="mt-1.5 whitespace-pre-wrap border-l-2 border-border pl-3 text-muted-foreground">
              {body.quoted}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
