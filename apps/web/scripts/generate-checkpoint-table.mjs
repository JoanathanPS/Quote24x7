import fs from "node:fs";

const raw = fs.readFileSync("../../catalogues/site24x7-in-2026-10/extraction.json", "utf8");
const d = JSON.parse(raw);

const litePrices = d.planAddOnPrices["plan_lite"] || {};
const proPrices = d.planAddOnPrices["plan_professional"] || {};
const entPrices = d.planAddOnPrices["plan_enterprise"] || {};

// All unique add-on IDs across these three plans, in display order
const addonOrder = d.addOns.map((a) => a.id);
const allAddonIds = addonOrder.filter(
  (id) => id in litePrices || id in proPrices || id in entPrices
);

const manualLite = {
  addon_basic_10: "10,260",
  addon_advanced_2: "15,390",
  addon_host_10: "25,650",
  addon_netcomp_10: "11,305",
  addon_pv_500k_5: "25,650",
  addon_logs_10gb: "3,135",
  addon_synth_10000: "8265",
};

const addonMap = new Map(d.addOns.map((a) => [a.id, a.name]));

console.log("| Add-On Pack Name | Lite (Store Grid) | Lite (manualaddons.jpeg) | Professional (Store Grid) | Enterprise (Store Grid) | Lite Verification |");
console.log("| :--- | :---: | :---: | :---: | :---: | :---: |");

for (const id of allAddonIds) {
  const name = addonMap.get(id) || id;
  const lite = litePrices[id]
    ? "₹" + Number(litePrices[id]).toLocaleString("en-IN")
    : "— (Not available)";
  const manual = manualLite[id]
    ? "₹" + manualLite[id]
    : litePrices[id]
      ? "Missing in manual"
      : "— (N/A)";
  const pro = proPrices[id]
    ? "₹" + Number(proPrices[id]).toLocaleString("en-IN")
    : "— (Not available)";
  const ent = entPrices[id]
    ? "₹" + Number(entPrices[id]).toLocaleString("en-IN")
    : "— (Not available)";

  let status = "—";
  if (litePrices[id]) {
    status =
      lite.replace(/,/g, "") === manual.replace(/,/g, "")
        ? "✓ Verified Match"
        : "✕ Mismatch";
  }
  console.log(`| ${name} | ${lite} | ${manual} | ${pro} | ${ent} | ${status} |`);
}
