-- ==============================================================================
-- Quote24x7 catalogue verification
-- Run in the Supabase SQL Editor AFTER schema.sql and seed-catalogue-in-2026-10.sql.
--
-- Every check below should report OK. Anything reporting FAIL means the seed did
-- not land correctly and the pricing engine must not be pointed at it.
-- ==============================================================================

-- 1. Row counts. Expected: 22 units, 6 sources, 4 families, 8 plans,
--    11 family memberships, 45 entitlements, 87 add-ons, 99 grants, 176 prices.
--    (99 grants = 75 single-unit packs + 12 compound packs granting 2 units each.)
select 'row counts' as check, * from (
  select
    (select count(*) from public.catalogue_units)               as units,
    (select count(*) from public.catalogue_sources)             as sources,
    (select count(*) from public.catalogue_plan_families)       as families,
    (select count(*) from public.catalogue_plans)               as plans,
    (select count(*) from public.catalogue_plan_family_members) as family_members,
    (select count(*) from public.catalogue_plan_entitlements)   as entitlements,
    (select count(*) from public.catalogue_addons)              as addons,
    (select count(*) from public.catalogue_addon_grants)        as grants,
    (select count(*) from public.catalogue_plan_addon_prices)   as prices
) t;

-- 2. Exactly one active catalogue for IN/INR.
select case when count(*) = 1 then 'OK' else 'FAIL' end as active_catalogue_check,
       count(*) as active_versions
from public.catalogue_versions
where market = 'IN' and currency = 'INR' and status = 'active';

-- 3. The headline proof of plan-scoped pricing: one pack, three prices.
--    Expected: Enterprise Plus Web 281580.00, Professional 461700.00, Enterprise 738720.00
select p.name as plan,
       a.name as addon,
       (pap.price / 100.0) as price_inr_per_year
from public.catalogue_plan_addon_prices pap
join public.catalogue_plans p  on p.id = pap.plan_id
join public.catalogue_addons a on a.id = pap.addon_id
where a.id = 'addon_basic_500'
order by pap.price;

-- 4. Plans as they will be quoted. quote_on_request = true must never be
--    auto-totalled; price_is_floor marks a "Starts at" figure.
--    annual_contract_inr below is the engine's x12 basis, shown here for review
--    only -- it is deliberately not stored in the catalogue.
select p.display_order,
       p.name,
       string_agg(f.tab_label, ' + ' order by f.display_order) as families,
       (p.price_monthly_annual_billed / 100.0) as monthly_annual_billed_inr,
       (p.price_month_to_month / 100.0)        as month_to_month_inr,
       (p.price_monthly_annual_billed * 12 / 100.0) as annual_contract_inr,
       p.quote_on_request,
       p.price_is_floor,
       (p.store_price_monthly_annual_billed / 100.0) as store_reference_inr
from public.catalogue_plans p
join public.catalogue_plan_family_members fm on fm.plan_id = p.id
join public.catalogue_plan_families f       on f.id = fm.family_id
group by p.id, p.name, p.display_order, p.price_monthly_annual_billed,
         p.price_month_to_month, p.quote_on_request, p.price_is_floor,
         p.store_price_monthly_annual_billed
order by min(f.display_order), p.display_order;

-- 5. Where the two sources disagree. Expected exactly 3 rows:
--    Web Perf, Professional, Enterprise.
select name,
       (price_monthly_annual_billed / 100.0)       as quoted_public_inr,
       (store_price_monthly_annual_billed / 100.0) as store_reference_inr
from public.catalogue_plans
where store_price_monthly_annual_billed is not null
  and store_price_monthly_annual_billed <> price_monthly_annual_billed
order by name;

-- 6. No add-on may exist without a price on at least one plan (dead data).
select case when count(*) = 0 then 'OK' else 'FAIL' end as unpriced_addon_check,
       coalesce(string_agg(a.id, ', '), '(none)') as offenders
from public.catalogue_addons a
where not exists (
  select 1 from public.catalogue_plan_addon_prices pap where pap.addon_id = a.id
);

-- 7. No add-on may exist without granting at least one unit.
select case when count(*) = 0 then 'OK' else 'FAIL' end as grantless_addon_check,
       coalesce(string_agg(a.id, ', '), '(none)') as offenders
from public.catalogue_addons a
where not exists (
  select 1 from public.catalogue_addon_grants g where g.addon_id = a.id
);

-- 8. Zero is a real published price, not a missing value.
--    Expected: Enterprise / Basic Additional Check and Advanced Additional Check.
select p.name as plan, a.name as addon, pap.price as price_paise
from public.catalogue_plan_addon_prices pap
join public.catalogue_plans p  on p.id = pap.plan_id
join public.catalogue_addons a on a.id = pap.addon_id
where pap.price = 0
order by p.name, a.name;

-- 9. Alert Credits are priced per credit and differ by plan.
--    Expected: Web Uptime 28.50, Enterprise Plus Web 19.00
select p.name as plan, (pap.price / 100.0) as price_inr_per_credit, pap.billing_period
from public.catalogue_plan_addon_prices pap
join public.catalogue_plans p on p.id = pap.plan_id
where pap.addon_id = 'addon_alert_credit'
order by pap.price desc;

-- 10. Every plan that is quotable must have at least one purchasable add-on,
--     otherwise the engine can never top it up to meet demand.
select p.id, p.name, count(pap.addon_id) as purchasable_addons
from public.catalogue_plans p
left join public.catalogue_plan_addon_prices pap on pap.plan_id = p.id
group by p.id, p.name
order by purchasable_addons;
