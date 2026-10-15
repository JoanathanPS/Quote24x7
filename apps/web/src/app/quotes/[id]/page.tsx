"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Printer,
  CheckCircle,
  XCircle,
  WarningCircle,
  ShieldCheck,
  Calculator,
  CaretDown,
  CaretUp,
  Info,
  Prohibit,
  Lightning,
  Sparkle,
  TrendUp,
  Stack,
} from "@phosphor-icons/react";

import { useQuote } from "@/hooks/use-api";
import { formatMoney } from "@/server/pricing/money";
import { formatDateTime, cn } from "@/lib/utils";
import type {
  OptionType,
  PricingStatus,
  QuoteOption,
  QuoteStatus,
} from "@/types/domain";

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

function getQuoteStatusBadge(status: QuoteStatus): {
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

function getPricingStatusBadge(status: PricingStatus): {
  label: string;
  variant: "default" | "primary" | "success" | "warning" | "danger" | "info" | "neutral";
  warningText?: string;
} {
  switch (status) {
    case "demo_unverified":
      return {
        label: "Demo Data / Unverified Catalogue",
        variant: "warning",
        warningText: "Catalogue prices derived from publicly available marketing pages, unverified by Zoho.",
      };
    case "research_estimate":
      return {
        label: "Research Estimate",
        variant: "info",
        warningText: "Pricing is an indicative engineering estimate.",
      };
    case "authorized":
      return {
        label: "Company Authorized",
        variant: "success",
      };
    default:
      return {
        label: status,
        variant: "neutral",
      };
  }
}

function getOptionMeta(optionType: OptionType): {
  title: string;
  badge: string;
  badgeVariant: "primary" | "neutral" | "info";
  icon: React.ElementType;
} {
  switch (optionType) {
    case "best_value":
      return {
        title: "Best Value",
        badge: "Recommended",
        badgeVariant: "primary",
        icon: Sparkle,
      };
    case "lowest_cost":
      return {
        title: "Lowest Cost",
        badge: "Minimum Commitment",
        badgeVariant: "neutral",
        icon: Lightning,
      };
    case "best_coverage":
      return {
        title: "Best Coverage",
        badge: "Max Headroom",
        badgeVariant: "info",
        icon: TrendUp,
      };
    default:
      return {
        title: "Standard Option",
        badge: "Option",
        badgeVariant: "neutral",
        icon: Stack,
      };
  }
}

export default function QuoteDetailPage() {
  const params = useParams<{ id: string }>();
  const quoteId = params?.id ?? "";

  const { data: quote, isLoading: quoteLoading } = useQuote(quoteId);

  const [selectedOptionId, setSelectedOptionId] = React.useState<string | null>(null);
  const [traceOpen, setTraceOpen] = React.useState<boolean>(false);

  // Active option resolver: default to best_value or the first option
  const activeOption = React.useMemo<QuoteOption | null>(() => {
    if (!quote?.options || quote.options.length === 0) return null;
    if (selectedOptionId) {
      const match = quote.options.find((o) => o.id === selectedOptionId);
      if (match) return match;
    }
    return quote.options.find((o) => o.optionType === "best_value") ?? quote.options[0] ?? null;
  }, [quote, selectedOptionId]);

  if (quoteLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 pb-12">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-80" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="mx-auto max-w-7xl pb-12">
        <EmptyState
          icon={WarningCircle}
          title="Quote Not Found"
          description={`The requested quote identifier "${quoteId}" was not found in the calculation datastore.`}
          action={
            <Button variant="default" size="sm" asChild>
              <Link href="/">
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Back to Inbox
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const quoteStatusInfo = getQuoteStatusBadge(quote.status);
  const pricingStatusInfo = getPricingStatusBadge(quote.pricingStatus);

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      {/* Top Breadcrumb Link */}
      <div>
        <Link
          href={`/threads/${quote.threadId}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Thread
        </Link>
      </div>

      {/* Page Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground font-mono">
              Quote #{quote.id}
            </h1>
            <Badge variant={quoteStatusInfo.variant} className="text-xs">
              {quoteStatusInfo.label}
            </Badge>
            <Badge variant={pricingStatusInfo.variant} className="text-xs">
              {pricingStatusInfo.label}
            </Badge>
          </div>

          {/* Meta Info Strip */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="neutral" className="text-[11px] font-mono">
              Catalogue: {quote.catalogueVersion}
            </Badge>
            <Badge variant="neutral" className="text-[11px] font-mono">
              Engine: {quote.calculationVersion}
            </Badge>
            <Badge variant="neutral" className="text-[11px]">
              Market: {quote.market}
            </Badge>
            <Badge variant="neutral" className="text-[11px]">
              Currency: {quote.currency}
            </Badge>
            <Badge variant="neutral" className="text-[11px] capitalize">
              Billing: {quote.billingPeriod}
            </Badge>
            <span className="text-muted-foreground ml-1">
              Calculated on {formatDateTime(quote.createdAt)}
            </span>
          </div>
        </div>

        {/* Primary Action Button */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="default"
            size="md"
            asChild
            className="gap-2 shadow-xs"
          >
            <Link href={`/quotes/${quote.id}/document`} target="_blank">
              <Printer className="h-4 w-4" />
              View / Print PDF Quotation
            </Link>
          </Button>
        </div>
      </div>

      {/* Options Selection Cards Strip */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            Calculated Quotation Options
          </h2>
          <span className="text-xs text-muted-foreground">
            Select an option to inspect detailed line items and coverage
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {quote.options.map((option) => {
            const isSelected = activeOption?.id === option.id;
            const meta = getOptionMeta(option.optionType);
            const OptionIcon = meta.icon;

            return (
              <div
                key={option.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedOptionId(option.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setSelectedOptionId(option.id);
                  }
                }}
                className={cn(
                  "relative flex flex-col justify-between rounded-lg border p-5 cursor-pointer text-left transition-all select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected
                    ? "border-primary bg-primary-soft/10 ring-2 ring-primary/40 shadow-sm"
                    : "border-border bg-surface hover:border-border-strong hover:bg-muted/30 shadow-xs"
                )}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={meta.badgeVariant} className="text-[11px] gap-1">
                      <OptionIcon className="h-3 w-3" />
                      {meta.title}
                    </Badge>
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                      {meta.badge}
                    </span>
                  </div>

                  <h3 className="mt-3 text-lg font-bold text-foreground">
                    {option.planName}
                  </h3>

                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-3">
                    {option.rankReason}
                  </p>
                </div>

                <div className="mt-5 pt-3 border-t border-border/50">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Quoted Total ({quote.billingPeriod})
                  </span>
                  <div className="mt-0.5 text-2xl font-bold font-mono text-foreground">
                    {formatMoney(option.total, quote.currency)}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    Subtotal: {formatMoney(option.subtotal, quote.currency)}
                    {option.taxTotal ? ` + Tax: ${formatMoney(option.taxTotal, quote.currency)}` : " (Excl. Tax)"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Option Detailed Breakdown */}
      {activeOption && (
        <Card className="border-border/80 bg-surface shadow-xs space-y-6">
          <CardHeader className="p-6 pb-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg font-bold text-foreground">
                    Detailed Breakdown: {activeOption.planName}
                  </CardTitle>
                  <Badge variant="primary" className="text-xs capitalize">
                    {activeOption.optionType.replace("_", " ")}
                  </Badge>
                </div>
                <CardDescription className="text-xs mt-1">
                  {activeOption.rankReason}
                </CardDescription>
              </div>

              <div className="text-right">
                <span className="text-xs text-muted-foreground font-medium block">
                  Option Quoted Total
                </span>
                <span className="text-2xl font-bold font-mono text-foreground">
                  {formatMoney(activeOption.total, quote.currency)}
                </span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-6 pt-0 space-y-8">
            {/* 1. Line Items Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Line Items &amp; Pricing Rules
                </h3>
                <span className="text-xs text-muted-foreground font-mono">
                  {activeOption.lineItems.length} items
                </span>
              </div>

              <div className="rounded-md border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-border bg-surface-sunken/60 hover:bg-surface-sunken/60">
                      <TableHead className="min-w-[200px]">Description</TableHead>
                      <TableHead numeric className="w-[80px]">Qty</TableHead>
                      <TableHead className="w-[100px]">Unit</TableHead>
                      <TableHead numeric className="w-[120px]">Unit Price</TableHead>
                      <TableHead numeric className="w-[130px]">Line Total</TableHead>
                      <TableHead className="w-[140px]">Source Ref</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeOption.lineItems.map((item) => (
                      <TableRow key={item.id} className="border-b border-border/60 hover:bg-muted/30">
                        <TableCell className="font-medium text-foreground py-3">
                          <div>{item.description}</div>
                          {item.includedQuantity != null && (
                            <span className="text-[11px] text-muted-foreground">
                              (Base includes {item.includedQuantity} {item.unit})
                            </span>
                          )}
                        </TableCell>
                        <TableCell numeric className="font-mono py-3">
                          {item.quantity}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs py-3">
                          {item.unit}
                        </TableCell>
                        <TableCell numeric className="font-mono py-3">
                          {formatMoney(item.unitPrice, quote.currency)}
                        </TableCell>
                        <TableCell numeric className="font-mono font-semibold text-foreground py-3">
                          {formatMoney(item.lineTotal, quote.currency)}
                        </TableCell>
                        <TableCell className="py-3">
                          <span className="font-mono text-[10px] text-muted-foreground bg-surface-sunken px-1.5 py-0.5 rounded border border-border/50">
                            {item.sourceId}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}

                    {/* Subtotal Row */}
                    <TableRow className="border-t border-border bg-surface-sunken/30">
                      <TableCell colSpan={4} className="text-right font-medium text-xs text-muted-foreground py-2.5">
                        Subtotal:
                      </TableCell>
                      <TableCell numeric className="font-mono font-medium text-foreground py-2.5">
                        {formatMoney(activeOption.subtotal, quote.currency)}
                      </TableCell>
                      <TableCell className="py-2.5" />
                    </TableRow>

                    {/* Tax Row */}
                    <TableRow className="border-b border-border bg-surface-sunken/30">
                      <TableCell colSpan={4} className="text-right font-medium text-xs text-muted-foreground py-2">
                        Taxes:
                      </TableCell>
                      <TableCell numeric className="font-mono text-xs text-muted-foreground py-2">
                        {activeOption.taxTotal != null
                          ? formatMoney(activeOption.taxTotal, quote.currency)
                          : "Excluded / Unverified"}
                      </TableCell>
                      <TableCell className="py-2" />
                    </TableRow>

                    {/* Total Row */}
                    <TableRow className="bg-surface-sunken/60 font-bold">
                      <TableCell colSpan={4} className="text-right text-sm text-foreground py-3">
                        Total Amount ({quote.billingPeriod}):
                      </TableCell>
                      <TableCell numeric className="font-mono text-base font-bold text-primary py-3">
                        {formatMoney(activeOption.total, quote.currency)}
                      </TableCell>
                      <TableCell className="py-3" />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* 2. Coverage vs Demanded Requirements Matrix */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Coverage vs Demanded Requirements Matrix
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Deterministic verification of capacity delivered by base plan + add-ons
                  </p>
                </div>
              </div>

              <div className="rounded-md border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-border bg-surface-sunken/60 hover:bg-surface-sunken/60">
                      <TableHead className="min-w-[180px]">Unit Metric</TableHead>
                      <TableHead numeric className="w-[110px]">Demanded</TableHead>
                      <TableHead numeric className="w-[110px]">Base Plan</TableHead>
                      <TableHead numeric className="w-[110px]">Via Add-ons</TableHead>
                      <TableHead numeric className="w-[120px]">Total Delivered</TableHead>
                      <TableHead className="w-[120px]">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeOption.coverage.map((row) => (
                      <TableRow key={row.unit} className="border-b border-border/60 hover:bg-muted/30">
                        <TableCell className="font-medium text-foreground py-3">
                          <div>{row.label}</div>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {row.unit}
                          </span>
                        </TableCell>
                        <TableCell numeric className="font-mono py-3 font-semibold">
                          {row.required}
                        </TableCell>
                        <TableCell numeric className="font-mono py-3 text-muted-foreground">
                          {row.included}
                        </TableCell>
                        <TableCell numeric className="font-mono py-3 text-muted-foreground">
                          {row.viaAddOns}
                        </TableCell>
                        <TableCell numeric className="font-mono py-3 font-bold text-foreground">
                          {row.total}
                        </TableCell>
                        <TableCell className="py-3">
                          {row.satisfied ? (
                            <Badge variant="success" className="gap-1 text-[11px]">
                              <CheckCircle className="h-3 w-3" />
                              Satisfied
                            </Badge>
                          ) : (
                            <Badge variant="danger" className="gap-1 text-[11px]">
                              <XCircle className="h-3 w-3" />
                              Deficit
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Headroom Notes for Spare Capacity */}
              {activeOption.headroomNotes && activeOption.headroomNotes.length > 0 && (
                <div className="rounded-md border border-info/30 bg-info-soft/20 p-3.5 space-y-1.5 text-xs text-info-soft-foreground">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <Info className="h-4 w-4 text-info" />
                    <span>Headroom &amp; Spare Capacity Buffer</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-foreground/85 pl-1">
                    {activeOption.headroomNotes.map((note, idx) => (
                      <li key={idx}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Integrity Checks Card */}
      <Card className="border-border/80 bg-surface shadow-xs">
        <CardHeader className="p-5 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-success" />
              <CardTitle className="text-base font-semibold">
                Engine Integrity Checks
              </CardTitle>
            </div>
            <Badge variant="success" className="text-xs gap-1">
              <CheckCircle className="h-3.5 w-3.5" />
              All Checks Passed ({quote.integrityChecks.length})
            </Badge>
          </div>
          <CardDescription className="text-xs">
            Calculated options pass algorithmic sanity checks prior to document rendering
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5 pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {quote.integrityChecks.map((check) => (
              <div
                key={check.id}
                className="flex items-start gap-2.5 rounded-md border border-border/60 bg-surface-sunken/40 p-3 text-xs"
              >
                <CheckCircle className="h-4 w-4 text-success shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-foreground">
                      {check.label}
                    </span>
                    <Badge variant="success" className="text-[9px] py-0 px-1 font-mono">
                      PASSED
                    </Badge>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    {check.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Assumptions & Exclusions (2-Column Grid) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Stated Assumptions */}
        <Card className="border-border/80 bg-surface shadow-xs">
          <CardHeader className="p-5 pb-3">
            <div className="flex items-center gap-2 text-foreground">
              <Info className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-semibold">
                Stated Assumptions
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              Baseline parameters driving the quote calculation
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {quote.assumptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">None specified.</p>
            ) : (
              <ul className="space-y-2 text-xs text-foreground/90">
                {quote.assumptions.map((assump, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                    <span>{assump}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Card 2: Stated Exclusions */}
        <Card className="border-border/80 bg-surface shadow-xs">
          <CardHeader className="p-5 pb-3">
            <div className="flex items-center gap-2 text-foreground">
              <Prohibit className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">
                Stated Exclusions
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              Items explicitly excluded from this pricing scope
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {quote.exclusions.length === 0 ? (
              <p className="text-xs text-muted-foreground">None specified.</p>
            ) : (
              <ul className="space-y-2 text-xs text-foreground/90">
                {quote.exclusions.map((excl, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-muted-foreground shrink-0" />
                    <span>{excl}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Calculation Trace (Accordion / Collapsible) */}
      <Card className="border-border/80 bg-surface shadow-xs overflow-hidden">
        <button
          type="button"
          onClick={() => setTraceOpen(!traceOpen)}
          className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-muted/30 select-none"
        >
          <div className="flex items-center gap-2.5">
            <Calculator className="h-5 w-5 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Calculation Trace &amp; Arithmetic Audit
              </h3>
              <p className="text-xs text-muted-foreground">
                Deterministic step-by-step arithmetic trace produced by the pricing engine
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="neutral" className="text-xs font-mono">
              {quote.calculationTrace.length} Steps
            </Badge>
            {traceOpen ? (
              <CaretUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <CaretDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {traceOpen && (
          <div className="border-t border-border p-5 pt-3 animate-fade-in">
            <div className="rounded-md border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border bg-surface-sunken/60 hover:bg-surface-sunken/60">
                    <TableHead className="w-[60px]">Step</TableHead>
                    <TableHead className="w-[140px]">Rule ID</TableHead>
                    <TableHead className="min-w-[200px]">Description</TableHead>
                    <TableHead className="min-w-[280px]">Computation</TableHead>
                    <TableHead numeric className="w-[140px]">Intermediate Minor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quote.calculationTrace.map((step) => (
                    <TableRow key={step.step} className="border-b border-border/50 text-xs hover:bg-muted/20">
                      <TableCell className="font-mono text-muted-foreground py-2.5 font-semibold">
                        #{step.step}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-primary py-2.5">
                        {step.ruleId}
                      </TableCell>
                      <TableCell className="text-foreground py-2.5">
                        {step.description}
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground py-2.5 bg-surface-sunken/30">
                        {step.computation}
                      </TableCell>
                      <TableCell numeric className="font-mono font-medium py-2.5 text-foreground">
                        {step.resultMinor != null
                          ? formatMoney(step.resultMinor, quote.currency)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
