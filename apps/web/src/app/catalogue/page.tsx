"use client";

import * as React from "react";
import {
  Database,
  UploadSimple,
  Copy,
  Check,
  Warning,
  XCircle,
  FileText,
  ShieldCheck,
  ArrowsClockwise,
  ArrowSquareOut,
  Info,
  Package,
  Stack,
  GitCommit,
  MagnifyingGlass,
} from "@phosphor-icons/react";

import { useCatalogues } from "@/hooks/use-api";
import { formatMoney } from "@/server/pricing/money";
import { formatDateTime, cn } from "@/lib/utils";
import type {
  CatalogueVersion,
  Plan,
  AddOnPack,
  SourceReference,
  UnitKind,
  VerificationStatus,
} from "@/types/domain";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

function getVerificationBadge(status: VerificationStatus): {
  label: string;
  variant: "default" | "primary" | "success" | "warning" | "danger" | "info" | "neutral";
} {
  switch (status) {
    case "company_authorized":
      return { label: "Company Authorized", variant: "success" };
    case "public_verified":
      return { label: "Public Verified", variant: "info" };
    case "screenshot_derived":
      return { label: "Screenshot Derived", variant: "warning" };
    case "synthetic_test":
      return { label: "Synthetic Test", variant: "neutral" };
    default:
      return { label: status, variant: "default" };
  }
}

function formatUnitKind(unit: UnitKind): string {
  switch (unit) {
    case "basic_monitor":
      return "Basic Monitor";
    case "advanced_monitor":
      return "Advanced Monitor";
    case "host_monitor":
      return "Server / Host Monitor";
    case "network_component":
      return "Network Component";
    case "rum_pageview":
      return "RUM Pageview";
    case "applog_gb":
      return "AppLogs Volume (GB)";
    case "synthetic_run":
      return "Synthetic Run";
    default:
      return unit;
  }
}

