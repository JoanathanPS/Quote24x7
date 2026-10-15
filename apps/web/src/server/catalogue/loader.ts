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

const CATALOGUE_FILE = "site24x7-in-demo-2026-10.json";

/**
 * The catalogue lives outside the Next app. Try each plausible root so the app
 * works from `apps/web` (dev and `next start`) and from the repo root.
 */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.resolve(cwd, "..", "..", "catalogues", "examples", CATALOGUE_FILE),
    path.resolve(cwd, "catalogues", "examples", CATALOGUE_FILE),
    path.resolve(cwd, "..", "catalogues", "examples", CATALOGUE_FILE),
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
