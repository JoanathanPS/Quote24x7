"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Tray,
  Receipt,
  Database,
  PaperPlaneTilt,
  Heartbeat,
  GearSix,
  X,
  BookOpen,
  ChartBar,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

import { useUIStore } from "@/stores/ui-store";
import { Quote24x7Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

interface NavItem {
  name: string;
  href: string;
  icon: PhosphorIcon;
  isActive: (pathname: string) => boolean;
}

const PRIMARY_NAV_ITEMS: NavItem[] = [
  {
    name: "Inbox",
    href: "/",
    icon: Tray,
    isActive: (pathname) => pathname === "/" || pathname.startsWith("/threads"),
  },
  {
    name: "Quotes",
    href: "/quotes",
    icon: Receipt,
    isActive: (pathname) => pathname.startsWith("/quotes") || pathname.startsWith("/configurations"),
  },
  {
    name: "Catalogue",
    href: "/catalogue",
    icon: Database,
    isActive: (pathname) => pathname.startsWith("/catalogue"),
  },
  {
    name: "Knowledge",
    href: "/knowledge",
    icon: BookOpen,
    isActive: (pathname) => pathname.startsWith("/knowledge"),
  },
  {
    name: "Benchmark",
    href: "/benchmark",
    icon: ChartBar,
    isActive: (pathname) => pathname.startsWith("/benchmark"),
  },
];

const SECONDARY_NAV_ITEMS: NavItem[] = [
  {
    name: "Deliveries",
    href: "/deliveries",
    icon: PaperPlaneTilt,
    isActive: (pathname) => pathname.startsWith("/deliveries"),
  },
  {
    name: "Health",
    href: "/health",
    icon: Heartbeat,
    isActive: (pathname) => pathname.startsWith("/health"),
  },
  {
    name: "Settings",
    href: "/settings",
    icon: GearSix,
    isActive: (pathname) => pathname.startsWith("/settings"),
  },
];

interface SidebarContentProps {
  onItemClick?: () => void;
  isMobile?: boolean;
}

function SidebarContent({ onItemClick, isMobile }: SidebarContentProps) {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-full flex-col justify-between">
      {/* Top section: Wordmark + Navigation */}
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              onClick={onItemClick}
              className="flex items-center transition-opacity hover:opacity-90 py-1"
            >
              <Quote24x7Logo size="md" />
            </Link>
          </div>
          {isMobile && (
            <button
              type="button"
              onClick={onItemClick}
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="Close sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Navigation list */}
        <nav aria-label="Main Navigation" className="space-y-1 p-3">
          {PRIMARY_NAV_ITEMS.map((item) => {
            const active = item.isActive(pathname);
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={onItemClick}
                data-active={active}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary-soft text-primary-soft-foreground font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon
                  weight={active ? "bold" : "regular"}
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    active
                      ? "text-primary"
                      : "text-subtle-foreground group-hover:text-foreground"
                  )}
                />
                <span>{item.name}</span>
              </Link>
            );
          })}

          <div className="pt-3 pb-1">
            <div className="px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Operations &amp; Diagnostics
            </div>
          </div>

          {SECONDARY_NAV_ITEMS.map((item) => {
            const active = item.isActive(pathname);
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={onItemClick}
                data-active={active}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-muted text-foreground font-semibold"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <Icon
                  weight={active ? "bold" : "regular"}
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 transition-colors",
                    active
                      ? "text-foreground"
                      : "text-subtle-foreground group-hover:text-foreground"
                  )}
                />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  // Close mobile sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);

  // Ensure sidebar is closed on small screens on initial mount
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, [setSidebarOpen]);

  return (
    <>
      {/* Desktop persistent sidebar (~240px wide) */}
      <aside className="hidden md:flex md:w-60 md:shrink-0 md:flex-col border-r border-border bg-surface h-full print-hidden">
        <SidebarContent />
      </aside>

      {/* Mobile slide-in overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-overlay"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />

            {/* Slide-in drawer */}
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="relative flex h-full w-64 max-w-[80vw] flex-col border-r border-border bg-surface shadow-lg"
            >
              <SidebarContent onItemClick={() => setSidebarOpen(false)} isMobile />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
