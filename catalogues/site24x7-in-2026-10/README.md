# Site24x7 India pricing catalogue — 2026.10.0

Verbatim capture of Site24x7 India pricing. Every figure here was read directly
from the supplied PDFs. Nothing is derived, averaged, divided or inferred.

## Files

| File | Role |
|---|---|
| `extraction.json` | The capture. Reviewable by eye against the source screenshots. |
| `../../apps/web/supabase/seed-catalogue-in-2026-10.sql` | Generated. Never edit by hand. |

Rebuild the seed after any edit to `extraction.json`:

```bash
cd apps/web && npm run catalogue:build
```

The generator fails closed — a dangling reference, a malformed price, an add-on
priced on no plan, or two source tabs disagreeing about one SKU aborts the build
rather than emitting a seed that would quietly misprice something.

## Sources

| PDF | Surface | Used for |
|---|---|---|
| `Existing Pricing/WebsiteMonitoring.pdf` | site24x7.in | Web Uptime, Web Perf, Enterprise Plus Web |
| `Existing Pricing/Infrastructure.pdf` | site24x7.in | Lite, Professional, Enterprise |
| `Existing Pricing/AllinOne.pdf` | site24x7.in | the same three SKUs under the All-in-One tab |
| `Existing Pricing/MSP.pdf` | site24x7.in | MSP, MSP Enterprise |
| `Pricing/pricingall.pdf` | Zoho Store | **all add-on prices**, plan feature matrix |

`Existing Pricing/MyV1Pricing.pdf` is a screenshot of this app's own earlier
demo catalogue. It is not a pricing source and was not used.

The PDFs are image-only with no text layer, so figures were read visually. Each
of the store's six plan columns was cropped and read in isolation so a price
could not be attributed to the wrong plan.

## Decisions baked into this capture

**Price authority is `site24x7_public`.** The two surfaces disagree on three
plans. Month-to-month figures match everywhere; the annual-billed rate does not:

| Plan | site24x7.in (quoted) | Zoho Store (reference only) |
|---|---|---|
| Web Perf | ₹3,420 | ₹3,334.50 |
| Professional | ₹3,990 | ₹3,950.42 |
| Enterprise | ₹59,375 | ₹59,367.08 |

The store figures carry paise, indicating an account-specific prorated renewal
rather than a list price a new buyer would be offered. They are kept on each
plan as `store_price_monthly_annual_billed` and are never used for quoting.

**Quote basis is `annual_from_monthly_x12`.** Plans are published as a monthly
rate billed annually; add-ons are published per year. The annual contract value
is therefore `plan monthly × 12 + add-on annual`, computed by the pricing engine
and written into the quote's calculation trace. It is deliberately **not** a
column in the catalogue, so a derived number can never be mistaken for a
published one.

**Add-on prices are per (plan, add-on).** Zoho charges different amounts for the
same pack depending on the base plan. "500 Basic Monitors" is three prices:

| Plan | 500 Basic Monitors |
|---|---|
| Enterprise Plus Web | ₹2,81,580/yr |
| Professional | ₹4,61,700/yr |
| Enterprise | ₹7,38,720/yr |

There is no global price for any add-on, and no row means the pack is not
purchasable on that plan.

## Things to know

- **Enterprise and MSP Enterprise are quote-on-request.** Enterprise shows
  "Starts at ₹59,375" behind a Request Price Quote action, so its figure is a
  floor (`price_is_floor`), not a quotable total. The engine routes these to
  human review instead of inventing a number.
- **Zero is a real price.** Basic and Advanced Additional Check are genuinely
  ₹0 on Enterprise.
- **Alert Credits are priced per credit, not per pack** — ₹28.50 on
  WebUptimePack, ₹19 on Enterprise Plus Web.
- **Lite, Professional and Enterprise are one SKU each, marketed under two
  tabs.** The store shows exactly one column per plan at a single price, so
  family membership is many-to-many. Modelling the tabs as separate plans would
  have duplicated one SKU.
- **The store matrix renders the literal string `undefined`** for the Mobile
  Runs and 10GB Log Forwarding rows; those cells carry no data. 10GB Log
  Forwarding does appear with a real price (₹950/unit/year) in the add-on price
  grid for Professional and Enterprise, which is the source used.

## Not yet captured

The store's tick/cross compatibility matrix (`catalogue_plan_addon_compat`) and
the non-billable feature matrix (`catalogue_feature_matrix`) are not seeded.
Purchasability is currently defined by the presence of a price row, which is the
stronger signal — a pack the engine cannot price is a pack it cannot quote. The
matrix would only add "allowed but unpriced" information.

## Contents

22 units · 6 sources · 4 families · 8 plans · 45 entitlements · 87 add-on packs ·
176 plan/add-on price rows
