import * as React from "react";
import type { ThreadStatus } from "@/types/domain";
import { cn } from "@/lib/utils";

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: ThreadStatus;
}

const statusColorMap: Record<ThreadStatus, string> = {
  received: "bg-info",
  extracting: "bg-info",
  awaiting_reply: "bg-warning",
  pricing: "bg-primary",
  document_generation: "bg-primary",
  sending: "bg-primary",
  completed: "bg-success",
  failed: "bg-danger",
  unsupported: "bg-neutral-soft-foreground",
};

const activePulseStatuses = new Set<ThreadStatus>([
  "pricing",
  "document_generation",
  "sending",
]);

const StatusDot = React.forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ status, className, ...props }, ref) => {
    const isPulsing = activePulseStatuses.has(status);
    const colorClass = statusColorMap[status] ?? "bg-muted-foreground";

    if (isPulsing) {
      return (
        <span
          ref={ref}
          className={cn("relative inline-flex h-2 w-2 items-center justify-center", className)}
          aria-hidden="true"
          {...props}
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
      );
    }

    return (
      <span
        ref={ref}
        className={cn("inline-block h-2 w-2 shrink-0 rounded-full", colorClass, className)}
        aria-hidden="true"
        {...props}
      />
    );
  }
);

StatusDot.displayName = "StatusDot";

export { StatusDot };
