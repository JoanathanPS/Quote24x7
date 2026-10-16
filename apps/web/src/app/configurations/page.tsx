"use client";

import * as React from "react";
import Link from "next/link";
import {
  Receipt,
  MagnifyingGlass,
  Eye,
  CaretDown,
  CaretUp,
  SlidersHorizontal,
  FilePdf,
} from "@phosphor-icons/react";

import { useQuotes } from "@/hooks/use-api";
import { formatMoney } from "@/server/pricing/money";
import type { QuoteStatus } from "@/types/domain";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/data-table";

function getStatusBadge(status: QuoteStatus): {
  label: string;
  variant: "default" | "primary" | "success" | "warning" | "danger" | "info" | "neutral";
} {
  switch (status) {
    case "validated":
      return { label: "Validated", variant: "success" };
    case "estimate":
      return { label: "Estimate", variant: "info" };
    case "sent":
      return { label: "Sent to Buyer", variant: "success" };
    case "delivery_failed":
      return { label: "Delivery Failed", variant: "danger" };
    case "superseded":
      return { label: "Superseded", variant: "neutral" };
    default:
      return { label: status, variant: "default" };
  }
}

export default function ConfigurationsPage() {
  const { data: quotes, isLoading, error } = useQuotes();
  const [search, setSearch] = React.useState("");
  const [expandedQuoteId, setExpandedQuoteId] = React.useState<string | null>(null);

  const filteredQuotes = React.useMemo(() => {
    if (!quotes) return [];
    if (!search.trim()) return quotes;
    const q = search.toLowerCase();
    return quotes.filter((quote) => {
      const matchId = quote.id.toLowerCase().includes(q);
      const matchThread = quote.threadId.toLowerCase().includes(q);
      const matchPlan = quote.options.some((opt) =>
        opt.planName.toLowerCase().includes(q)
      );
      return matchId || matchThread || matchPlan;
    });
  }, [quotes, search]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 pb-12">
        <div className="space-y-1">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl pb-12">
        <EmptyState
          icon={Receipt}
          title="Could not load configurations"
          description="Failed to fetch generated custom configurations from the session store."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-6 w-6 text-primary" weight="duotone" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Custom Configurations &amp; Proposals
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Bespoke monitoring architectures, itemized line items, and calculated subscription proposals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">
            {filteredQuotes.length} {filteredQuotes.length === 1 ? "configuration" : "configurations"}
          </span>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="relative max-w-md">
        <MagnifyingGlass className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by configuration reference, thread, or plan name..."
          className="flex h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 py-1.5 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Configurations List */}
      {filteredQuotes.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No configurations found"
          description={
            search.trim()
              ? "No configuration matches your current filter term."
              : "No custom configurations have been generated yet. Incoming customer requests will appear here once sized."
          }
        />
      ) : (
        <div className="space-y-4">
          {filteredQuotes.map((quote) => {
            const statusInfo = getStatusBadge(quote.status);
            const bestValue =
              quote.options.find((o) => o.optionType === "best_value") ?? quote.options[0];
            const isExpanded = expandedQuoteId === quote.id;

            return (
              <Card
                key={quote.id}
                className="border-border/80 bg-surface shadow-xs transition-shadow hover:shadow-sm overflow-hidden"
              >
                <CardHeader className="p-5 pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-foreground">
                          #{quote.id}
                        </span>
                        <Badge variant={statusInfo.variant} className="text-[11px]">
                          {statusInfo.label}
                        </Badge>
                        <Badge variant="neutral" className="text-[10px] font-mono">
                          Catalogue {quote.catalogueVersion}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Linked Thread:{" "}
                          <Link
                            href={`/?thread=${quote.threadId}`}
                            className="font-mono text-primary hover:underline"
                          >
                            #{quote.threadId}
                          </Link>
                        </span>
                      </div>
                      <CardTitle className="text-base font-bold text-foreground pt-1">
                        {bestValue?.planName ?? "Custom Configuration"}
                      </CardTitle>
                      <CardDescription className="text-xs line-clamp-2">
                        {bestValue?.rankReason ?? "Optimized sizing configuration for customer requirements."}
                      </CardDescription>
                    </div>

                    <div className="text-left sm:text-right shrink-0">
                      <span className="text-xs text-muted-foreground block font-medium">
                        Quoted Total ({quote.billingPeriod})
                      </span>
                      <div className="text-xl font-bold font-mono text-foreground">
                        {bestValue ? formatMoney(bestValue.total, quote.currency) : "—"}
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {quote.options.length} {quote.options.length === 1 ? "option" : "options evaluated"}
                      </span>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-5 pt-0 space-y-4">
                  {/* Key Capacity Highlights */}
                  {bestValue?.coverage && bestValue.coverage.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/50">
                      {bestValue.coverage.map((row) => (
                        <div
                          key={row.unit}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-xs text-foreground"
                        >
                          <span className="text-muted-foreground font-medium">{row.label}:</span>
                          <span className="font-mono font-semibold">{row.total}</span>
                          {row.viaAddOns > 0 && (
                            <span className="text-[10px] text-primary">(+{row.viaAddOns} pack)</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action Buttons Row */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/40">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        asChild
                        className="h-8 gap-1.5 text-xs font-medium"
                      >
                        <Link href={`/quotes/${quote.id}`}>
                          <Eye className="h-3.5 w-3.5" />
                          <span>Internal Review</span>
                        </Link>
                      </Button>


                      <Button
                        variant="ghost"
                        size="sm"
                        asChild
                        className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Link href={`/quotes/${quote.id}/document`} target="_blank">
                          <FilePdf className="h-3.5 w-3.5" />
                          <span>PDF Document</span>
                        </Link>
                      </Button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setExpandedQuoteId(isExpanded ? null : quote.id)}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <span>{isExpanded ? "Hide line items" : "Show line items"}</span>
                      {isExpanded ? (
                        <CaretUp className="h-3.5 w-3.5" />
                      ) : (
                        <CaretDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>

                  {/* Expandable Line Items & Assumptions */}
                  {isExpanded && bestValue && (
                    <div className="pt-3 border-t border-border animate-fade-in space-y-3">
                      <div className="rounded-md border border-border overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-surface-sunken/60 text-xs">
                              <TableHead>Component / Description</TableHead>
                              <TableHead numeric className="w-[80px]">Qty</TableHead>
                              <TableHead className="w-[100px]">Unit</TableHead>
                              <TableHead numeric className="w-[120px]">Unit Rate</TableHead>
                              <TableHead numeric className="w-[130px]">Line Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {bestValue.lineItems.map((item) => (
                              <TableRow key={item.id} className="text-xs hover:bg-muted/20">
                                <TableCell className="font-medium text-foreground py-2">
                                  {item.description}
                                </TableCell>
                                <TableCell numeric className="font-mono py-2">
                                  {item.quantity}
                                </TableCell>
                                <TableCell className="text-muted-foreground py-2">
                                  {item.unit}
                                </TableCell>
                                <TableCell numeric className="font-mono text-muted-foreground py-2">
                                  {formatMoney(item.unitPrice, quote.currency)}
                                </TableCell>
                                <TableCell numeric className="font-mono font-semibold text-foreground py-2">
                                  {formatMoney(item.lineTotal, quote.currency)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>

                      {quote.assumptions.length > 0 && (
                        <div className="p-3 rounded bg-muted/30 border border-border/50 text-xs text-muted-foreground space-y-1">
                          <span className="font-semibold text-foreground block">Key Sizing Assumptions:</span>
                          <ul className="list-disc list-inside space-y-0.5">
                            {quote.assumptions.slice(0, 3).map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
