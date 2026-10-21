"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  CheckCircle,
  EnvelopeSimple,
  Sparkle,
  ArrowSquareOut,
  ShoppingCart,
  Printer,
  Moon,
  Sun,
  WarningCircle,
  ShieldCheck,
} from "@phosphor-icons/react";
import { useTheme } from "next-themes";

import { useQuote, useThread } from "@/hooks/use-api";
import { formatMoney } from "@/server/pricing/money";
import { formatDateTime, formatShortRef } from "@/lib/utils";
import type { QuoteOption } from "@/types/domain";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Quote24x7Logo } from "@/components/ui/logo";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function CustomerProposalPage() {
  const params = useParams();
  const rawId = params?.id;
  const quoteId: string =
    typeof rawId === "string" ? rawId : Array.isArray(rawId) ? (rawId[0] ?? "") : "";

  const { data: quote, isLoading: quoteLoading, error: quoteError } = useQuote(quoteId);
  const { data: thread } = useThread(quote?.threadId ?? "");
  const { theme, setTheme } = useTheme();

  const [handoffOpen, setHandoffOpen] = React.useState(false);

  // Selected recommended option
  const activeOption: QuoteOption | undefined = React.useMemo(() => {
    if (!quote?.options || quote.options.length === 0) return undefined;
    return (
      quote.options.find((opt) => opt.optionType === "best_value") ??
      quote.options[0]
    );
  }, [quote?.options]);

  if (quoteLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-24" />
        </div>
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  if (quoteError || !quote) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
          <WarningCircle size={28} />
        </div>
        <h1 className="text-xl font-bold text-foreground">Proposal Not Found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The requested proposal reference could not be located or may have been updated. Please reply to your quotation email for assistance.
        </p>
      </div>
    );
  }

  const currentOption = activeOption ?? quote.options[0];
  const billingPeriodLabel = quote.billingPeriod === "annual" ? "Annually" : "Monthly";
  const customerName = thread?.senderName || "Customer";
  const customerOrg = thread?.organisation || "Client Organization";
  const proposalRef = quote.shortRef || formatShortRef(quote.id);
  const replySubject = encodeURIComponent(`Question regarding Site24x7 Proposal #${proposalRef}`);

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur px-4 py-3">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Quote24x7Logo size="md" />
            <span className="text-xs text-muted-foreground border-l border-border pl-3 font-mono">
              Proposal #{proposalRef}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Toggle visual theme"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <Button
              variant="outline"
              size="sm"
              asChild
              className="h-8 text-xs gap-1.5"
            >
              <Link href={`/quotes/${quote.id}/document`} target="_blank">
                <Printer size={14} />
                <span>Print PDF</span>
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto max-w-4xl px-4 pt-8 space-y-6">
        {/* Proposal Hero Header */}
        <div className="rounded-xl border border-border bg-surface p-6 sm:p-8 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary-soft px-3 py-1 text-xs font-semibold text-primary-soft-foreground mb-3">
                <Sparkle size={13} weight="bold" />
                <span>Custom Monitoring Proposal</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                Site24x7 Infrastructure Sizing
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Prepared specifically for <strong className="text-foreground">{customerName}</strong> ({customerOrg})
              </p>
            </div>

            <div className="text-left sm:text-right bg-muted/30 p-4 rounded-lg border border-border/60">
              <span className="text-xs font-medium text-muted-foreground block">
                Total Subscription ({billingPeriodLabel})
              </span>
              <div className="text-2xl sm:text-3xl font-extrabold font-mono text-primary mt-0.5">
                {currentOption ? formatMoney(currentOption.total, quote.currency) : "—"}
              </div>
              <span className="text-[11px] text-muted-foreground block mt-0.5">
                Billed {billingPeriodLabel} in {quote.currency}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-border/60 text-xs">
            <div>
              <span className="text-muted-foreground block">Proposal Date</span>
              <span className="font-semibold">{formatDateTime(quote.createdAt)}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Billing Cycle</span>
              <span className="font-semibold capitalize">{quote.billingPeriod}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Currency</span>
              <span className="font-semibold">{quote.currency}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Status</span>
              <span className="font-semibold text-success flex items-center gap-1">
                <CheckCircle size={14} weight="fill" /> Ready for Procurement
              </span>
            </div>
          </div>
        </div>

        {/* Executive Summary Rationale */}
        {currentOption && (
          <div className="rounded-xl border border-border bg-surface p-6 shadow-xs space-y-3">
            <h2 className="text-base font-bold text-foreground">
              Configuration Rationale
            </h2>
            <p className="text-sm text-foreground/90 leading-relaxed">
              Based on your stated monitoring requirements, our AI configuration engine designed a custom setup centered on the{" "}
              <strong className="text-foreground">{currentOption.planName}</strong> architecture.
            </p>
            <div className="p-3.5 rounded-lg bg-muted/40 border border-border/60 text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Design Note: </span>
              {currentOption.rankReason}
            </div>
          </div>
        )}

        {/* Monitored Capacity Breakdown */}
        {currentOption?.coverage && currentOption.coverage.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-6 shadow-xs space-y-4">
            <h2 className="text-base font-bold text-foreground">
              Delivered Monitoring Capacity
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {currentOption.coverage.map((row) => (
                <div
                  key={row.unit}
                  className="rounded-lg border border-border/60 bg-muted/20 p-3.5 text-xs space-y-1"
                >
                  <span className="text-muted-foreground block font-medium">{row.label}</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-bold font-mono text-foreground">
                      {row.total.toLocaleString("en-IN")}
                    </span>
                    <Badge variant="success" className="text-[10px] py-0 px-1.5">
                      Fully Sized
                    </Badge>
                  </div>
                  <span className="text-[10px] text-muted-foreground block">
                    {row.included > 0 ? `${row.included} included in base` : ""}
                    {row.included > 0 && row.viaAddOns > 0 ? " + " : ""}
                    {row.viaAddOns > 0 ? `${row.viaAddOns} via component packs` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Itemized Investment Breakdown */}
        {currentOption?.lineItems && currentOption.lineItems.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground">
                Itemized Subscription Breakdown
              </h2>
              <span className="text-xs text-muted-foreground font-mono">
                All amounts in {quote.currency}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
                    <th className="py-2.5 px-3">Description</th>
                    <th className="py-2.5 px-3 text-center">Quantity</th>
                    <th className="py-2.5 px-3 text-center">Unit Sizing</th>
                    <th className="py-2.5 px-3 text-right">Unit Rate</th>
                    <th className="py-2.5 px-3 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {currentOption.lineItems.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/20">
                      <td className="py-3 px-3 font-medium text-foreground">
                        {item.description}
                        {item.includedQuantity != null && item.includedQuantity > 0 && (
                          <span className="text-[10px] text-muted-foreground block">
                            (Base allowance: {item.includedQuantity} {item.unit})
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center font-mono font-medium">
                        {item.quantity}
                      </td>
                      <td className="py-3 px-3 text-center text-muted-foreground">
                        {item.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-muted-foreground">
                        {formatMoney(item.unitPrice, quote.currency)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold text-foreground">
                        {formatMoney(item.lineTotal, quote.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-bold">
                    <td colSpan={3} className="py-3 px-3 text-xs text-muted-foreground">
                      Standard pricing. Taxes and levies calculated at checkout.
                    </td>
                    <td className="py-3 px-3 text-right text-xs">Subtotal:</td>
                    <td className="py-3 px-3 text-right font-mono text-sm">
                      {formatMoney(currentOption.subtotal, quote.currency)}
                    </td>
                  </tr>
                  <tr className="border-t border-border/60 font-bold bg-muted/30">
                    <td colSpan={3} />
                    <td className="py-3 px-3 text-right text-sm">Total ({billingPeriodLabel}):</td>
                    <td className="py-3 px-3 text-right font-mono text-base text-primary font-black">
                      {formatMoney(currentOption.total, quote.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Primary Call to Action Box */}
        <div className="rounded-xl border-2 border-primary/30 bg-primary-soft/10 p-6 sm:p-8 text-center space-y-4">
          <div className="max-w-xl mx-auto space-y-2">
            <h3 className="text-xl font-bold text-foreground">
              Ready to proceed with this configuration?
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Confirm your subscription parameters to initiate order processing with our enterprise team, or reply directly if you need any adjustments.
            </p>
          </div>

          <div className="flex flex-wrap justify-center items-center gap-3 pt-2">
            <Button
              size="lg"
              onClick={() => setHandoffOpen(true)}
              className="gap-2 font-bold px-6 shadow-sm"
            >
              <ShoppingCart size={18} weight="bold" />
              <span>Proceed to Purchase Handoff</span>
            </Button>

            <Button
              variant="outline"
              size="lg"
              asChild
              className="gap-2 font-medium"
            >
              <a href={`mailto:quotes@quotes.joanathan.in?subject=${replySubject}`}>
                <EnvelopeSimple size={18} />
                <span>Request Revision by Email</span>
              </a>
            </Button>
          </div>
        </div>

        {/* Notice */}
        <div className="p-4 rounded-lg border border-border bg-muted/20 text-xs text-muted-foreground text-center space-y-1">
          <p>
            This proposal is generated by Quote24x7 for sizing and budgeting records.
          </p>
        </div>
      </main>

      {/* Purchase Handoff Dialog Modal */}
      <Dialog open={handoffOpen} onOpenChange={setHandoffOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-primary">
              <ShieldCheck size={24} weight="fill" />
            </div>
            <DialogTitle className="text-center text-lg">
              Order Activation &amp; Purchase Handoff
            </DialogTitle>
            <DialogDescription className="text-center text-xs">
              Proposal Reference: <strong className="font-mono text-foreground">#{quote.shortRef || formatShortRef(quote.id)}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <p>
              Your customized configuration has been prepared for activation. To finalize payment and deploy your monitors:
            </p>
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-1 text-foreground">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Selected Setup:</span>
                <span className="font-semibold">{currentOption?.planName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total ({billingPeriodLabel}):</span>
                <span className="font-bold font-mono text-primary">
                  {currentOption ? formatMoney(currentOption.total, quote.currency) : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Recipient Organization:</span>
                <span className="font-semibold">{customerOrg}</span>
              </div>
            </div>
            <p>
              An enterprise onboarding specialist can assist with tax exemptions, PO generation, and billing portal setup.
            </p>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHandoffOpen(false)}
            >
              Close
            </Button>
            <Button
              size="sm"
              asChild
              className="gap-1.5"
            >
              <a
                href="https://www.site24x7.com/contact-support.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>Connect with Sales Support</span>
                <ArrowSquareOut size={14} />
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
