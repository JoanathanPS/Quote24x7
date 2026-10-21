import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "full" | "icon" | "image";
  size?: "sm" | "md" | "lg" | "xl";
  showText?: boolean;
}

/**
 * Quote24x7 Brand Logo
 * Recreates the exact brand identity: Cloud outline + radar target with dark navy sector,
 * alongside "Quote" (vibrant blue) and "24x7" (navy / adaptive white in dark mode).
 */
export function Quote24x7Logo({
  variant = "full",
  size = "md",
  showText = true,
  className,
  ...props
}: LogoProps) {
  const sizeMap = {
    sm: "h-6 text-sm",
    md: "h-8 text-base",
    lg: "h-10 text-xl",
    xl: "h-12 text-2xl",
  };

  const iconSizeMap = {
    sm: 24,
    md: 32,
    lg: 40,
    xl: 48,
  };

  if (variant === "image") {
    return (
      <div className={cn("inline-flex items-center", className)} {...props}>
        <Image
          src="/logo.png"
          alt="Quote24x7"
          width={iconSizeMap[size] * 3.5}
          height={iconSizeMap[size]}
          className={cn("h-auto object-contain", sizeMap[size])}
          priority
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 select-none font-bold tracking-tight",
        sizeMap[size],
        className
      )}
      {...props}
    >
      {/* Brand Icon: Cloud + Radar Target */}
      <svg
        viewBox="0 0 100 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-auto shrink-0 aspect-[5/4]"
      >
        {/* Cloud lower base contour */}
        <path
          d="M22 68H78C86 68 93 61.5 93 53.5C93 46 87 39.8 79.5 39.2C78.5 23 65 11 48.5 11C35.5 11 24.5 19 19.5 30.5C12 32.5 6 39.5 6 48C6 57.5 12.5 68 22 68Z"
          stroke="#006fe6"
          strokeWidth="6.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Radar concentric outer circle */}
        <circle
          cx="48.5"
          cy="42"
          r="25"
          stroke="#006fe6"
          strokeWidth="5.5"
        />

        {/* Radar concentric inner circle */}
        <circle
          cx="48.5"
          cy="42"
          r="14.5"
          stroke="#006fe6"
          strokeWidth="4.5"
        />

        {/* Center bullseye dot */}
        <circle
          cx="48.5"
          cy="42"
          r="4.5"
          fill="#006fe6"
        />

        {/* Radar sweep / dark navy wedge in upper right quadrant */}
        <path
          d="M48.5 42L66 24.5C70.2 28.5 73 34 73.5 40.5L48.5 42Z"
          fill="#0b2e68"
        />
      </svg>

      {/* Typography: "Quote" (Site24x7 blue) + "24x7" (Site24x7 navy in light, bright in dark) */}
      {showText && variant !== "icon" && (
        <span className="flex items-baseline font-black tracking-tight leading-none text-base sm:text-lg">
          <span className="text-[#006fe6]">Quote</span>
          <span className="text-[#0b2e68] dark:text-foreground">24x7</span>
        </span>
      )}
    </div>
  );
}
