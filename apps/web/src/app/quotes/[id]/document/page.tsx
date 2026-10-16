"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Printer,
  ArrowLeft,
  CheckCircle,
  FilePdf,
  DownloadSimple,
  Buildings,
  User,
  EnvelopeSimple,
  Calendar,
  ShieldCheck,
  ArrowSquareOut,
  Info,
  Check,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";

import { useQuote, useThread } from "@/hooks/use-api";
import { formatMoney } from "@/server/pricing/money";
import { formatDateTime, cn } from "@/lib/utils";
import type { OptionType, QuoteOption } from "@/types/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

function formatOptionLabel(type: OptionType): string {
  switch (type) {
    case "best_value":
      return "Best Value";
    case "lowest_cost":
      return "Lowest Cost";
    case "best_coverage":
      return "Best Coverage";
    default:
      return type;
  }
}

function getOptionBadgeVariant(type: OptionType): "primary" | "info" | "warning" | "default" {
  switch (type) {
    case "best_value":
      return "primary";
    case "lowest_cost":
      return "info";
    case "best_coverage":
      return "warning";
    default:
      return "default";
  }
}

export default function QuoteDocumentPage() {
  const params = useParams();
  const rawId = params?.id;
  const id: string = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? (rawId[0] ?? "") : "";

  const { data: quote, isLoading: isQuoteLoading, error: quoteError } = useQuote(id);
  const { data: thread, isLoading: isThreadLoading } = useThread(quote?.threadId ?? "");

  // Active option selection for proposal display and print
  const [selectedOptionType, setSelectedOptionType] = useState<OptionType>("best_value");

  // Determine active option record
  const selectedOption: QuoteOption | undefined = useMemo(() => {
    if (!quote?.options || quote.options.length === 0) return undefined;
    return (
      quote.options.find((opt) => opt.optionType === selectedOptionType) ??
      quote.options.find((opt) => opt.optionType === "best_value") ??
      quote.options[0]
    );
  }, [quote?.options, selectedOptionType]);

  const handlePrint = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (isQuoteLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 py-8">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="space-y-4 rounded-lg border border-border bg-surface p-10">
          <div className="flex justify-between">
            <Skeleton className="h-10 w-44" />
            <Skeleton className="h-10 w-36" />
          </div>
          <Skeleton className="h-20 w-full" />
          <div className="grid grid-cols-3 gap-6 pt-6">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------
  if (quoteError || !quote) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
          <WarningCircle size={28} />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Quote Not Found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {quoteError ? quoteError.message : `No quotation document found with reference ID "${id}".`}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild variant="outline">
            <Link href="/quotes">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Quotes
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const currentOption = selectedOption ?? quote.options[0];
  const billingPeriodLabel = quote.billingPeriod === "annual" ? "Annually" : "Monthly";
  const billingPeriodPerLabel = quote.billingPeriod === "annual" ? "/year" : "/month";

  return (
    <div className="pb-16">
      {/* ---------------------------------------------------------------------
          Screen Toolbar (Hidden in print)
      --------------------------------------------------------------------- */}
      <section
        aria-label="Document Controls"
        className="print-hidden sticky top-0 z-30 -mt-4 mb-6 -mx-4 md:-mt-6 md:-mx-6 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur md:px-8 shadow-xs"
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
          {/* Left: Back button & Breadcrumb indicator */}
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
              <Link href={`/quotes/${quote.id}`}>
                <ArrowLeft size={16} />
                <span>Back to Quote Overview</span>
              </Link>
            </Button>
            <span className="hidden text-xs text-subtle-foreground sm:inline">•</span>
            <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
              Ref: {quote.id}
            </span>
          </div>

          {/* Center: Option Switcher */}
          {quote.options && quote.options.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Proposal Option:</span>
              <Tabs
                value={currentOption?.optionType ?? "best_value"}
                onValueChange={(val) => setSelectedOptionType(val as OptionType)}
              >
                <TabsList className="h-8 p-0.5">
                  {quote.options.map((opt) => (
                    <TabsTrigger
                      key={opt.id}
                      value={opt.optionType}
                      className="px-2.5 py-1 text-xs data-[state=active]:font-semibold"
                    >
                      {formatOptionLabel(opt.optionType)}
                      <span className="ml-1.5 text-[10px] opacity-75 tabular">
                        ({formatMoney(opt.total, quote.currency, { compact: true, showDecimals: false })})
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          )}

          {/* Right: Status notice & Print action */}
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground lg:flex">
              <CheckCircle size={14} className="text-success" weight="fill" />
              <span>Ready to Print (A4 formatted)</span>
            </div>

            <Button
              asChild
              variant="outline"
              size="sm"
              className="hidden gap-1.5 font-medium sm:flex"
            >
              <a
                href={`/api/v1/quotes/${quote.id}/pdf?option=${selectedOptionType}&download=true`}
                download={`quote-${quote.id.toLowerCase()}-${selectedOptionType}.pdf`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <DownloadSimple size={15} />
                <span>Download PDF</span>
              </a>
            </Button>

            <Button
              onClick={handlePrint}
              size="sm"
              className="gap-2 shadow-sm font-medium"
            >
              <Printer size={16} weight="bold" />
              <FilePdf size={16} />
              <span>Print to PDF</span>
            </Button>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------------
          Printable Document Sheet (A4 Proportionate)
      --------------------------------------------------------------------- */}
      <article
        aria-label="Formal Quotation Document"
        className="print-sheet mx-auto max-w-4xl rounded-lg border border-border bg-surface p-8 shadow-md transition-shadow md:p-12 text-foreground print:p-0 print:border-none print:shadow-none print:bg-white print:text-black"
      >
        {/* -------------------------------------------------------------------
            1. Header Section
        ------------------------------------------------------------------- */}
        <header className="border-b border-border pb-8 print:border-neutral-300 print-avoid-break">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            {/* Wordmark and Document Title */}
            <div>
              <div className="flex items-baseline gap-2">
                <span className="font-sans text-2xl font-bold tracking-tight text-foreground print:text-black">
                  Quote<span className="text-primary font-black print:text-neutral-900">24x7</span>
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground print:text-neutral-600">
                  Commercial Proposal
                </span>
              </div>
              <h1 className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl print:text-black">
                Infrastructure Monitoring Quotation
              </h1>
              <p className="mt-1 text-xs text-muted-foreground print:text-neutral-600">
                Pricing quotation calculated from Site24x7 catalogue (v{quote.catalogueVersion})
              </p>
            </div>

            {/* Quote Reference & Metadata */}
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold uppercase text-muted-foreground print:text-neutral-700">
                  Quote Ref:
                </span>
                <span className="font-mono text-sm font-bold text-foreground print:text-black">
                  #{quote.id}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground print:text-neutral-700">
                <Calendar size={13} />
                <span>Issue Date: {formatDateTime(quote.createdAt)}</span>
              </div>
              <div className="mt-1">
                <Badge variant="warning" className="text-[11px] font-medium print:border-neutral-400 print:text-neutral-800">
                  Estimate — Non-binding
                </Badge>
              </div>
            </div>
          </div>

          {/* Legal Notice Callout */}
          <div className="mt-6 rounded-md border border-border bg-muted/30 p-3.5 text-xs text-muted-foreground print:border-neutral-300 print:bg-neutral-50 print:text-neutral-800 print-avoid-break">
            <div className="flex items-start gap-2.5">
              <Info size={16} className="mt-0.5 shrink-0 text-primary print:text-neutral-700" weight="bold" />
              <div className="leading-relaxed">
                <span className="font-semibold text-foreground print:text-black">QUOTATION (Catalogue v{quote.catalogueVersion}):</span> This quotation is calculated by Quote24x7 based on requested infrastructure quantities and active catalogue rates.
              </div>
            </div>
          </div>
        </header>

        {/* -------------------------------------------------------------------
            2. Party Information Grid
        ------------------------------------------------------------------- */}
        <section aria-label="Parties and Terms" className="border-b border-border py-6 print:border-neutral-300 print-avoid-break">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {/* Prepared For (Customer) */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground print:text-neutral-600">
                <User size={14} />
                <span>Prepared For</span>
              </div>
              <div className="text-sm font-bold text-foreground print:text-black">
                {thread?.senderName || (isThreadLoading ? "Loading..." : "Valued Customer")}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground print:text-neutral-700">
                <Buildings size={13} className="shrink-0" />
                <span className="font-medium">{thread?.organisation || "Client Organisation"}</span>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground print:text-neutral-700 truncate">
                <EnvelopeSimple size={13} className="shrink-0" />
                <span className="truncate">{thread?.senderEmail || "Customer Contact"}</span>
              </div>
            </div>

            {/* Prepared By (System Provenance) */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground print:text-neutral-600">
                <ShieldCheck size={14} />
                <span>Prepared By</span>
              </div>
              <div className="text-sm font-bold text-foreground print:text-black">
                Quote24x7 Pricing Engine
              </div>
              <div className="text-xs text-muted-foreground print:text-neutral-700">
                Calculation Engine: <span className="font-mono font-medium">{quote.calculationVersion}</span>
              </div>
              <div className="text-xs text-muted-foreground print:text-neutral-700">
                Catalogue Version: <span className="font-mono font-medium">{quote.catalogueVersion}</span>
              </div>
            </div>

            {/* Commercial Terms */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground print:text-neutral-600">
                <Sparkle size={14} />
                <span>Commercial Terms</span>
              </div>
              <div className="text-xs text-muted-foreground print:text-neutral-700">
                Billing Cycle: <span className="font-bold text-foreground print:text-black">{billingPeriodLabel}</span>
              </div>
              <div className="text-xs text-muted-foreground print:text-neutral-700">
                Billing Currency: <span className="font-bold text-foreground print:text-black">{quote.currency}</span>
              </div>
              <div className="text-xs text-muted-foreground print:text-neutral-700">
                Market Region: <span className="font-bold text-foreground print:text-black">{quote.market === "IN" ? "India (IN)" : quote.market}</span>
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------------
            3. Executive Summary / Proposal Narrative
        ------------------------------------------------------------------- */}
        {currentOption && (
          <section aria-label="Executive Summary" className="border-b border-border py-6 print:border-neutral-300 print-avoid-break">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground print:text-neutral-700">
              Executive Summary & Recommended Configuration
            </h2>
            <div className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/90 print:text-neutral-900">
              <p>
                Based on your stated infrastructure requirements, this proposal details the{" "}
                <strong className="font-semibold text-foreground print:text-black">{currentOption.planName}</strong> plan,
                configured as the{" "}
                <span className="font-semibold text-primary print:text-black">
                  {formatOptionLabel(currentOption.optionType)}
                </span>{" "}
                recommendation for your workload.
              </p>
              <p className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground print:border-neutral-200 print:bg-neutral-50 print:text-neutral-800">
                <span className="font-semibold text-foreground print:text-black">Engine Selection Rationale: </span>
                {currentOption.rankReason}
              </p>
              {currentOption.headroomNotes && currentOption.headroomNotes.length > 0 && (
                <div className="text-xs text-muted-foreground print:text-neutral-700">
                  <span className="font-semibold text-foreground print:text-black">Capacity Headroom: </span>
                  {currentOption.headroomNotes.join("; ")}
                </div>
              )}
            </div>
          </section>
        )}

        {/* -------------------------------------------------------------------
            4. Three Options Comparison Summary Table
        ------------------------------------------------------------------- */}
        {quote.options && quote.options.length > 0 && (
          <section aria-label="Options Comparison" className="border-b border-border py-6 print:border-neutral-300 print-avoid-break">
            <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-baseline">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground print:text-neutral-700">
                Comparison of Sizing Options
              </h2>
              <span className="text-xs text-subtle-foreground print:text-neutral-500">
                Three deterministic configurations evaluated by pricing engine
              </span>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 font-semibold text-muted-foreground print:border-neutral-300 print:bg-neutral-100 print:text-black">
                    <th className="py-2.5 px-3">Option Tier</th>
                    <th className="py-2.5 px-3">Base Plan</th>
                    <th className="py-2.5 px-3">Sizing & Headroom Highlights</th>
                    <th className="py-2.5 px-3 text-right">Quoted Total ({quote.currency})</th>
                    <th className="py-2.5 px-3 text-center print:hidden">Document Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border print:divide-neutral-200">
                  {quote.options.map((opt) => {
                    const isSelected = opt.optionType === currentOption?.optionType;
                    return (
                      <tr
                        key={opt.id}
                        onClick={() => setSelectedOptionType(opt.optionType)}
                        className={cn(
                          "transition-colors cursor-pointer print:cursor-default",
                          isSelected
                            ? "bg-primary-soft/30 font-medium print:bg-neutral-100"
                            : "hover:bg-muted/30"
                        )}
                      >
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5">
                            <Badge variant={getOptionBadgeVariant(opt.optionType)} className="text-[10px]">
                              {formatOptionLabel(opt.optionType)}
                            </Badge>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-foreground print:text-black">
                          {opt.planName}
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground print:text-neutral-700 max-w-xs truncate">
                          {opt.headroomNotes?.[0] || opt.rankReason}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold tabular text-foreground print:text-black">
                          {formatMoney(opt.total, quote.currency)}
                          <span className="text-[10px] font-normal text-muted-foreground print:text-neutral-600">
                            {billingPeriodPerLabel}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center print:hidden">
                          {isSelected ? (
                            <span className="inline-flex items-center gap-1 rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-primary-soft-foreground">
                              <Check size={12} weight="bold" />
                              Selected in View
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOptionType(opt.optionType);
                              }}
                              className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                            >
                              Switch to this
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* -------------------------------------------------------------------
            5. Selected Option Itemized Breakdown Table
        ------------------------------------------------------------------- */}
        {currentOption && (
          <section aria-label="Itemized Breakdown" className="border-b border-border py-6 print:border-neutral-300 print-avoid-break">
            <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-baseline">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground print:text-neutral-700">
                  Itemized Commercial Breakdown
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground print:text-neutral-600">
                  Selected Plan:{" "}
                  <strong className="text-foreground print:text-black">{currentOption.planName}</strong> (
                  {formatOptionLabel(currentOption.optionType)}) — Billed {billingPeriodLabel}
                </p>
              </div>
              <span className="font-mono text-xs text-subtle-foreground print:text-neutral-500">
                All amounts in {quote.currency}
              </span>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 font-semibold text-muted-foreground print:border-neutral-300 print:bg-neutral-100 print:text-black">
                    <th className="py-2.5 px-3">Description</th>
                    <th className="py-2.5 px-3 text-center">Quantity</th>
                    <th className="py-2.5 px-3 text-center">Unit Sizing</th>
                    <th className="py-2.5 px-3 text-right">Unit Price</th>
                    <th className="py-2.5 px-3 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border print:divide-neutral-200">
                  {currentOption.lineItems.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/20">
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-foreground print:text-black">
                          {item.description}
                        </div>
                        {item.includedQuantity != null && item.includedQuantity > 0 && (
                          <div className="text-[10px] text-muted-foreground print:text-neutral-600">
                            Base entitlement: {item.includedQuantity.toLocaleString("en-IN")} units included
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center tabular font-medium text-foreground print:text-black">
                        {item.quantity.toLocaleString("en-IN")}
                      </td>
                      <td className="py-2.5 px-3 text-center text-muted-foreground print:text-neutral-700">
                        {item.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular text-muted-foreground print:text-neutral-700">
                        {formatMoney(item.unitPrice, quote.currency)}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular font-semibold text-foreground print:text-black">
                        {formatMoney(item.lineTotal, quote.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {/* Subtotal */}
                  <tr className="border-t border-border font-medium text-muted-foreground print:border-neutral-300 print:text-neutral-800">
                    <td colSpan={3} />
                    <td className="py-2 px-3 text-right">Subtotal:</td>
                    <td className="py-2 px-3 text-right tabular font-bold text-foreground print:text-black">
                      {formatMoney(currentOption.subtotal, quote.currency)}
                    </td>
                  </tr>

                  {/* Taxes */}
                  <tr className="text-muted-foreground print:text-neutral-700">
                    <td colSpan={2} />
                    <td colSpan={2} className="py-1.5 px-3 text-right text-[11px]">
                      Estimated Taxes:
                    </td>
                    <td className="py-1.5 px-3 text-right text-[11px] italic">
                      {currentOption.taxTotal != null
                        ? formatMoney(currentOption.taxTotal, quote.currency)
                        : `Not calculated (tax treatment unverified for market ${quote.market})`}
                    </td>
                  </tr>

                  {/* Total Annual / Monthly Subscription */}
                  <tr className="border-t-2 border-border text-sm font-bold print:border-neutral-400">
                    <td colSpan={2} className="py-3 px-3 text-xs font-normal text-muted-foreground print:text-neutral-600">
                      Standard pricing. Taxes and levies applied at billing portal checkout.
                    </td>
                    <td colSpan={2} className="py-3 px-3 text-right text-base text-foreground print:text-black">
                      Total {billingPeriodLabel} Subscription:
                    </td>
                    <td className="py-3 px-3 text-right text-lg tabular text-primary print:text-black font-extrabold">
                      {formatMoney(currentOption.total, quote.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        )}

        {/* -------------------------------------------------------------------
            6. Coverage Fulfillment Table
        ------------------------------------------------------------------- */}
        {currentOption?.coverage && currentOption.coverage.length > 0 && (
          <section aria-label="Coverage Fulfillment" className="border-b border-border py-6 print:border-neutral-300 print-avoid-break">
            <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-baseline">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground print:text-neutral-700">
                Capacity & Workload Fulfillment
              </h2>
              <span className="text-xs text-subtle-foreground print:text-neutral-500">
                Demanded quantities vs. total provisioned capacity
              </span>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 font-semibold text-muted-foreground print:border-neutral-300 print:bg-neutral-100 print:text-black">
                    <th className="py-2.5 px-3">Monitored Resource</th>
                    <th className="py-2.5 px-3 text-center">Required</th>
                    <th className="py-2.5 px-3 text-center">Included in Base</th>
                    <th className="py-2.5 px-3 text-center">Via Add-on Packs</th>
                    <th className="py-2.5 px-3 text-center">Total Provisioned</th>
                    <th className="py-2.5 px-3 text-right">Fulfillment Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border print:divide-neutral-200">
                  {currentOption.coverage.map((row) => {
                    const surplus = row.total - row.required;
                    return (
                      <tr key={row.unit} className="hover:bg-muted/20">
                        <td className="py-2.5 px-3 font-medium text-foreground print:text-black">
                          {row.label}
                        </td>
                        <td className="py-2.5 px-3 text-center tabular font-medium text-foreground print:text-black">
                          {row.required.toLocaleString("en-IN")}
                        </td>
                        <td className="py-2.5 px-3 text-center tabular text-muted-foreground print:text-neutral-700">
                          {row.included.toLocaleString("en-IN")}
                        </td>
                        <td className="py-2.5 px-3 text-center tabular text-muted-foreground print:text-neutral-700">
                          {row.viaAddOns > 0 ? `+${row.viaAddOns.toLocaleString("en-IN")}` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-center tabular font-bold text-foreground print:text-black">
                          {row.total.toLocaleString("en-IN")}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {row.satisfied ? (
                            <span className="inline-flex items-center gap-1 font-medium text-success print:text-neutral-800">
                              <CheckCircle size={14} weight="fill" />
                              <span>Satisfied {surplus > 0 && `(+${surplus.toLocaleString("en-IN")})`}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-medium text-danger">
                              <WarningCircle size={14} weight="fill" />
                              <span>Gap ({Math.abs(surplus).toLocaleString("en-IN")})</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* -------------------------------------------------------------------
            7. Assumptions & Exclusions
        ------------------------------------------------------------------- */}
        <section aria-label="Assumptions and Exclusions" className="border-b border-border py-6 print:border-neutral-300 print-avoid-break">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Sizing Assumptions */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground print:text-neutral-700">
                Sizing & Calculation Assumptions
              </h3>
              <ul className="mt-2.5 space-y-1.5 text-xs text-muted-foreground print:text-neutral-800">
                {quote.assumptions && quote.assumptions.length > 0 ? (
                  quote.assumptions.map((assumption, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-primary print:text-black font-bold">•</span>
                      <span>{assumption}</span>
                    </li>
                  ))
                ) : (
                  <>
                    <li className="flex items-start gap-2">
                      <span className="text-primary print:text-black font-bold">•</span>
                      <span>Quantities sized strictly against customer requirements received via email.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-primary print:text-black font-bold">•</span>
                      <span>All add-on packs sized in whole units with unpartitioned excess capacity.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-primary print:text-black font-bold">•</span>
                      <span>Priced under standard catalogue terms for market {quote.market}.</span>
                    </li>
                  </>
                )}
              </ul>
            </div>

            {/* Commercial Exclusions */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground print:text-neutral-700">
                Commercial Exclusions & Scope Limits
              </h3>
              <ul className="mt-2.5 space-y-1.5 text-xs text-muted-foreground print:text-neutral-800">
                {quote.exclusions && quote.exclusions.length > 0 ? (
                  quote.exclusions.map((exclusion, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-danger print:text-black font-bold">•</span>
                      <span>{exclusion}</span>
                    </li>
                  ))
                ) : (
                  <>
                    <li className="flex items-start gap-2">
                      <span className="text-danger print:text-black font-bold">•</span>
                      <span>Statutory taxes, goods and service taxes (GST), and regional levies are excluded.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-danger print:text-black font-bold">•</span>
                      <span>Onboarding, custom data pipeline engineering, and migration services are excluded.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-danger print:text-black font-bold">•</span>
                      <span>Extended historical log retention beyond base catalogue limits is excluded.</span>
                    </li>
                  </>
                )}
              </ul>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------------
            8. Next Steps & Official Site24x7 Verification
        ------------------------------------------------------------------- */}
        <footer className="pt-6 space-y-6 print-avoid-break">
          {/* Verification link and next steps */}
          <div className="rounded-lg border border-border bg-muted/20 p-4 text-xs print:border-neutral-300 print:bg-neutral-50 print-avoid-break">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <div className="font-semibold text-foreground print:text-black">
                  Next Steps & Official Sizing Verification
                </div>
                <p className="mt-0.5 text-muted-foreground print:text-neutral-700">
                  To confirm exact tier capabilities, active currency pricing, or sign up for a production account:
                </p>
              </div>
              <a
                href="https://quotes.joanathan.in/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-primary hover:underline print:border-none print:p-0 print:text-black"
              >
                <span>Visit quotes.joanathan.in</span>
                <ArrowSquareOut size={13} />
              </a>
            </div>
          </div>

          {/* Audit Trail & Document Integrity */}
          <div className="flex flex-col justify-between gap-2 border-t border-border pt-4 text-[11px] text-muted-foreground sm:flex-row sm:items-center print:border-neutral-300 print:text-neutral-600 print-avoid-break">
            <div>
              <span>Generated by Quote24x7 Assistant • Engine {quote.calculationVersion} • Catalogue {quote.catalogueVersion}</span>
            </div>
            <div className="font-mono text-[10px]">
              ID: {quote.id} • Hash: {quote.catalogueVersionId.slice(0, 16)}
            </div>
          </div>

          {/* Formal Acceptance / Authorization Signature Block */}
          <div className="grid grid-cols-1 gap-6 pt-4 sm:grid-cols-2 print-avoid-break">
            <div className="rounded border border-dashed border-border p-4 print:border-neutral-300">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground print:text-neutral-600">
                Prepared by System
              </div>
              <div className="mt-6 text-xs font-semibold text-foreground print:text-black">
                Quote24x7 Automated Pricing Assistant
              </div>
              <div className="text-[10px] text-muted-foreground print:text-neutral-600">
                Sized against Site24x7 catalogue (v{quote.catalogueVersion})
              </div>
              <div className="mt-2 text-[10px] text-subtle-foreground print:text-neutral-500">
                Timestamp: {formatDateTime(quote.createdAt)}
              </div>
            </div>

            <div className="rounded border border-dashed border-border p-4 print:border-neutral-300">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground print:text-neutral-600">
                Customer Acceptance & Authorization
              </div>
              <div className="mt-8 border-b border-border print:border-neutral-400" />
              <div className="mt-2 flex justify-between text-[10px] text-muted-foreground print:text-neutral-600">
                <span>Authorized Signature</span>
                <span>Date: ____________________</span>
              </div>
            </div>
          </div>
        </footer>
      </article>
    </div>
  );
}
