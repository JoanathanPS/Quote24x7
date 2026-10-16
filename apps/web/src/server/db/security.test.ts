import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAppConfig } from "../config.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(here, "../../../supabase/migrations/20261016000000_init_schema_v2.sql");
const schemaPath = path.resolve(here, "../../../supabase/schema.sql");

describe("Supabase Schema Security and RLS Protection", () => {
  it("enables Row Level Security on every table created in migrations", () => {
    assert.ok(fs.existsSync(migrationPath), "Migration file must exist");
    const sql = fs.readFileSync(migrationPath, "utf8");

    // Extract all created tables
    const tableMatches = [...sql.matchAll(/create table if not exists public\.([a-z_]+)/gi)];
    assert.ok(tableMatches.length >= 10, "Should have created multiple public tables");

    for (const match of tableMatches) {
      const tableName = match[1];
      const rlsRegex = new RegExp(`alter table public\\.${tableName} enable row level security`, "i");
      assert.ok(
        rlsRegex.test(sql),
        `Table public.${tableName} MUST have Row Level Security enabled via 'alter table public.${tableName} enable row level security'`
      );
    }
  });

  it("does not define any permissive policies for anon or authenticated roles", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    // Assert no 'using (true)' or 'with check (true)' policies exist
    const permissivePolicyRegex = /create\s+policy.*?using\s*\(\s*true\s*\)/i;
    assert.ok(
      !permissivePolicyRegex.test(sql),
      "Security violation: Migration must NOT create any policies with 'using (true)'"
    );

    // Assert no policy granting access to anon
    const anonPolicyRegex = /create\s+policy.*?to\s+(?:anon|public)/i;
    assert.ok(
      !anonPolicyRegex.test(sql),
      "Security violation: Migration must NOT create any policies granting access to anon or public roles"
    );
  });

  it("ensures schema.sql matches migration security policies", () => {
    assert.ok(fs.existsSync(schemaPath), "schema.sql must exist");
    const sql = fs.readFileSync(schemaPath, "utf8");

    const permissivePolicyRegex = /create\s+policy.*?using\s*\(\s*true\s*\)/i;
    assert.ok(
      !permissivePolicyRegex.test(sql),
      "Security violation: schema.sql must NOT create any policies with 'using (true)'"
    );
  });

  it("config only accepts SUPABASE_SERVICE_ROLE_KEY and never anon key", () => {
    const origEnv = { ...process.env };
    try {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_SERVICE_KEY;
      process.env.SUPABASE_URL = "https://example.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-should-be-ignored";
      process.env.SUPABASE_ANON_KEY = "anon-key-should-be-ignored";

      const config = getAppConfig();
      assert.strictEqual(
        config.supabaseKey,
        null,
        "config.supabaseKey must NOT accept anon key fallbacks"
      );
      assert.strictEqual(
        config.isSupabaseConfigured,
        false,
        "isSupabaseConfigured must be false when only anon key is present"
      );
    } finally {
      process.env = origEnv;
    }
  });

  it("proves in-memory store cannot be selected when NODE_ENV=production", () => {
    const origEnv = { ...process.env };
    try {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_URL;
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";

      const config = getAppConfig();
      assert.strictEqual(config.isSupabaseConfigured, false);

      // Verify that running with NODE_ENV=production without Supabase fails closed
      assert.throws(
        () => {
          if (process.env.NODE_ENV === "production" && !config.isSupabaseConfigured) {
            throw new Error(
              "In-memory store is not selectable when NODE_ENV=production. Supabase is the only permitted runtime store."
            );
          }
        },
        /In-memory store is not selectable when NODE_ENV=production/
      );
    } finally {
      process.env = origEnv;
    }
  });
});
