"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicProposal = pathname?.startsWith("/proposals") || pathname?.startsWith("/p/");

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
        <main className="flex-1 overflow-y-auto bg-background p-4 md:p-6 print:p-0 print:m-0 print:bg-white print:overflow-visible print:block">
          {children}
        </main>
      </div>
    </div>
  );
}
