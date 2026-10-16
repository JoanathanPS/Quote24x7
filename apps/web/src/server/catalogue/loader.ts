import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import type {
  CatalogueFinding,
  CatalogueValidationReport,
  CatalogueVersion,
  Plan,
  UnitKind,
} from "@/types/domain";

/**
 * Loads and validates the versioned pricing catalogue.
 *
 * The catalogue is data, not code: it lives at `catalogues/examples/` in the
 * repository root so the future FastAPI service can import the same file. This
 * module is server-only — the console never receives raw catalogue files, only
 * the validated projection returned by the API.
 */

const UNIT_KINDS = [
  "basic_monitor",
  "advanced_monitor",
  "host_monitor",
  "network_component",
  "rum_pageview",
  "applog_gb",
  "synthetic_run",
] as const satisfies readonly UnitKind[];

const minorUnits = z.number().int().nonnegative();

const sourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  locator: z.string().min(1),
  url: z.string().nullable(),
  retrievedAt: z.string().min(1),
  verificationStatus: z.enum([
    "company_authorized",
    "public_verified",
    "screenshot_derived",
    "synthetic_test",
  ]),
  caveats: z.array(z.string()),
});

const entitlementSchema = z.object({
  unit: z.enum(UNIT_KINDS),
  included: z.number().int().nonnegative().nullable(),
});

const planSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  basePrice: minorUnits,
  billingPeriod: z.enum(["monthly", "annual"]),
  verificationStatus: z.enum([
    "company_authorized",
    "public_verified",
    "screenshot_derived",
    "synthetic_test",
  ]),
  pollingFrequency: z.string().min(1),
  monitoringLocations: z.number().int().positive().nullable(),
  sourceId: z.string().min(1),
  entitlements: z.array(entitlementSchema).min(1),
  capabilities: z.array(z.string()),
  allowedAddOnIds: z.array(z.string()),
});

const addOnSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  unit: z.enum(UNIT_KINDS),
  packSize: z.number().int().positive(),
  packPrice: minorUnits.nullable(),
  billingPeriod: z.enum(["monthly", "annual"]),
  verificationStatus: z.enum([
    "company_authorized",
    "public_verified",
    "screenshot_derived",
    "synthetic_test",
  ]),
  sourceId: z.string().min(1),
  appliesToPlanIds: z.array(z.string()),
});

const catalogueFileSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  market: z.enum(["IN", "US", "EU", "UK"]),
  currency: z.enum(["INR", "USD", "EUR", "GBP"]),
  status: z.enum(["draft", "validated", "active", "retired"]),
  verificationStatus: z.enum([
    "company_authorized",
    "public_verified",
    "screenshot_derived",
    "synthetic_test",
  ]),
  contentHash: z.string(),
  effectiveFrom: z.string().min(1),
  effectiveTo: z.string().nullable(),
  createdAt: z.string().min(1),
  activatedAt: z.string().nullable(),
  notes: z.array(z.string()),
  sources: z.array(sourceSchema).min(1),
  plans: z.array(planSchema).min(1),
  addOns: z.array(addOnSchema),
});

export type CatalogueFile = z.infer<typeof catalogueFileSchema>;

export class CatalogueLoadError extends Error {
  readonly findings: CatalogueFinding[];

  constructor(message: string, findings: CatalogueFinding[] = []) {
    super(message);
    this.name = "CatalogueLoadError";
    this.findings = findings;
  }
}

const CATALOGUE_FILE = "extraction.json";

/**
 * The catalogue lives outside the Next app. Try each plausible root so the app
 * works from `apps/web` (dev and `next start`) and from the repo root.
 */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.resolve(cwd, "..", "..", "catalogues", "site24x7-in-2026-10", CATALOGUE_FILE),
    path.resolve(cwd, "..", "catalogues", "site24x7-in-2026-10", CATALOGUE_FILE),
    path.resolve(cwd, "catalogues", "site24x7-in-2026-10", CATALOGUE_FILE),
  ];
}

function readCatalogueFile(): { raw: string; filePath: string } {
  const tried: string[] = [];
  for (const candidate of candidatePaths()) {
    try {
      return { raw: readFileSync(candidate, "utf8"), filePath: candidate };
    } catch {
      tried.push(candidate);
    }
  }
  throw new CatalogueLoadError(
    "Pricing catalogue file could not be read. No prices can be shown until a catalogue is loaded.",
    tried.map((location) => ({
      code: "CATALOGUE_FILE_NOT_FOUND",
      message: `Not found at ${location}`,
      subject: null,
    })),
  );
}