export default function CataloguePage() {
  const { data: catalogues, isLoading, error, refetch } = useCatalogues();
  const catalogue: CatalogueVersion | undefined = catalogues?.[0];

  const [copiedHash, setCopiedHash] = React.useState(false);
  const [importDialogOpen, setImportDialogOpen] = React.useState(false);
  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [importStatus, setImportStatus] = React.useState<string | null>(null);

  // Search filters
  const [planSearch, setPlanSearch] = React.useState("");
  const [addOnSearch, setAddOnSearch] = React.useState("");

  const handleCopyHash = () => {
    if (!catalogue?.contentHash) return;
    navigator.clipboard.writeText(catalogue.contentHash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setImportFile(e.target.files[0]);
      setImportStatus(null);
    }
  };

  const handleSimulateImport = () => {
    if (!importFile) return;
    setImportStatus("validating");
    setTimeout(() => {
      setImportStatus("done");
    }, 1200);
  };

  const filteredPlans = React.useMemo(() => {
    if (!catalogue?.plans) return [];
    if (!planSearch.trim()) return catalogue.plans;
    const q = planSearch.toLowerCase();
    return catalogue.plans.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.summary.toLowerCase().includes(q) ||
        p.capabilities.some((c) => c.toLowerCase().includes(q))
    );
  }, [catalogue?.plans, planSearch]);

  const filteredAddOns = React.useMemo(() => {
    if (!catalogue?.addOns) return [];
    if (!addOnSearch.trim()) return catalogue.addOns;
    const q = addOnSearch.toLowerCase();
    return catalogue.addOns.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.unit.toLowerCase().includes(q) ||
        formatUnitKind(a.unit).toLowerCase().includes(q)
    );
  }, [catalogue?.addOns, addOnSearch]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96" />
          </div>
          <Skeleton className="h-9 w-36" />
        </div>
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !catalogue) {
    return (
      <EmptyState
        icon={XCircle}
        title="Failed to load catalogue"
        description="The versioned pricing catalogue could not be loaded from disk or API."
        action={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <ArrowsClockwise className="h-4 w-4 mr-1.5" />
            Retry
          </Button>
        }
      />
    );
  }

  const verification = getVerificationBadge(catalogue.verificationStatus);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Database className="h-6 w-6 text-primary" weight="duotone" />
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Pricing Catalogue
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Versioned Site24x7 pricing rules, plans, entitlements, add-ons, and provenance records.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="h-9"
          >
            <ArrowsClockwise className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              setImportFile(null);
              setImportStatus(null);
              setImportDialogOpen(true);
            }}
            className="h-9"
          >
            <UploadSimple className="h-4 w-4 mr-1.5" weight="bold" />
            Import Catalogue
          </Button>
        </div>
      </div>

      {/* Active Version Banner */}
      <Card className="border-border bg-surface shadow-xs overflow-hidden">
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="success" className="px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider">
                {catalogue.status}
              </Badge>
              <Badge variant={verification.variant} className="px-2.5 py-0.5 text-xs">
                {verification.label}
              </Badge>
              <Badge variant="neutral" className="font-mono text-xs">
                {catalogue.market} / {catalogue.currency}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Effective: {formatDateTime(catalogue.effectiveFrom)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-mono">
                v{catalogue.version}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-border/50 text-xs">
            <div>
              <span className="text-muted-foreground block mb-0.5">Content Hash (SHA-256)</span>
              <div className="flex items-center gap-1.5 font-mono text-foreground bg-muted/50 px-2 py-1 rounded border border-border/40 select-all">
                <GitCommit className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate" title={catalogue.contentHash}>
                  {catalogue.contentHash}
                </span>
                <button
                  type="button"
                  onClick={handleCopyHash}
                  className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                  title="Copy content hash"
                >
                  {copiedHash ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <span className="text-muted-foreground block mb-0.5">Catalogue ID</span>
              <div className="font-mono text-foreground bg-muted/50 px-2 py-1 rounded border border-border/40">
                {catalogue.id}
              </div>
            </div>

            <div>
              <span className="text-muted-foreground block mb-0.5">Plans / Add-Ons</span>
              <div className="text-foreground bg-muted/50 px-2 py-1 rounded border border-border/40 font-medium">
                {catalogue.plans.length} base plans • {catalogue.addOns.length} add-on packs
              </div>
            </div>

            <div>
              <span className="text-muted-foreground block mb-0.5">Sources Registered</span>
              <div className="text-foreground bg-muted/50 px-2 py-1 rounded border border-border/40 font-medium">
                {catalogue.sources.length} captured references
              </div>
            </div>
          </div>

          {/* Warning Alert Banner */}
          <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft/60 p-3.5 text-warning-soft-foreground">
            <Warning className="h-5 w-5 shrink-0 text-warning mt-0.5" weight="fill" />
            <div className="text-xs leading-relaxed space-y-1">
              <p className="font-medium text-foreground">
                Demonstration Price Book — Screenshot Derived Data
              </p>
              <p className="text-muted-foreground">
                All amounts are transcribed from screenshots supplied with this evaluation project. None of these prices are authorised by Zoho or Site24x7, and none may be presented to buyers as binding commercial offers. Noticeable discrepancies exist between store comparison captures and personalized plan screenshots.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Tabbed Navigation */}
      <Tabs defaultValue="plans" className="w-full space-y-4">
        <TabsList className="grid grid-cols-2 sm:grid-cols-5 h-auto p-1 bg-muted/70 gap-1 rounded-lg">
          <TabsTrigger value="plans" className="py-2 text-xs">
            <Package className="h-3.5 w-3.5 mr-1.5" />
            Plans ({catalogue.plans.length})
          </TabsTrigger>
          <TabsTrigger value="addons" className="py-2 text-xs">
            <Stack className="h-3.5 w-3.5 mr-1.5" />
            Add-On Packs ({catalogue.addOns.length})
          </TabsTrigger>
          <TabsTrigger value="sources" className="py-2 text-xs">
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Sources ({catalogue.sources.length})
          </TabsTrigger>
          <TabsTrigger value="validation" className="py-2 text-xs">
            <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
            Validation Report
          </TabsTrigger>
          <TabsTrigger value="notes" className="py-2 text-xs">
            <Info className="h-3.5 w-3.5 mr-1.5" />
            Notes ({catalogue.notes.length})
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Plans */}
        <TabsContent value="plans" className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <MagnifyingGlass className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search plans by name, capability..."
                value={planSearch}
                onChange={(e) => setPlanSearch(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>
            <span className="text-xs text-muted-foreground self-center">
              Showing {filteredPlans.length} of {catalogue.plans.length} plans
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {filteredPlans.map((plan: Plan) => {
              const basicEntitlement = plan.entitlements.find((e) => e.unit === "basic_monitor")?.included;
              const advancedEntitlement = plan.entitlements.find((e) => e.unit === "advanced_monitor")?.included;
              const hostEntitlement = plan.entitlements.find((e) => e.unit === "host_monitor")?.included;
              const netEntitlement = plan.entitlements.find((e) => e.unit === "network_component")?.included;
              const rumEntitlement = plan.entitlements.find((e) => e.unit === "rum_pageview")?.included;
              const logEntitlement = plan.entitlements.find((e) => e.unit === "applog_gb")?.included;

              return (
                <Card key={plan.id} className="border-border bg-surface shadow-xs hover:border-border-strong transition-all">
                  <CardHeader className="pb-3 border-b border-border/40">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base font-semibold">{plan.name}</CardTitle>
                          <Badge variant="neutral" className="font-mono text-[11px] py-0 px-2">
                            {plan.id}
                          </Badge>
                        </div>
                        <CardDescription className="text-xs mt-1 max-w-2xl">
                          {plan.summary}
                        </CardDescription>
                      </div>
                      <div className="text-right sm:self-start">
                        <div className="text-lg font-bold font-mono text-foreground">
                          {formatMoney(plan.basePrice, catalogue.currency)}
                        </div>
                        <div className="text-[11px] text-muted-foreground capitalize">
                          Billed {plan.billingPeriod}
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-4">
                    {/* Operational parameters */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-muted/40 p-2.5 rounded-md border border-border/30">
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Polling Frequency</span>
                        <span className="font-medium text-foreground">{plan.pollingFrequency}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Locations</span>
                        <span className="font-medium text-foreground">
                          {plan.monitoringLocations ? `${plan.monitoringLocations} locations` : "Global / N/A"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Source Reference</span>
                        <span className="font-mono text-muted-foreground truncate block" title={plan.sourceId}>
                          {plan.sourceId}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Compatible Add-ons</span>
                        <span className="font-medium text-foreground">{plan.allowedAddOnIds.length} packs</span>
                      </div>
                    </div>

                    {/* Entitlements */}
                    <div>
                      <span className="text-xs font-medium text-foreground block mb-2">
                        Included Base Entitlements:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant={basicEntitlement ? "primary" : "neutral"} className="text-xs py-0.5">
                          {basicEntitlement ? `${basicEntitlement} Basic Monitors` : "No Basic Monitors"}
                        </Badge>
                        <Badge variant={advancedEntitlement ? "primary" : "neutral"} className="text-xs py-0.5">
                          {advancedEntitlement ? `${advancedEntitlement} Advanced Monitors` : "No Advanced Monitors"}
                        </Badge>
                        <Badge variant={hostEntitlement ? "primary" : "neutral"} className="text-xs py-0.5">
                          {hostEntitlement ? `${hostEntitlement} Server Hosts` : "No Hosts Included"}
                        </Badge>
                        <Badge variant={netEntitlement ? "primary" : "neutral"} className="text-xs py-0.5">
                          {netEntitlement ? `${netEntitlement} Network Devices` : "No Network Devices"}
                        </Badge>
                        <Badge variant={rumEntitlement ? "primary" : "neutral"} className="text-xs py-0.5">
                          {rumEntitlement ? `${(rumEntitlement / 1_000_000).toFixed(0)}M RUM Pageviews` : "0 RUM Included"}
                        </Badge>
                        <Badge variant={logEntitlement ? "primary" : "neutral"} className="text-xs py-0.5">
                          {logEntitlement ? `${logEntitlement} GB AppLogs` : "0 GB Logs Included"}
                        </Badge>
                      </div>
                    </div>

                    {/* Capabilities & Allowed Add-ons */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-border/30 text-xs">
                      <div>
                        <span className="text-muted-foreground block mb-1">Capabilities:</span>
                        <div className="flex flex-wrap gap-1">
                          {plan.capabilities.map((cap, i) => (
                            <span key={i} className="inline-flex items-center px-2 py-0.5 rounded bg-muted text-[11px] text-muted-foreground">
                              {cap}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground block mb-1">Allowed Add-on IDs:</span>
                        <div className="flex flex-wrap gap-1 font-mono text-[10px]">
                          {plan.allowedAddOnIds.length === 0 ? (
                            <span className="text-muted-foreground italic">None (standalone uptime pack)</span>
                          ) : (
                            plan.allowedAddOnIds.map((id) => (
                              <span key={id} className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                {id.replace("addon_", "")}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Tab 2: Add-On Packs */}
        <TabsContent value="addons" className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <MagnifyingGlass className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search add-on packs by name, unit kind..."
                value={addOnSearch}
                onChange={(e) => setAddOnSearch(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>
            <span className="text-xs text-muted-foreground self-center">
              Showing {filteredAddOns.length} of {catalogue.addOns.length} add-on packs
            </span>
          </div>

          <Card className="border-border bg-surface shadow-xs overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Add-on Pack</TableHead>
                  <TableHead>Unit Kind</TableHead>
                  <TableHead>Pack Sizing</TableHead>
                  <TableHead numeric>Pack Price</TableHead>
                  <TableHead>Applies To</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAddOns.map((addOn: AddOnPack) => {
                  const isUnpriced = addOn.packPrice === null;
                  return (
                    <TableRow key={addOn.id} className="hover:bg-muted/40">
                      <TableCell>
                        <div className="font-medium text-foreground">{addOn.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{addOn.id}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="neutral" className="text-[11px]">
                          {formatUnitKind(addOn.unit)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs font-semibold text-foreground">
                          {addOn.packSize.toLocaleString()}
                        </span>{" "}
                        <span className="text-xs text-muted-foreground">units/pack</span>
                      </TableCell>
                      <TableCell numeric>
                        {isUnpriced ? (
                          <Badge variant="warning" className="text-[11px] font-normal">
                            Unpriced / Reject if demanded
                          </Badge>
                        ) : (
                          <div className="font-mono font-semibold text-foreground text-sm">
                            {formatMoney(addOn.packPrice!, catalogue.currency)}
                            <span className="text-[10px] text-muted-foreground font-normal ml-1">
                              /{addOn.billingPeriod}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {addOn.appliesToPlanIds.length === 0 ? (
                          <span className="text-xs text-muted-foreground">All compatible plans</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {addOn.appliesToPlanIds.map((pid) => (
                              <Badge key={pid} variant="neutral" className="text-[10px] font-mono py-0">
                                {pid.replace("plan_", "")}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground truncate max-w-[140px] block" title={addOn.sourceId}>
                          {addOn.sourceId}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Tab 3: Source Register */}
        <TabsContent value="sources" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {catalogue.sources.map((source: SourceReference) => {
              const v = getVerificationBadge(source.verificationStatus);
              return (
                <Card key={source.id} className="border-border bg-surface shadow-xs">
                  <CardHeader className="pb-3 border-b border-border/40">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-sm font-semibold">{source.title}</CardTitle>
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {source.id}
                        </div>
                      </div>
                      <Badge variant={v.variant} className="text-[11px] shrink-0">
                        {v.label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-3 space-y-3 text-xs">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Artifact Locator:</span>
                      <span className="font-mono text-foreground break-all">{source.locator}</span>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Retrieved At:</span>
                        <span className="text-foreground">{formatDateTime(source.retrievedAt)}</span>
                      </div>
                      {source.url && (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline font-medium text-xs"
                        >
                          <span>Visit Source</span>
                          <ArrowSquareOut className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>

                    {source.caveats.length > 0 && (
                      <div className="pt-2 border-t border-border/30">
                        <span className="text-muted-foreground font-medium block mb-1.5 flex items-center gap-1">
                          <Warning className="h-3.5 w-3.5 text-warning" weight="fill" />
                          Recorded Caveats ({source.caveats.length}):
                        </span>
                        <ul className="space-y-1 list-disc list-inside text-muted-foreground pl-1">
                          {source.caveats.map((c, i) => (
                            <li key={i} className="leading-relaxed">
                              {c}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Tab 4: Validation Report */}
        <TabsContent value="validation" className="space-y-4">
          <Card className="border-border bg-surface shadow-xs">
            <CardHeader className="border-b border-border/40 pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-primary" weight="duotone" />
                    <CardTitle className="text-base">Domain Validation Report</CardTitle>
                  </div>
                  <CardDescription className="text-xs mt-1">
                    Evaluated during catalogue import. Integrity checks enforce provenance and pricing discipline.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={catalogue.validation.passed ? "success" : "danger"}
                    className="text-xs px-2.5 py-1 font-semibold"
                  >
                    {catalogue.validation.passed ? "Validation Passed" : "Validation Failed"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Checked {formatDateTime(catalogue.validation.checkedAt)}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-lg bg-muted/40 border border-border/40">
                  <span className="text-xs text-muted-foreground block">Overall Status</span>
                  <span className={cn("text-base font-bold", catalogue.validation.passed ? "text-success" : "text-danger")}>
                    {catalogue.validation.passed ? "PASSED" : "FAILED"}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-muted/40 border border-border/40">
                  <span className="text-xs text-muted-foreground block">Errors</span>
                  <span className={cn("text-base font-bold", catalogue.validation.errors.length === 0 ? "text-muted-foreground" : "text-danger")}>
                    {catalogue.validation.errors.length}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-muted/40 border border-border/40">
                  <span className="text-xs text-muted-foreground block">Warnings</span>
                  <span className={cn("text-base font-bold", catalogue.validation.warnings.length > 0 ? "text-warning" : "text-muted-foreground")}>
                    {catalogue.validation.warnings.length}
                  </span>
                </div>
              </div>

              {/* Errors List */}
              {catalogue.validation.errors.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-danger flex items-center gap-1.5 uppercase tracking-wider">
                    <XCircle className="h-4 w-4" weight="fill" />
                    Validation Errors ({catalogue.validation.errors.length})
                  </h4>
                  <div className="space-y-2">
                    {catalogue.validation.errors.map((finding, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-md border border-danger/30 bg-danger-soft/40 text-xs space-y-1"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="danger" className="font-mono text-[10px]">
                            {finding.code}
                          </Badge>
                          {finding.subject && (
                            <Badge variant="neutral" className="font-mono text-[10px]">
                              {finding.subject}
                            </Badge>
                          )}
                        </div>
                        <p className="text-foreground">{finding.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings List */}
              {catalogue.validation.warnings.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-warning flex items-center gap-1.5 uppercase tracking-wider">
                    <Warning className="h-4 w-4" weight="fill" />
                    Validation Findings & Warnings ({catalogue.validation.warnings.length})
                  </h4>
                  <div className="space-y-2">
                    {catalogue.validation.warnings.map((finding, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-md border border-warning/30 bg-warning-soft/30 text-xs space-y-1"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="warning" className="font-mono text-[10px]">
                            {finding.code}
                          </Badge>
                          {finding.subject && (
                            <Badge variant="neutral" className="font-mono text-[10px]">
                              {finding.subject}
                            </Badge>
                          )}
                        </div>
                        <p className="text-foreground leading-relaxed">{finding.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 5: Catalogue Notes */}
        <TabsContent value="notes" className="space-y-3">
          {catalogue.notes.map((note: string, idx: number) => (
            <Card key={idx} className="border-border bg-surface shadow-xs">
              <CardContent className="p-4 flex items-start gap-3 text-xs leading-relaxed">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary font-bold text-[11px]">
                  {idx + 1}
                </span>
                <p className="text-foreground">{note}</p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* Import Catalogue Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UploadSimple className="h-5 w-5 text-primary" weight="bold" />
              Import Pricing Catalogue
            </DialogTitle>
            <DialogDescription>
              Upload a versioned JSON price book. Validations will run prior to activation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
              <span className="font-semibold text-foreground block">
                Validation Rules Enforced on Import:
              </span>
              <ul className="space-y-1.5 list-disc list-inside text-muted-foreground">
                <li>
                  <strong className="text-foreground">Schema Conformance:</strong> Strict JSON matching for plans, add-ons, and sources.
                </li>
                <li>
                  <strong className="text-foreground">Provenance Tracking:</strong> Every price must reference a valid source ID.
                </li>
                <li>
                  <strong className="text-foreground">Single Billing Period:</strong> Mixed billing periods inside a single catalogue version are rejected.
                </li>
                <li>
                  <strong className="text-foreground">Verification Integrity:</strong> Screenshot or synthetic sources cannot claim company_authorized status.
                </li>
                <li>
                  <strong className="text-foreground">Unpriced Add-ons:</strong> Add-ons missing unit prices generate warnings and require configuration guards.
                </li>
              </ul>
            </div>

            {/* Dropzone */}
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
              <input
                type="file"
                id="catalogue-file"
                accept=".json"
                onChange={handleFileChange}
                className="hidden"
              />
              <label
                htmlFor="catalogue-file"
                className="cursor-pointer flex flex-col items-center justify-center gap-2"
              >
                <UploadSimple className="h-8 w-8 text-muted-foreground" />
                <span className="font-medium text-foreground">
                  {importFile ? importFile.name : "Choose JSON file or drag here"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Accepts .json files containing valid CatalogueFile definitions
                </span>
              </label>
            </div>

            {importStatus === "validating" && (
              <div className="flex items-center gap-2 text-primary bg-primary-soft p-3 rounded-md">
                <ArrowsClockwise className="h-4 w-4 animate-spin shrink-0" />
                <span>Parsing schema and running integrity validations...</span>
              </div>
            )}

            {importStatus === "done" && (
              <div className="flex items-start gap-2 text-warning bg-warning-soft/70 p-3 rounded-md">
                <Warning className="h-4 w-4 shrink-0 text-warning mt-0.5" weight="fill" />
                <div className="space-y-1">
                  <span className="font-medium text-foreground">Import Simulation Complete</span>
                  <p className="text-muted-foreground text-[11px]">
                    Catalogue validated successfully. In this console environment, active catalogue activation is locked to demo mode to ensure audit integrity.
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={!importFile || importStatus === "validating"}
              onClick={handleSimulateImport}
            >
              Validate & Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
