import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors border border-transparent",
  {
    variants: {
      variant: {
        default: "bg-neutral-soft text-neutral-soft-foreground border-border/40",
        primary: "bg-primary-soft text-primary-soft-foreground border-primary/20",
        success: "bg-success-soft text-success-soft-foreground border-success/20",
        warning: "bg-warning-soft text-warning-soft-foreground border-warning/20",
        danger: "bg-danger-soft text-danger-soft-foreground border-danger/20",
        info: "bg-info-soft text-info-soft-foreground border-info/20",
        neutral: "bg-neutral-soft text-neutral-soft-foreground border-border/50",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(badgeVariants({ variant }), className)}
        {...props}
      />
    );
  }
);

Badge.displayName = "Badge";

export { Badge, badgeVariants };