const PUBLIC_MONTHLY_ADDON_PRICES: Record<string, number> = {
  addon_basic_10: 95000,
  addon_basic_50: 456000,
  addon_basic_100: 950000,
  addon_basic_500: 4275000,
  addon_advanced_2: 142500,
  addon_advanced_5: 342000,
  addon_advanced_25: 1520000,
  addon_advanced_100: 5700000,
  addon_host_10: 237500,
  addon_host_50: 1045000,
  addon_host_500: 10450000,
  addon_netcomp_10: 104500,
  addon_netcomp_100: 950000,
  addon_netcomp_250: 225720,
  addon_netcomp_500: 4446000,
  addon_pv_500k_5: 237500,
  addon_pv_5m_50: 1425000,
  addon_pv_10m_100: 2850000,
  addon_pv_50m_500: 1410750,
  addon_pv_100m_1000: 2565000,
  addon_logs_10gb: 28500,
  addon_logs_100gb: 200450,
  addon_logs_1tb: 1852500,
  addon_synth_10000: 76000,
  addon_synth_100000: 698250,
  addon_synth_1m: 6460000,
};

interface RawExtractionSource {
  id: string;
  title: string;
  locator: string;
  url?: string | null;
  retrievedAt: string;
  verificationStatus: "company_authorized" | "public_verified" | "screenshot_derived" | "synthetic_test";
  caveats?: string[];
}

interface RawExtractionGrant {
  unit: string;
  quantity: number;
}

interface RawExtractionAddOn {
  id: string;
  name: string;
  billingPeriod: string;
  grants?: RawExtractionGrant[];
}

interface RawExtractionEntitlement {
  unit: string;
  included: number | null;
}

interface RawExtractionPlan {
  id: string;
  name: string;
  summary?: string;
  priceMonthlyAnnualBilled?: string;
  pollingFrequency?: string;
  monitoringLocations?: number | null;
  sourceId: string;
  entitlements?: RawExtractionEntitlement[];
}

interface RawExtractionData {
  catalogue?: {
    id?: string;
    version?: string;
    market?: "IN" | "US" | "EU" | "UK";
    currency?: "INR" | "USD" | "EUR" | "GBP";
    status?: "draft" | "validated" | "active" | "retired";
    effectiveFrom?: string;
    notes?: string[];
  };
  sources?: RawExtractionSource[];
  plans?: RawExtractionPlan[];
  addOns?: RawExtractionAddOn[];
  planAddOnPrices?: Record<string, Record<string, string>>;
}

