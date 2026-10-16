import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  here,
  "../../../supabase/migrations/20261016000002_seed_licence_rules_and_knowledge.sql"
);

describe("Phase 4: Licence Rules and Knowledge Base Seed", () => {
  it("verifies licence rules migration seeds all 7 required regulatory rule types", () => {
    assert.ok(fs.existsSync(migrationPath), "Migration file must exist");
    const sql = fs.readFileSync(migrationPath, "utf8");

    const requiredRules = [
      "MIN_MONITOR_FREQUENCY",
      "MIN_LOG_RETENTION",
      "ALERT_CREDIT_CONSUMPTION",
      "NETWORK_COMPONENT_LICENSING",
      "ADVANCED_MONITOR_DEFINITION",
      "BASIC_MONITOR_DEFINITION",
      "ENTERPRISE_HANDOFF_THRESHOLD",
    ];

    for (const rule of requiredRules) {
      assert.ok(
        sql.includes(rule),
        `Migration must seed licence rule code: ${rule}`
      );
    }
  });

  it("verifies knowledge snippets seed contains India data residency, GST, payment, and deployment", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    const requiredTopics = [
      "ks_data_residency_india",
      "ks_support_tiers_india",
      "ks_payment_terms_inr",
      "ks_gst_compliance_india",
      "ks_deployment_architecture",
      "ks_onboarding_trial",
    ];

    for (const snippetId of requiredTopics) {
      assert.ok(
        sql.includes(snippetId),
        `Migration must seed knowledge snippet: ${snippetId}`
      );
    }

    assert.ok(sql.includes("Karapakkam, Chennai, Tamil Nadu"), "Must include Chennai data center residency");
    assert.ok(sql.includes("18%"), "Must include 18% GST specification");
    assert.ok(sql.includes("30-day free trial"), "Must include 30-day trial onboarding");
    assert.ok(sql.includes("CERT-In"), "Must include CERT-In compliance reference");
  });
});
