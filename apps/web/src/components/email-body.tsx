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