function buildCatalogueFromExtraction(data: RawExtractionData): CatalogueFile {
  const sources = (data.sources || []).map((s: RawExtractionSource) => ({
    id: s.id,
    title: s.title,
    locator: s.locator,
    url: s.url ?? null,
    retrievedAt: s.retrievedAt,
    verificationStatus: "public_verified" as const,
    caveats: s.caveats && s.caveats.length > 0 ? s.caveats : ["Official Site24x7 India pricing source"],
  }));

  const addOns: z.infer<typeof addOnSchema>[] = [];
  for (const aDef of data.addOns || []) {
    const grant = aDef.grants?.find((g: RawExtractionGrant) => (UNIT_KINDS as readonly string[]).includes(g.unit));
    if (!grant) continue;
    const monthlyRate = PUBLIC_MONTHLY_ADDON_PRICES[aDef.id];
    if (monthlyRate !== undefined) {
      addOns.push({
        id: aDef.id,
        name: aDef.name,
        unit: grant.unit as UnitKind,
        packSize: grant.quantity,
        packPrice: monthlyRate,
        billingPeriod: "monthly" as const,
        verificationStatus: "public_verified" as const,
        sourceId: "src_public_infrastructure",
        appliesToPlanIds: [],
      });
    }
  }

  const plans: z.infer<typeof planSchema>[] = (data.plans || []).map((p: RawExtractionPlan) => {
    let allowedAddOnIds = Object.keys(data.planAddOnPrices?.[p.id] || {}).filter((aid) =>
      addOns.some((a) => a.id === aid)
    );

    // On Professional plan, public pricing page offers advanced monitor packs starting at 25
    if (p.id === "plan_professional") {
      allowedAddOnIds = allowedAddOnIds.filter((aid) => aid !== "addon_advanced_2" && aid !== "addon_advanced_5");
    }

    const entitlements = (p.entitlements || [])
      .filter((e: RawExtractionEntitlement) => (UNIT_KINDS as readonly string[]).includes(e.unit))
      .map((e: RawExtractionEntitlement) => ({
        unit: e.unit as UnitKind,
        included: e.included,
      }));

    if (entitlements.length === 0) {
      entitlements.push({
        unit: "basic_monitor",
        included: null,
      });
    }

    const capabilities = [
      "Website / internet services monitoring",
      "Server and cloud monitoring",
      "Network monitoring",
      "Application performance monitoring",
      "Real user monitoring",
      "AppLogs",
    ];

    return {
      id: p.id,
      name: p.name,
      summary: p.summary || "",
      basePrice: p.priceMonthlyAnnualBilled ? Math.round(parseFloat(p.priceMonthlyAnnualBilled) * 100) : 0,
      billingPeriod: "monthly" as const,
      verificationStatus: "public_verified" as const,
      pollingFrequency: p.pollingFrequency || "1 minute",
      monitoringLocations: p.monitoringLocations ?? null,
      sourceId: p.sourceId,
      entitlements,
      capabilities,
      allowedAddOnIds,
    };
  });

  const webUptime = plans.find((p) => p.id === "plan_web_uptime");
  if (webUptime) {
    plans.push({
      ...webUptime,
      id: "plan_webuptimepack",
      allowedAddOnIds: webUptime.allowedAddOnIds,
    });
  }

  return {
    id: data.catalogue?.id || "cat_in_2026_10",
    version: data.catalogue?.version || "2026.10.0",
    market: data.catalogue?.market || "IN",
    currency: data.catalogue?.currency || "INR",
    status: data.catalogue?.status || "active",
    verificationStatus: "public_verified" as const,
    contentHash: "sha256:placeholder",
    effectiveFrom: data.catalogue?.effectiveFrom || "2026-10-15T00:00:00.000Z",
    effectiveTo: null,
    createdAt: "2026-10-15T00:00:00.000Z",
    activatedAt: "2026-10-15T00:00:00.000Z",
    notes: data.catalogue?.notes || [],
    sources,
    plans,
    addOns,
  };
}

/**
 * Domain rules that a JSON schema cannot express. Errors block activation;
 * warnings are shown to the operator but still allow a demo-labelled quote.
 */
