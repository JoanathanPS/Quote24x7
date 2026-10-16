import fs from "node:fs";

const raw = fs.readFileSync("../../catalogues/site24x7-in-2026-10/extraction.json", "utf8");
const d = JSON.parse(raw);

console.log("=== Base Plans: Annual vs Monthly Check (year == monthly * 12 * 0.9) ===");
for (const p of d.plans) {
  if (p.priceMonthToMonth && p.priceMonthlyAnnualBilled) {
    const m2mMonthly = parseFloat(p.priceMonthToMonth);
    const billedAnnualMonthly = parseFloat(p.priceMonthlyAnnualBilled);
    const annualTotal = billedAnnualMonthly * 12;
    const expectedAnnual = m2mMonthly * 12 * 0.9;
    const match = Math.abs(annualTotal - expectedAnnual) < 0.1;
    console.log(
      `Plan ${p.name.padEnd(20)}: M2M=₹${m2mMonthly}/mo, AnnualRate=₹${billedAnnualMonthly}/mo, YearTotal=₹${annualTotal}, Expected(M2M*12*0.9)=₹${expectedAnnual} -> ${match ? "MATCH" : "MISMATCH"}`
    );
  }
}

console.log("\n=== Add-On Rates Check ===");
console.log("Zoho Store grid (pricingall.pdf) publishes add-on packs exclusively with annual rates (₹/year).");
console.log("Public pricing pages publish add-on rates as monthly list rates.");
