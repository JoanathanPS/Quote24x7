import test from "node:test";
import assert from "node:assert/strict";

import { loadActiveCatalogue } from "../catalogue/loader.ts";
import { formatCatalogueProjection } from "./context-builder.ts";
import { DEMAND_UNITS, UNIT_LABELS } from "../pricing/engine.ts";

test("Catalogue projection states that top-up packs exist for each unit with priced packs", () => {
  const catalogue = loadActiveCatalogue();
  const projection = formatCatalogueProjection(catalogue);

  // Must not claim packs have no usable price for units with active store prices
  assert.ok(
    !projection.includes("packs of none usable"),
    "Projection must not state 'packs of none usable' when priced add-ons exist",
  );

  // Every billable unit with priced packs must explicitly indicate top-up packs exist
  for (const unit of DEMAND_UNITS) {
    const unitLabel = UNIT_LABELS[unit];
    assert.match(
      projection,
      new RegExp(`-\\s+${unitLabel.replace(/[/]/g, "\\/")}:\\s+top-up packs exist`),
      `Projection must state top-up packs exist for ${unitLabel}`,
    );
  }

  // Key plans must indicate +topup availability
  assert.match(projection, /id=plan_lite \| Lite \|.*Host monitors=2\+topup/);
  assert.match(projection, /id=plan_professional \| Professional \|.*Host monitors=5\+topup/);
  assert.match(projection, /id=plan_professional \| Professional \|.*AppLogs GB \/ month=4\+topup/);
});