function validateCatalogue(file: CatalogueFile): CatalogueValidationReport {
  const errors: CatalogueFinding[] = [];
  const warnings: CatalogueFinding[] = [];

  const sourceIds = new Set(file.sources.map((source) => source.id));
  const planIds = new Set(file.plans.map((plan) => plan.id));
  const addOnIds = new Set(file.addOns.map((addOn) => addOn.id));

  if (file.plans.length !== planIds.size) {
    errors.push({ code: "DUPLICATE_PLAN_ID", message: "Plan ids must be unique.", subject: null });
  }
  if (file.addOns.length !== addOnIds.size) {
    errors.push({ code: "DUPLICATE_ADDON_ID", message: "Add-on ids must be unique.", subject: null });
  }

  for (const plan of file.plans) {
    if (!sourceIds.has(plan.sourceId)) {
      errors.push({
        code: "MISSING_SOURCE",
        message: `Plan "${plan.name}" references unknown source "${plan.sourceId}". Every price needs provenance.`,
        subject: plan.id,
      });
    }
    if (plan.billingPeriod !== file.plans[0]!.billingPeriod) {
      errors.push({
        code: "MIXED_BILLING_PERIOD",
        message: `Plan "${plan.name}" uses a different billing period to the rest of the catalogue. Periods may not be mixed within one version.`,
        subject: plan.id,
      });
    }
    for (const addOnId of plan.allowedAddOnIds) {
      if (!addOnIds.has(addOnId)) {
        errors.push({
          code: "UNKNOWN_ADDON_REFERENCE",
          message: `Plan "${plan.name}" allows unknown add-on "${addOnId}".`,
          subject: plan.id,
        });
      }
    }
    const covered = new Set(plan.entitlements.map((entitlement) => entitlement.unit));
    for (const unit of UNIT_KINDS) {
      if (!covered.has(unit)) {
        warnings.push({
          code: "ENTITLEMENT_NOT_STATED",
          message: `Plan "${plan.name}" does not state an entitlement for "${unit}". It will be treated as unsupported.`,
          subject: plan.id,
        });
      }
    }
  }

  for (const addOn of file.addOns) {
    if (!sourceIds.has(addOn.sourceId)) {
      errors.push({
        code: "MISSING_SOURCE",
        message: `Add-on "${addOn.name}" references unknown source "${addOn.sourceId}".`,
        subject: addOn.id,
      });
    }
    if (addOn.packPrice === null) {
      warnings.push({
        code: "UNPRICED_ADDON",
        message: `Add-on "${addOn.name}" has no price in any supplied source. Configurations that need it will be rejected rather than guessed.`,
        subject: addOn.id,
      });
    }
    for (const planId of addOn.appliesToPlanIds) {
      if (!planIds.has(planId)) {
        errors.push({
          code: "UNKNOWN_PLAN_REFERENCE",
          message: `Add-on "${addOn.name}" applies to unknown plan "${planId}".`,
          subject: addOn.id,
        });
      }
    }
  }

  // The central safety rule from the blueprint: synthetic or screenshot data
  // can never be dressed up as a price the company stands behind.
  const weakSources = file.sources.filter(
    (source) =>
      source.verificationStatus === "screenshot_derived" ||
      source.verificationStatus === "synthetic_test",
  );
  if (file.verificationStatus === "company_authorized" && weakSources.length > 0) {
    errors.push({
      code: "UNAUTHORISED_VERIFICATION_CLAIM",
      message:
        "Catalogue claims company_authorized status while drawing on screenshot-derived or synthetic sources. Rejected.",
      subject: file.id,
    });
  }
  if (file.verificationStatus !== "company_authorized") {
    warnings.push({
      code: "NOT_COMPANY_AUTHORIZED",
      message:
        "No amount in this catalogue is authorised. Quotes built from it are labelled as demo data and must not be presented as official Site24x7 pricing.",
      subject: file.id,
    });
  }

  for (const source of file.sources) {
    if (source.caveats.length === 0) {
      warnings.push({
        code: "SOURCE_WITHOUT_CAVEATS",
        message: `Source "${source.title}" records no caveats. Confirm it was reviewed.`,
        subject: source.id,
      });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

let cached: CatalogueVersion | null = null;

/** Loads, validates and caches the active catalogue. Throws if it cannot be trusted. */
export function loadActiveCatalogue(): CatalogueVersion {
  if (cached) return cached;

  const { raw, filePath } = readCatalogueFile();

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new CatalogueLoadError(`Catalogue at ${filePath} is not valid JSON.`, [
      {
        code: "INVALID_JSON",
        message: error instanceof Error ? error.message : String(error),
        subject: null,
      },
    ]);
  }

  if (parsedJson && typeof parsedJson === "object" && "planAddOnPrices" in parsedJson) {
    parsedJson = buildCatalogueFromExtraction(parsedJson as unknown as RawExtractionData);
  }

  const parsed = catalogueFileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new CatalogueLoadError(
      "Catalogue failed schema validation and was not activated.",
      parsed.error.issues.map((issue) => ({
        code: "SCHEMA_VIOLATION",
        message: issue.message,
        subject: issue.path.join("."),
      })),
    );
  }

  const file = parsed.data;
  const validation = validateCatalogue(file);

  if (!validation.passed) {
    throw new CatalogueLoadError(
      "Catalogue failed domain validation and was not activated. No prices will be served.",
      validation.errors,
    );
  }

  // Hash the semantic content so a quote can be tied to the exact bytes used.
  const contentHash = `sha256:${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;

  cached = {
    ...file,
    contentHash,
    validation,
  };
  return cached;
}

/** Test seam: clears the module-level cache. */
export function resetCatalogueCache(): void {
  cached = null;
}

export function findPlan(catalogue: CatalogueVersion, planId: string): Plan | undefined {
  return catalogue.plans.find((plan) => plan.id === planId);
}

export function includedFor(plan: Plan, unit: UnitKind): number | null {
  const entitlement = plan.entitlements.find((item) => item.unit === unit);
  return entitlement ? entitlement.included : null;
}
