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
          d="M20 70H80C88.2843 70 95 63.2843 95 55C95 47.1569 88.9442 40.7287 81.2407 40.0664C80.2038 23.3644 66.2731 10 49 10C35.5348 10 24.0326 18.1093 19.123 29.8033C11.1895 31.9056 5 39.2085 5 48C5 57.9411 11.7157 70 20 70Z"
          stroke="#0070ea"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Radar concentric outer circle */}
        <circle
          cx="49"
          cy="42"
          r="26"
          stroke="#0070ea"
          strokeWidth="6"
        />

        {/* Radar concentric inner circle */}
        <circle
          cx="49"
          cy="42"
          r="15"
          stroke="#0070ea"
          strokeWidth="5"
        />

        {/* Center bullseye dot */}
        <circle
          cx="49"
          cy="42"
          r="5"
          fill="#0070ea"
        />

        {/* Radar sweep / dark blue wedge in upper right quadrant */}
        <path
          d="M49 42L67 23.5C71.5 27.8 74.5 33.6 75 40L49 42Z"
          fill="#002b66"
        />
      </svg>

      {/* Typography: "Quote" (cyan-blue) + "24x7" (dark navy in light, bright in dark) */}
      {showText && variant !== "icon" && (
        <span className="flex items-baseline font-black leading-none">
          <span className="text-[#0070ea]">Quote</span>
          <span className="text-[#002b66] dark:text-foreground">24x7</span>
        </span>
      )}
    </div>
  );
}
