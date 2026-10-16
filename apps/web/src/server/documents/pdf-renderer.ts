import fs from "node:fs";
import path from "node:path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { Quote, EmailThread, CurrencyCode } from "@/types/domain";
import { formatMoney } from "../pricing/money.ts";

export interface RenderPdfOptions {
  quote: Quote;
  thread?: EmailThread;
  selectedOptionType?: "best_value" | "lowest_cost" | "best_coverage";
}

function formatPdfMoney(amount: number, currency: string): string {
  return formatMoney(amount, currency as CurrencyCode).replace(/₹/g, "INR ");
}

function safePdfText(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/₹/g, "INR ")
    .replace(/[—–]/g, "-")
    .replace(/•/g, "*")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x20-\x7E\n]/g, " ");
}

/**
 * Generates an official, publication-quality A4 quotation proposal PDF using pdf-lib.
 * Adheres strictly to Phase 9 requirements:
 * - Vector PDF with pdf-lib. Clean, dense 1 or 2 pages.
 * - Header: Site24x7 logo, Quote24x7 header, quote id, date, validity, thread id.
 * - Customer details if known.
 * - Requirement summary block.
 * - Itemized table: Plan base + each add-on. Columns: Item, Included, Purchased, Pack size, Packs, Annual (INR).
 * - Transparent calculation note.
 * - Terms & conditions from Screenshots/quote.png verbatim: payment upfront, taxes extra as applicable, quote valid for 30 days, orders placed through Zoho Store.
 * - Capacity points matrix dropped completely.
 * - Deterministic bytes for identical input except for timestamps.
 */
