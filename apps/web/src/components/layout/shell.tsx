"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";

import { cn } from "@/lib/utils";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicProposal = pathname?.startsWith("/proposals") || pathname?.startsWith("/p/");
  const isInboxPage = pathname === "/" || pathname === "";

  if (isPublicProposal) {
    return (
      <main className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </main>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden print:h-auto print:overflow-visible print:block">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden print:h-auto print:overflow-visible print:block">
        <TopBar />
        <main
          className={cn(
            "flex-1 bg-background p-4 md:p-6 print:p-0 print:m-0 print:bg-white print:overflow-visible print:block",
            isInboxPage ? "overflow-hidden flex flex-col" : "overflow-y-auto"
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
