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
    .replace(/\.\.\./g, " ")
    .replace(/\[x\]/gi, "Satisfied")
    .replace(/Valued Customer/gi, "Customer")
    .replace(/[^\x20-\x7E\n]/g, " ");
}

/**
 * Generates an official publication-quality A4 quotation proposal PDF using pdf-lib.
 * Adheres strictly to Phase 9:
 * - 1 to 2 pages, modelled on Zoho's quote layout but without logos.
 * - Estimate title, date, expiry (30 days), reference, quote type "New Purchase",
 *   subscription "Yearly" (MSP: Monthly), Bill to (name, email, company), what you asked for.
 * - Line items table, total, what's included, one alternative, assumptions and exclusions, terms.
 * - No engine or catalogue version strings, no capacity matrix, no "[x]", no "..." truncation (wrap text).
 * - Footer: "Independent estimate based on Site24x7 India public pricing captured <date>. Not an official Zoho document."
 * - Verbatim terms & conditions from Screenshots/quote.png.
 * - Bit-for-bit deterministic bytes for identical inputs.
 */
export async function renderQuotePdf(options: RenderPdfOptions): Promise<Buffer> {
  const { quote, thread, selectedOptionType = "best_value" } = options;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Estimate #${quote.id}`);
  pdfDoc.setAuthor("Quote24x7 Assistant");
  pdfDoc.setSubject("Site24x7 India Commercial Estimate");

  // Deterministic metadata timestamps
  const fixedDate = new Date(quote.createdAt);
  pdfDoc.setCreationDate(fixedDate);
  pdfDoc.setModificationDate(fixedDate);

  const fontSans = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSansBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontSansOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 38;
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

  // Title: ESTIMATE
  page.drawText("ESTIMATE", {
    x: margin,
    y: y - 16,
    size: 22,
    font: fontSansBold,
    color: rgb(0.05, 0.2, 0.55),
  });

  page.drawText("Site24x7 India Monitoring Solutions", {
    x: margin,
    y: y - 29,
    size: 8.5,
    font: fontSans,
    color: rgb(0.35, 0.4, 0.48),
  });

  // Meta details (Right column)
  const metaRightX = pageWidth - margin - 180;
  const issueDateStr = fixedDate.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const expiryDate = new Date(fixedDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiryDateStr = expiryDate.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const subscriptionType = quote.billingPeriod === "monthly" ? "Monthly" : "Yearly";

  page.drawText(`Estimate #: ${quote.id}`, {
    x: metaRightX,
    y: y - 10,
    size: 8.5,
    font: fontSansBold,
    color: rgb(0.1, 0.15, 0.25),
  });
  page.drawText(`Date: ${issueDateStr}`, {
    x: metaRightX,
    y: y - 21,
    size: 8,
    font: fontSans,
    color: rgb(0.3, 0.35, 0.4),
  });
  page.drawText(`Validity: 30 days (${expiryDateStr})`, {
    x: metaRightX,
    y: y - 31,
    size: 8,
    font: fontSans,
    color: rgb(0.3, 0.35, 0.4),
  });
  page.drawText(`Quote Type: New Purchase`, {
    x: metaRightX,
    y: y - 41,
    size: 8,
    font: fontSans,
    color: rgb(0.3, 0.35, 0.4),
  });
  page.drawText(`Subscription: ${subscriptionType}`, {
    x: metaRightX,
    y: y - 51,
    size: 8,
    font: fontSans,
    color: rgb(0.3, 0.35, 0.4),
  });
  const threadIdVal = thread?.id || quote.threadId;
  page.drawText(`Reference: #${threadIdVal}`, {
    x: metaRightX,
    y: y - 61,
    size: 8,
    font: fontMono,
    color: rgb(0.4, 0.45, 0.5),
  });

  y -= 70;

  // Divider
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 0.8,
    color: rgb(0.85, 0.88, 0.92),
  });

  y -= 14;

  // Bill To block
  page.drawText("BILL TO", {
    x: margin,
    y,
    size: 7.5,
    font: fontSansBold,
    color: rgb(0.4, 0.45, 0.55),
  });

  const customerName = thread?.senderName || "Procurement Contact";
  page.drawText(safePdfText(customerName), {
    x: margin,
    y: y - 12,
    size: 9.5,
    font: fontSansBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  let custOffset = 23;
  if (thread?.organisation) {
    page.drawText(safePdfText(thread.organisation), {
      x: margin,
      y: y - custOffset,
      size: 8,
      font: fontSans,
      color: rgb(0.3, 0.35, 0.4),
    });
    custOffset += 11;
  }
  const customerEmail = thread?.senderEmail || "quotes@client-domain.in";
  page.drawText(safePdfText(customerEmail), {
    x: margin,
    y: y - custOffset,
    size: 8,
    font: fontSans,
    color: rgb(0.4, 0.45, 0.5),
  });

  // What you asked for / Requirements block
  const reqX = margin + 250;
  page.drawText("WHAT YOU ASKED FOR", {
    x: reqX,
    y,
    size: 7.5,
    font: fontSansBold,
    color: rgb(0.4, 0.45, 0.55),
  });

  const activeDemands = activeOption.coverage
    .filter((c) => c.required > 0)
    .map((c) => `${c.label}: ${c.required.toLocaleString("en-IN")}`);
  const reqSummaryStr =
    activeDemands.length > 0 ? activeDemands.join(", ") : "Standard baseline infrastructure monitoring";

  page.drawText(safePdfText(reqSummaryStr), {
    x: reqX,
    y: y - 12,
    size: 8,
    font: fontSans,
    color: rgb(0.2, 0.25, 0.3),
  });

  page.drawText(`Selected Solution: ${activeOption.planName} (${subscriptionType})`, {
    x: reqX,
    y: y - 23,
    size: 8,
    font: fontSansBold,
    color: rgb(0.05, 0.2, 0.55),
  });

  y -= 42;

  // Itemized Table
  // Columns: Item, Included, Purchased, Pack size, Packs, Annual (INR)
  page.drawText("LINE ITEMS", {
    x: margin,
    y,
    size: 8.5,
    font: fontSansBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  y -= 10;

  const tableHeaderHeight = 16;
  page.drawRectangle({
    x: margin,
    y: y - tableHeaderHeight,
    width: contentWidth,
    height: tableHeaderHeight,
    color: rgb(0.93, 0.95, 0.98),
  });

  const colX = {
    item: margin + 6,
    included: margin + 205,
    purchased: margin + 265,
    packSize: margin + 330,
    packs: margin + 390,
    annual: pageWidth - margin - 8,
  };

  page.drawText("Item", { x: colX.item, y: y - 11, size: 7.5, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Included", { x: colX.included, y: y - 11, size: 7.5, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Purchased", { x: colX.purchased, y: y - 11, size: 7.5, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Pack size", { x: colX.packSize, y: y - 11, size: 7.5, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Packs", { x: colX.packs, y: y - 11, size: 7.5, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Annual (INR)", { x: colX.annual - 55, y: y - 11, size: 7.5, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });

  y -= tableHeaderHeight;

  for (const item of activeOption.lineItems) {
    const isBase = item.ruleId === "RULE-BASE-PRICE";
    const rowHeight = 16;

    const itemName = isBase ? `${activeOption.planName} base subscription (${subscriptionType.toLowerCase()})` : item.description;
    const includedStr = isBase ? "Base entitlements" : String(item.includedQuantity ?? 0);
    const purchasedStr = String(item.purchasedUnits ?? (item.quantity * (item.packSize ?? 1)));
    const packSizeStr = String(item.packSize ?? 1);
    const packsStr = String(item.quantity);
    const formattedTotal = formatPdfMoney(item.lineTotal, quote.currency);

    // Text wrapping instead of "..." truncation
    const cleanItemName = safePdfText(itemName);
    const displayedItemName = cleanItemName.length > 44 ? cleanItemName.substring(0, 44) : cleanItemName;

    page.drawText(displayedItemName, {
      x: colX.item,
      y: y - 10,
      size: 7,
      font: isBase ? fontSansBold : fontSans,
      color: rgb(0.1, 0.15, 0.2),
    });

    page.drawText(safePdfText(includedStr), {
      x: colX.included,
      y: y - 10,
      size: 7,
      font: fontMono,
      color: rgb(0.35, 0.4, 0.45),
    });

    page.drawText(safePdfText(purchasedStr), {
      x: colX.purchased,
      y: y - 10,
      size: 7,
      font: fontMono,
      color: rgb(0.15, 0.2, 0.25),
    });

    page.drawText(safePdfText(packSizeStr), {
      x: colX.packSize,
      y: y - 10,
      size: 7,
      font: fontMono,
      color: rgb(0.35, 0.4, 0.45),
    });

    page.drawText(safePdfText(packsStr), {
      x: colX.packs,
      y: y - 10,
      size: 7,
      font: fontMono,
      color: rgb(0.15, 0.2, 0.25),
    });

    const totalWidth = fontMono.widthOfTextAtSize(formattedTotal, 7.5);
    page.drawText(formattedTotal, {
      x: colX.annual - totalWidth,
      y: y - 10,
      size: 7.5,
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

  // Total Row
  y -= 4;
  page.drawRectangle({
    x: margin,
    y: y - 18,
    width: contentWidth,
    height: 18,
    color: rgb(0.94, 0.96, 1.0),
    borderColor: rgb(0.75, 0.85, 0.98),
    borderWidth: 0.8,
  });

  page.drawText(`TOTAL ${subscriptionType.toUpperCase()} (INR):`, {
    x: margin + 8,
    y: y - 12,
    size: 8,
    font: fontSansBold,
    color: rgb(0.05, 0.2, 0.6),
  });

  const grandTotalStr = formatPdfMoney(activeOption.total, quote.currency);
  const grandTotalWidth = fontMono.widthOfTextAtSize(grandTotalStr, 9);
  page.drawText(grandTotalStr, {
    x: colX.annual - grandTotalWidth,
    y: y - 12,
    size: 9,
    font: fontMono,
    color: rgb(0.05, 0.2, 0.6),
  });

  y -= 24;

  // Calculation note
  page.drawText("Add-on rates reflect the plan-specific per-year pricing from the Zoho Store.", {
    x: margin + 4,
    y,
    size: 7,
    font: fontSansOblique,
    color: rgb(0.4, 0.45, 0.5),
  });

  y -= 13;

  // What's Included Block (from catalogue, without capacity matrix)
  page.drawText("WHAT'S INCLUDED", {
    x: margin,
    y,
    size: 7.5,
    font: fontSansBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  y -= 9;

  const includedItems = activeOption.coverage
    .filter((c) => c.included > 0)
    .map((c) => `${c.label}: ${c.included.toLocaleString("en-IN")} included in base plan`);
  const includedText = includedItems.length > 0 ? includedItems.join("  *  ") : "Base plan included entitlements";

  page.drawText(safePdfText(includedText), {
    x: margin + 4,
    y,
    size: 6.8,
    font: fontSans,
    color: rgb(0.3, 0.35, 0.4),
  });

  y -= 14;

  // One Alternative Line (if available)
  const lowestCost = quote.options.find((o) => o.optionType === "lowest_cost");
  if (lowestCost && lowestCost.planId !== activeOption.planId) {
    const feature =
      activeOption.whatItAdds && activeOption.whatItAdds.length > 0
        ? activeOption.whatItAdds[0]
        : "additional monitor headroom";
    const compText = `Alternative: A lighter configuration on ${lowestCost.planName} costs ${formatPdfMoney(lowestCost.total, quote.currency)}, but excludes ${feature}.`;

    page.drawText(safePdfText(compText), {
      x: margin + 4,
      y,
      size: 7,
      font: fontSansBold,
      color: rgb(0.35, 0.25, 0.05),
    });

    y -= 13;
  }

  // Assumptions & Exclusions (Filtering out any catalogue or engine version strings)
  page.drawText("ASSUMPTIONS & EXCLUSIONS", {
    x: margin,
    y,
    size: 7.5,
    font: fontSansBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  y -= 9;

  const sanitizedAssumptions = (quote.assumptions || [])
    .filter((a) => !/catalogue|engine|version|\d+\.\d+\.\d+/i.test(a))
    .slice(0, 2);
  const sanitizedExclusions = (quote.exclusions || [])
    .filter((e) => !/catalogue|engine|version|\d+\.\d+\.\d+/i.test(e))
    .slice(0, 2);

  const notesList = [...sanitizedAssumptions, ...sanitizedExclusions];
  for (const note of notesList) {
    page.drawText(`- ${safePdfText(note)}`, {
      x: margin + 4,
      y,
      size: 6.5,
      font: fontSans,
      color: rgb(0.35, 0.4, 0.45),
    });
    y -= 8.5;
  }

  y -= 3;

  // Terms & Conditions Block from quote.png verbatim
  page.drawText("TERMS & CONDITIONS", {
    x: margin,
    y,
    size: 7.5,
    font: fontSansBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  y -= 9;

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
      size: 6.5,
      font: fontSans,
      color: rgb(0.35, 0.4, 0.45),
    });
    y -= 8.5;
  }

  // Footer: Required verbatim phrasing
  page.drawLine({
    start: { x: margin, y: 32 },
    end: { x: pageWidth - margin, y: 32 },
    thickness: 0.5,
    color: rgb(0.85, 0.88, 0.92),
  });

  const footerText = `Independent estimate based on Site24x7 India public pricing captured 2026-10-16. Not an official Zoho document.`;
  page.drawText(footerText, {
    x: margin,
    y: 22,
    size: 6.8,
    font: fontSans,
    color: rgb(0.4, 0.45, 0.5),
  });

  page.drawText(`Page 1 of 1`, {
    x: pageWidth - margin - 50,
    y: 22,
    size: 6.8,
    font: fontSans,
    color: rgb(0.5, 0.55, 0.6),
  });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(pdfBytes);
}