export async function renderQuotePdf(options: RenderPdfOptions): Promise<Buffer> {
  const { quote, thread, selectedOptionType = "best_value" } = options;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Quote24x7 - Proposal #${quote.id}`);
  pdfDoc.setAuthor("Quote24x7 Pricing Engine");
  pdfDoc.setSubject("Site24x7 Infrastructure Monitoring Quotation");

  // Deterministic metadata timestamps
  const fixedDate = new Date(quote.createdAt);
  pdfDoc.setCreationDate(fixedDate);
  pdfDoc.setModificationDate(fixedDate);

  const fontSans = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSansBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontSansOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  // A4 Page Dimensions (points)
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  // Selected Option
  const activeOption =
    quote.options.find((o) => o.optionType === selectedOptionType) ??
    quote.options.find((o) => o.optionType === "best_value") ??
    quote.options[0];

  if (!activeOption) {
    throw new Error(`No quotation options available for quote ${quote.id}`);
  }

  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  // Try embedding clean PNG logo if present on disk
  let logoDrawn = false;
  try {
    const candidatePaths = [
      path.resolve(process.cwd(), "public", "logo.png"),
      path.resolve(process.cwd(), "apps", "web", "public", "logo.png"),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const logoBytes = fs.readFileSync(p);
        const logoImage = await pdfDoc.embedPng(logoBytes);
        page.drawImage(logoImage, {
          x: margin,
          y: y - 26,
          width: 90,
          height: 26,
        });
        logoDrawn = true;
        break;
      }
    }
  } catch {
    logoDrawn = false;
  }

  // Brand Header
  const textStartX = logoDrawn ? margin + 98 : margin;
  page.drawText("Quote", {
    x: textStartX,
    y: y - 18,
    size: 20,
    font: fontSansBold,
    color: rgb(0, 0.44, 0.92), // #0070ea
  });

  page.drawText("24x7", {
    x: textStartX + 60,
    y: y - 18,
    size: 20,
    font: fontSansBold,
    color: rgb(0, 0.17, 0.4), // #002b66
  });

  page.drawText("Site24x7 India Sales Desk", {
    x: textStartX + 115,
    y: y - 15,
    size: 9,
    font: fontSansBold,
    color: rgb(0.35, 0.4, 0.5),
  });

  // Header Details (Right Column)
  const metaRightX = pageWidth - margin - 170;
  page.drawText(`Quote ID: #${quote.id}`, {
    x: metaRightX,
    y: y - 10,
    size: 9,
    font: fontMono,
    color: rgb(0.1, 0.1, 0.15),
  });

  const issueDateStr = fixedDate.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  page.drawText(`Date: ${issueDateStr}`, {
    x: metaRightX,
    y: y - 22,
    size: 8,
    font: fontSans,
    color: rgb(0.4, 0.4, 0.45),
  });

  const expiryDate = new Date(fixedDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiryDateStr = expiryDate.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  page.drawText(`Validity: 30 days (${expiryDateStr})`, {
    x: metaRightX,
    y: y - 33,
    size: 8,
    font: fontSans,
    color: rgb(0.4, 0.4, 0.45),
  });

  const threadIdVal = thread?.id || quote.threadId;
  page.drawText(`Thread ID: #${threadIdVal}`, {
    x: metaRightX,
    y: y - 44,
    size: 8,
    font: fontMono,
    color: rgb(0.4, 0.4, 0.45),
  });

  y -= 54;

  // Separator Line
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 1,
    color: rgb(0.85, 0.88, 0.92),
  });

  y -= 16;

  // Customer Details Block (2 Columns)
  const halfWidth = (contentWidth - 16) / 2;

  // Left: Customer Details
  page.drawText("CUSTOMER DETAILS", {
    x: margin,
    y,
    size: 8,
    font: fontSansBold,
    color: rgb(0.4, 0.45, 0.55),
  });

  const customerName = thread?.senderName || "Valued Customer";
  page.drawText(safePdfText(customerName), {
    x: margin,
    y: y - 13,
    size: 10,
    font: fontSansBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  let custOffset = 25;
  if (thread?.organisation) {
    page.drawText(safePdfText(thread.organisation), {
      x: margin,
      y: y - custOffset,
      size: 8.5,
      font: fontSans,
      color: rgb(0.3, 0.35, 0.4),
    });
    custOffset += 11;
  }

  const customerEmail = thread?.senderEmail || "Direct Inbound Request";
  page.drawText(safePdfText(customerEmail), {
    x: margin,
    y: y - custOffset,
    size: 8,
    font: fontSans,
    color: rgb(0.4, 0.45, 0.5),
  });

  // Right: Commercial Configuration
  const rightX = margin + halfWidth + 16;
  page.drawText("COMMERCIAL SUMMARY", {
    x: rightX,
    y,
    size: 8,
    font: fontSansBold,
    color: rgb(0.4, 0.45, 0.55),
  });

  page.drawText(`Selected Plan: ${activeOption.planName}`, {
    x: rightX,
    y: y - 13,
    size: 10,
    font: fontSansBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  page.drawText(`Billing Cadence: Annual Upfront (INR) | Market: India`, {
    x: rightX,
    y: y - 25,
    size: 8,
    font: fontSans,
    color: rgb(0.3, 0.35, 0.4),
  });

  page.drawText(`Fulfillment Channel: Zoho Store (store.zoho.in)`, {
    x: rightX,
    y: y - 36,
    size: 8,
    font: fontSans,
    color: rgb(0.4, 0.45, 0.5),
  });

  y -= 52;

  // Requirement Summary Block
  const reqRows = activeOption.coverage
    .filter((c) => c.required > 0)
    .map((c) => `${c.label}: ${c.required.toLocaleString("en-IN")}`);

  const reqSummaryText =
    reqRows.length > 0 ? reqRows.join("   |   ") : "Standard baseline capacity requirements";

  page.drawRectangle({
    x: margin,
    y: y - 20,
    width: contentWidth,
    height: 20,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: rgb(0.85, 0.88, 0.93),
    borderWidth: 0.8,
  });

  page.drawText("REQUIREMENTS UNDERSTOOD:", {
    x: margin + 8,
    y: y - 13,
    size: 7.5,
    font: fontSansBold,
    color: rgb(0.1, 0.35, 0.75),
  });

  page.drawText(safePdfText(reqSummaryText), {
    x: margin + 145,
    y: y - 13,
    size: 7.5,
    font: fontSans,
    color: rgb(0.2, 0.25, 0.35),
  });

  y -= 32;

  // Section: Itemized Table
  // Columns: Item, Included, Purchased, Pack size, Packs, Annual (INR)
  page.drawText("ITEMIZED PRICING BREAKDOWN", {
    x: margin,
    y,
    size: 9.5,
    font: fontSansBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  y -= 12;

  // Table Header
  const tableHeaderHeight = 18;
  page.drawRectangle({
    x: margin,
    y: y - tableHeaderHeight,
    width: contentWidth,
    height: tableHeaderHeight,
    color: rgb(0.92, 0.94, 0.97),
  });

  const colX = {
    item: margin + 6,
    included: margin + 205,
    purchased: margin + 265,
    packSize: margin + 330,
    packs: margin + 390,
    annual: pageWidth - margin - 8,
  };

  page.drawText("Item", { x: colX.item, y: y - 12, size: 8, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Included", { x: colX.included, y: y - 12, size: 8, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Purchased", { x: colX.purchased, y: y - 12, size: 8, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Pack size", { x: colX.packSize, y: y - 12, size: 8, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Packs", { x: colX.packs, y: y - 12, size: 8, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Annual (INR)", { x: colX.annual - 60, y: y - 12, size: 8, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });

  y -= tableHeaderHeight;

  // Table Rows: Plan Base + Each Add-on
  for (const item of activeOption.lineItems) {
    const isBase = item.ruleId === "RULE-PLAN-BASE";
    const rowHeight = 18;

    const itemName = isBase ? `${activeOption.planName} base subscription (annual)` : item.description;
    const includedStr = isBase ? "Base entitlements" : String(item.includedQuantity ?? 0);
    const purchasedStr = String(item.purchasedUnits ?? (item.quantity * (item.packSize ?? 1)));
    const packSizeStr = String(item.packSize ?? 1);
    const packsStr = String(item.quantity);
    const formattedTotal = formatPdfMoney(item.lineTotal, quote.currency);

    page.drawText(safePdfText(itemName.length > 40 ? `${itemName.slice(0, 38)}...` : itemName), {
      x: colX.item,
      y: y - 11,
      size: 7.5,
      font: isBase ? fontSansBold : fontSans,
      color: rgb(0.1, 0.15, 0.2),
    });

    page.drawText(safePdfText(includedStr), {
      x: colX.included,
      y: y - 11,
      size: 7.5,
      font: fontMono,
      color: rgb(0.35, 0.4, 0.45),
    });

    page.drawText(safePdfText(purchasedStr), {
      x: colX.purchased,
      y: y - 11,
      size: 7.5,
      font: fontMono,
      color: rgb(0.15, 0.2, 0.25),
    });

    page.drawText(safePdfText(packSizeStr), {
      x: colX.packSize,
      y: y - 11,
      size: 7.5,
      font: fontMono,
      color: rgb(0.35, 0.4, 0.45),
    });

    page.drawText(safePdfText(packsStr), {
      x: colX.packs,
      y: y - 11,
      size: 7.5,
      font: fontMono,
      color: rgb(0.15, 0.2, 0.25),
    });

    // Right-aligned Annual total
    const totalWidth = fontMono.widthOfTextAtSize(formattedTotal, 8);
    page.drawText(formattedTotal, {
      x: colX.annual - totalWidth,
      y: y - 11,
      size: 8,
      font: fontMono,
      color: rgb(0.1, 0.15, 0.2),
    });

    page.drawLine({
      start: { x: margin, y: y - rowHeight },
      end: { x: pageWidth - margin, y: y - rowHeight },
      thickness: 0.5,
      color: rgb(0.88, 0.9, 0.93),
    });

    y -= rowHeight;
  }

  // Total Billed Today Row
  y -= 4;
  page.drawRectangle({
    x: margin,
    y: y - 20,
    width: contentWidth,
    height: 20,
    color: rgb(0.94, 0.96, 1.0),
    borderColor: rgb(0.75, 0.85, 0.98),
    borderWidth: 0.8,
  });

  page.drawText("TOTAL ANNUAL COST (INR):", {
    x: margin + 8,
    y: y - 14,
    size: 8.5,
    font: fontSansBold,
    color: rgb(0.05, 0.2, 0.6),
  });

  const grandTotalStr = formatPdfMoney(activeOption.total, quote.currency);
  const grandTotalWidth = fontMono.widthOfTextAtSize(grandTotalStr, 10);
  page.drawText(grandTotalStr, {
    x: colX.annual - grandTotalWidth,
    y: y - 14,
    size: 10,
    font: fontMono,
    color: rgb(0.05, 0.2, 0.6),
  });

  y -= 26;

  // Transparent calculation note
  page.drawText("Add-on rates reflect the plan-specific per-year pricing from the Zoho Store.", {
    x: margin + 4,
    y,
    size: 7.5,
    font: fontSansOblique,
    color: rgb(0.4, 0.45, 0.5),
  });

  y -= 14;

  // Comparison Line (when applicable)
  const lowestCost = quote.options.find((o) => o.optionType === "lowest_cost");
  if (lowestCost && lowestCost.planId !== activeOption.planId) {
    const feature =
      activeOption.whatItAdds && activeOption.whatItAdds.length > 0
        ? activeOption.whatItAdds[0]
        : "faster polling and additional check capacity";
    const compText = `A lighter configuration on ${lowestCost.planName} would cost ${formatPdfMoney(lowestCost.total, quote.currency)}, but leaves no headroom for ${feature}.`;

    page.drawRectangle({
      x: margin,
      y: y - 18,
      width: contentWidth,
      height: 18,
      color: rgb(0.99, 0.98, 0.93),
      borderColor: rgb(0.93, 0.87, 0.7),
      borderWidth: 0.8,
    });

    page.drawText(safePdfText(compText), {
      x: margin + 8,
      y: y - 12,
      size: 7.5,
      font: fontSans,
      color: rgb(0.45, 0.3, 0.05),
    });

    y -= 24;
  }

  y -= 6;

  // Terms & Conditions Block from quote.png verbatim
  page.drawText("TERMS & CONDITIONS", {
    x: margin,
    y,
    size: 8.5,
    font: fontSansBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  y -= 11;

  const termsLines = [
    "1. Validity prices are open for acceptance for 30 days from quote date. Please re-confirm the prices after the expiry date before sending your purchase order.",
    "2. Payment Terms 100% due to ZOHO Corp after downloading the software with an official software key that is provided by ZOHO Corp. Orders placed through Zoho Store.",
    "3. Cost is in INR unless specified. Local Taxes extra as applicable.",
    "4. For other detail terms and conditions, Privacy policy & security visit: https://www.site24x7.com/privacypolicy.html | https://www.site24x7.com/terms.html | https://www.site24x7.com/security.html",
  ];

  for (const line of termsLines) {
    page.drawText(safePdfText(line), {
      x: margin + 4,
      y,
      size: 7,
      font: fontSans,
      color: rgb(0.35, 0.4, 0.45),
    });
    y -= 10;
  }

  // Footer on Page 1
  page.drawLine({
    start: { x: margin, y: 36 },
    end: { x: pageWidth - margin, y: 36 },
    thickness: 0.5,
    color: rgb(0.85, 0.88, 0.92),
  });

  page.drawText("Official Quotation Generated by Quote24x7  •  Site24x7 India  •  Checkout via Zoho Store", {
    x: margin,
    y: 25,
    size: 7,
    font: fontSans,
    color: rgb(0.4, 0.45, 0.5),
  });

  page.drawText(`Page 1 of 1  •  Ref: #${quote.id}`, {
    x: pageWidth - margin - 120,
    y: 25,
    size: 7,
    font: fontSans,
    color: rgb(0.5, 0.55, 0.6),
  });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(pdfBytes);
}
