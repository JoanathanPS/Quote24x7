"use client";

import * as React from "react";
import {
  Database,
  XCircle,
  ArrowsClockwise,
  Package,
  Stack,
  MagnifyingGlass,
} from "@phosphor-icons/react";

import { useCatalogues } from "@/hooks/use-api";
import { formatMoney } from "@/server/pricing/money";
import type {
  CatalogueVersion,
  Plan,
  AddOnPack,
  UnitKind,
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

  // Search filters
  const [planSearch, setPlanSearch] = React.useState("");
  const [addOnSearch, setAddOnSearch] = React.useState("");

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
          <Skeleton className="h-9 w-24" />
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !catalogue) {
    return (
      <EmptyState
        icon={XCircle}
        title="Failed to load catalogue"
        description="The pricing catalogue could not be loaded from disk or API."
        action={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <ArrowsClockwise className="h-4 w-4 mr-1.5" />
            Retry
          </Button>
        }
      />
    );
  }

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
            Site24x7 subscription plans and add-on pricing catalogue.
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
        </div>
      </div>

      {/* Tabbed Navigation */}
      <Tabs defaultValue="plans" className="w-full space-y-4">
        <TabsList className="grid grid-cols-2 w-full sm:w-[380px] h-auto p-1 bg-muted/70 gap-1 rounded-lg">
          <TabsTrigger value="plans" className="py-2 text-xs">
            <Package className="h-3.5 w-3.5 mr-1.5" />
            Plans ({catalogue.plans.length})
          </TabsTrigger>
          <TabsTrigger value="addons" className="py-2 text-xs">
            <Stack className="h-3.5 w-3.5 mr-1.5" />
            Add-On Packs ({catalogue.addOns.length})
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
                  const gridPrices = catalogue.planAddOnPrices
                    ? Object.values(catalogue.planAddOnPrices)
                        .map((p) => p[addOn.id])
                        .filter((p): p is number => p !== undefined)
                    : [];
                  const isPricedInGrid = gridPrices.length > 0;
                  const minGridPrice = isPricedInGrid ? Math.min(...gridPrices) : null;
                  const maxGridPrice = isPricedInGrid ? Math.max(...gridPrices) : null;

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
                        {addOn.packPrice !== null ? (
                          <div className="font-mono font-semibold text-foreground text-sm">
                            {formatMoney(addOn.packPrice, catalogue.currency)}
                            <span className="text-[10px] text-muted-foreground font-normal ml-1">
                              /{addOn.billingPeriod}
                            </span>
                          </div>
                        ) : isPricedInGrid ? (
                          <div className="font-mono font-semibold text-foreground text-xs text-right">
                            {minGridPrice === maxGridPrice ? (
                              <span>{formatMoney(minGridPrice!, catalogue.currency)}/yr</span>
                            ) : (
                              <span>
                                {formatMoney(minGridPrice!, catalogue.currency)} – {formatMoney(maxGridPrice!, catalogue.currency)}/yr
                              </span>
                            )}
                            <span className="block text-[10px] text-primary/80 font-sans font-normal">
                              Tiered in Store grid
                            </span>
                          </div>
                        ) : (
                          <Badge variant="neutral" className="text-[11px] font-normal">
                            Custom / Contact Sales
                          </Badge>
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
      </Tabs>
    </div>
  );
}
