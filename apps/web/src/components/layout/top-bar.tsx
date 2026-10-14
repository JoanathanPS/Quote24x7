"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import {
  List,
  Sun,
  Moon,
  SunHorizon,
  CaretRight,
} from "@phosphor-icons/react";

import { useSystemHealth } from "@/hooks/use-api";
import { useUIStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

interface BreadcrumbItem {
  label: string;
  href: string;
}

function getBreadcrumbs(pathname: string): BreadcrumbItem[] {
  if (!pathname || pathname === "/") {
    return [{ label: "Inbox", href: "/" }];
  }

  const segments = pathname.split("/").filter(Boolean);
  const crumbs: BreadcrumbItem[] = [];

  let accumulatedPath = "";
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;

    accumulatedPath += `/${segment}`;

    let label = segment;
    if (i === 0) {
      switch (segment) {
        case "threads":
          label = "Threads";
          break;
        case "quotes":
          label = "Quotes";
          break;
        case "catalogue":
          label = "Catalogue";
          break;
        case "deliveries":
          label = "Deliveries";
          break;
        case "health":
          label = "Health";
          break;
        case "settings":
          label = "Settings";
          break;
        default:
          label = segment.charAt(0).toUpperCase() + segment.slice(1);
      }
    } else {
      // Clean up UUIDs or long IDs for display
      label = segment.length > 18 ? `${segment.slice(0, 8)}…${segment.slice(-6)}` : segment;
    }

    crumbs.push({ label, href: accumulatedPath });
  }

  return crumbs;
}

export function TopBar() {
  const pathname = usePathname();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const { data: health } = useSystemHealth();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const breadcrumbs = getBreadcrumbs(pathname);

  const cycleTheme = () => {
    if (theme === "light") {
      setTheme("dark");
    } else if (theme === "dark") {
      setTheme("system");
    } else {
      setTheme("light");
    }
  };

  const healthLevel = health?.overall ?? "unknown";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 print-hidden">
      {/* Left section: Mobile toggle + Breadcrumb */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Mobile menu toggle button */}
        <button
          type="button"
          onClick={toggleSidebar}
          className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:hidden"
          aria-label="Toggle navigation menu"
        >
          <List className="h-5 w-5" />
        </button>

        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm min-w-0">
          <span className="text-subtle-foreground font-medium hidden sm:inline">
            Quote24x7
          </span>
          <CaretRight className="h-3 w-3 text-subtle-foreground shrink-0 hidden sm:inline" />

          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;

            return (
              <div key={crumb.href} className="flex items-center gap-1.5 min-w-0">
                {idx > 0 && (
                  <CaretRight className="h-3 w-3 text-subtle-foreground shrink-0" />
                )}
                {isLast ? (
                  <span className="font-medium text-foreground truncate max-w-[160px] sm:max-w-xs">
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[120px]"
                  >
                    {crumb.label}
                  </Link>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {/* Right section: System Status + Theme Toggle */}
      <div className="flex items-center gap-2.5">
        {/* System status indicator */}
        <Link
          href="/health"
          className="flex items-center gap-2 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={`System Health: ${healthLevel}`}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full shrink-0",
              healthLevel === "ok" && "bg-success",
              healthLevel === "degraded" && "bg-warning animate-pulse",
              healthLevel === "down" && "bg-danger",
              healthLevel === "unknown" && "bg-subtle-foreground"
            )}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">
            {healthLevel === "ok"
              ? "Operational"
              : healthLevel === "degraded"
              ? "Degraded"
              : healthLevel === "down"
              ? "Disruption"
              : "Checking"}
          </span>
        </Link>

        {/* Theme Toggle Button */}
        <button
          type="button"
          onClick={cycleTheme}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          title={
            mounted
              ? `Theme: ${theme ?? "system"} (click to cycle)`
              : "Toggle theme"
          }
          aria-label="Cycle theme: light, dark, system"
        >
          {mounted ? (
            theme === "dark" ? (
              <Moon className="h-4 w-4" weight="bold" />
            ) : theme === "light" ? (
              <Sun className="h-4 w-4" weight="bold" />
            ) : (
              <SunHorizon className="h-4 w-4" weight="bold" />
            )
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </button>
      </div>
    </header>
  );
}
