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
 * Generates a multi-page, publication-quality A4 quotation proposal PDF using pdf-lib.
 * Returns a Buffer ready for email attachment or HTTP download.
 */
export async function renderQuotePdf(options: RenderPdfOptions): Promise<Buffer> {
  const { quote, thread, selectedOptionType = "best_value" } = options;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Quote24x7 - Proposal #${quote.id}`);
  pdfDoc.setAuthor("Quote24x7 Pricing Engine");
  pdfDoc.setSubject("Site24x7 Infrastructure Monitoring Quotation");
  pdfDoc.setCreationDate(new Date(quote.createdAt));

  const fontSans = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSansBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontSansOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  // A4 Page Dimensions in points (72 points per inch)
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 45;
  const contentWidth = pageWidth - margin * 2;

  // Selected Option
  const activeOption =
    quote.options.find((o) => o.optionType === selectedOptionType) ??
    quote.options.find((o) => o.optionType === "best_value") ??
    quote.options[0];

  if (!activeOption) {
    throw new Error(`No quotation options available for quote ${quote.id}`);
  }

  // --- PAGE 1: Executive Summary, Options Comparison, Line Items ---
  const page1 = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  // Header Banner with brand styling
  page1.drawText("Quote", {
    x: margin,
    y: y - 16,
    size: 20,
    font: fontSansBold,
    color: rgb(0, 0.44, 0.92), // #0070ea vivid blue
  });

  page1.drawText("24x7", {
    x: margin + 63,
    y: y - 16,
    size: 20,
    font: fontSansBold,
    color: rgb(0, 0.17, 0.4), // #002b66 deep navy
  });

  page1.drawText("Commercial Proposal", {
    x: margin + 125,
    y: y - 14,
    size: 9,
    font: fontSansBold,
    color: rgb(0.4, 0.45, 0.55),
  });

  // Reference & Date on right
  page1.drawText(`Reference: #${quote.id}`, {
    x: pageWidth - margin - 150,
    y: y - 10,
    size: 9,
    font: fontMono,
    color: rgb(0.1, 0.1, 0.1),
  });

  const issueDateStr = new Date(quote.createdAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  page1.drawText(`Issue Date: ${issueDateStr}`, {
    x: pageWidth - margin - 150,
    y: y - 22,
    size: 8,
    font: fontSans,
    color: rgb(0.4, 0.4, 0.4),
  });

  page1.drawText("Status: Preliminary Estimate (Non-binding)", {
    x: pageWidth - margin - 180,
    y: y - 34,
    size: 8,
    font: fontSansBold,
    color: rgb(0.75, 0.45, 0.05),
  });

  y -= 46;

  // Separator line
  page1.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 1,
    color: rgb(0.85, 0.87, 0.9),
  });

  y -= 16;

  // Legal Notice Box
  const noticeBoxHeight = 32;
  page1.drawRectangle({
    x: margin,
    y: y - noticeBoxHeight,
    width: contentWidth,
    height: noticeBoxHeight,
    color: rgb(0.99, 0.97, 0.93),
    borderColor: rgb(0.92, 0.85, 0.7),
    borderWidth: 0.8,
  });

  page1.drawText(
    `DEMO ESTIMATE: Calculated by Quote24x7 using unverified demo catalogue (v${quote.catalogueVersion}).`,
    {
      x: margin + 10,
      y: y - 13,
      size: 7.5,
      font: fontSansBold,
      color: rgb(0.55, 0.35, 0.05),
    }
  );
  page1.drawText(
    "Preliminary sizing estimate for planning purposes. Does not constitute an authorized commercial offer by Zoho Corporation.",
    {
      x: margin + 10,
      y: y - 24,
      size: 7.5,
      font: fontSans,
      color: rgb(0.55, 0.35, 0.05),
    }
  );

  y -= noticeBoxHeight + 18;

  // Parties Box (2 columns)
  const colWidth = (contentWidth - 20) / 2;

  // Left Column: Customer
  page1.drawText("PREPARED FOR", {
    x: margin,
    y,
    size: 8,
    font: fontSansBold,
    color: rgb(0.45, 0.5, 0.55),
  });
  y -= 12;
  const customerName = thread?.senderName || "Valued Customer";
  page1.drawText(safePdfText(customerName), {
    x: margin,
    y,
    size: 11,
    font: fontSansBold,
    color: rgb(0.1, 0.1, 0.15),
  });
  y -= 11;
  if (thread?.organisation) {
    page1.drawText(safePdfText(thread.organisation), {
      x: margin,
      y,
      size: 9,
      font: fontSans,
      color: rgb(0.3, 0.35, 0.4),
    });
    y -= 11;
  }
  page1.drawText(safePdfText(thread?.senderEmail || "Customer Email"), {
    x: margin,
    y,
    size: 8.5,
    font: fontSans,
    color: rgb(0.4, 0.45, 0.5),
  });

  // Right Column: Commercial Terms
  const rightColX = margin + colWidth + 20;
  let rightY = y + (thread?.organisation ? 34 : 23);

  page1.drawText("COMMERCIAL TERMS", {
    x: rightColX,
    y: rightY,
    size: 8,
    font: fontSansBold,
    color: rgb(0.45, 0.5, 0.55),
  });
  rightY -= 12;
  page1.drawText(
    `Billing: ${quote.billingPeriod === "annual" ? "Annual" : "Monthly"}  |  Currency: ${quote.currency}  |  Market: ${quote.market}`,
    {
      x: rightColX,
      y: rightY,
      size: 8.5,
      font: fontSansBold,
      color: rgb(0.15, 0.15, 0.2),
    }
  );
  rightY -= 11;
  page1.drawText(`Catalogue: ${quote.catalogueVersion} (Engine ${quote.calculationVersion})`, {
    x: rightColX,
    y: rightY,
    size: 8,
    font: fontMono,
    color: rgb(0.4, 0.45, 0.5),
  });

  y = Math.min(y, rightY) - 18;

  // Section 1: Three Options Summary
  page1.drawText("1. QUOTATION OPTIONS COMPARISON", {
    x: margin,
    y,
    size: 9.5,
    font: fontSansBold,
    color: rgb(0.12, 0.14, 0.2),
  });
  y -= 12;

  // Options table header
  page1.drawRectangle({
    x: margin,
    y: y - 14,
    width: contentWidth,
    height: 16,
    color: rgb(0.94, 0.95, 0.97),
  });
  page1.drawText("OPTION TIER", { x: margin + 6, y: y - 10, size: 7.5, font: fontSansBold, color: rgb(0.3, 0.35, 0.4) });
  page1.drawText("BASE PLAN", { x: margin + 110, y: y - 10, size: 7.5, font: fontSansBold, color: rgb(0.3, 0.35, 0.4) });
  page1.drawText("SELECTION RATIONALE", { x: margin + 220, y: y - 10, size: 7.5, font: fontSansBold, color: rgb(0.3, 0.35, 0.4) });
  page1.drawText("TOTAL", { x: pageWidth - margin - 70, y: y - 10, size: 7.5, font: fontSansBold, color: rgb(0.3, 0.35, 0.4) });

  y -= 16;

  // Options rows
  for (const opt of quote.options) {
    const isSelected = opt.optionType === activeOption.optionType;
    const rowHeight = 20;

    if (isSelected) {
      page1.drawRectangle({
        x: margin,
        y: y - rowHeight + 4,
        width: contentWidth,
        height: rowHeight,
        color: rgb(0.93, 0.96, 1.0),
      });
    }

    const tierLabel =
      opt.optionType === "best_value"
        ? "Best Value (Rec.)"
        : opt.optionType === "lowest_cost"
        ? "Lowest Cost"
        : "Best Coverage";

    page1.drawText(tierLabel, {
      x: margin + 6,
      y: y - 8,
      size: 8,
      font: isSelected ? fontSansBold : fontSans,
      color: isSelected ? rgb(0.1, 0.3, 0.7) : rgb(0.2, 0.2, 0.25),
    });

    page1.drawText(opt.planName, {
      x: margin + 110,
      y: y - 8,
      size: 8,
      font: fontSansBold,
      color: rgb(0.1, 0.1, 0.15),
    });

    const shortReason = safePdfText(
      opt.rankReason.length > 55 ? `${opt.rankReason.slice(0, 52)}...` : opt.rankReason
    );
    page1.drawText(shortReason, {
      x: margin + 220,
      y: y - 8,
      size: 7.5,
      font: fontSans,
      color: rgb(0.35, 0.4, 0.45),
    });

    const totalFormatted = formatPdfMoney(opt.total, quote.currency);
    page1.drawText(totalFormatted, {
      x: pageWidth - margin - 80,
      y: y - 8,
      size: 8.5,
      font: fontMono,
      color: rgb(0.1, 0.1, 0.15),
    });

    y -= rowHeight;
  }

  y -= 14;

  // Section 2: Recommended Configuration Itemized Breakdown
  page1.drawText(`2. RECOMMENDED CONFIGURATION BREAKDOWN: ${activeOption.planName.toUpperCase()}`, {
    x: margin,
    y,
    size: 9.5,
    font: fontSansBold,
    color: rgb(0.12, 0.14, 0.2),
  });
  y -= 12;

  // Line items table header
  page1.drawRectangle({
    x: margin,
    y: y - 14,
    width: contentWidth,
    height: 16,
    color: rgb(0.94, 0.95, 0.97),
  });
  page1.drawText("ITEM DESCRIPTION", { x: margin + 6, y: y - 10, size: 7.5, font: fontSansBold, color: rgb(0.3, 0.35, 0.4) });
  page1.drawText("QTY", { x: margin + 260, y: y - 10, size: 7.5, font: fontSansBold, color: rgb(0.3, 0.35, 0.4) });
  page1.drawText("UNIT SIZING", { x: margin + 295, y: y - 10, size: 7.5, font: fontSansBold, color: rgb(0.3, 0.35, 0.4) });
  page1.drawText("UNIT PRICE", { x: margin + 375, y: y - 10, size: 7.5, font: fontSansBold, color: rgb(0.3, 0.35, 0.4) });
  page1.drawText("TOTAL", { x: pageWidth - margin - 65, y: y - 10, size: 7.5, font: fontSansBold, color: rgb(0.3, 0.35, 0.4) });

  y -= 16;

  // Line items rows
  for (const item of activeOption.lineItems) {
    const rowHeight = 18;

    page1.drawText(safePdfText(item.description), {
      x: margin + 6,
      y: y - 8,
      size: 8,
      font: fontSans,
      color: rgb(0.15, 0.15, 0.2),
    });

    page1.drawText(String(item.quantity), {
      x: margin + 265,
      y: y - 8,
      size: 8,
      font: fontMono,
      color: rgb(0.2, 0.2, 0.25),
    });

    page1.drawText(safePdfText(item.unit), {
      x: margin + 295,
      y: y - 8,
      size: 7.5,
      font: fontSans,
      color: rgb(0.4, 0.45, 0.5),
    });

    page1.drawText(formatPdfMoney(item.unitPrice, quote.currency), {
      x: margin + 375,
      y: y - 8,
      size: 8,
      font: fontMono,
      color: rgb(0.2, 0.2, 0.25),
    });

    page1.drawText(formatPdfMoney(item.lineTotal, quote.currency), {
      x: pageWidth - margin - 75,
      y: y - 8,
      size: 8,
      font: fontMono,
      color: rgb(0.1, 0.1, 0.15),
    });

    page1.drawLine({
      start: { x: margin, y: y - rowHeight + 4 },
      end: { x: pageWidth - margin, y: y - rowHeight + 4 },
      thickness: 0.5,
      color: rgb(0.9, 0.92, 0.94),
    });

    y -= rowHeight;
  }

  // Subtotal & Total Rows
  y -= 4;
  page1.drawText("Subtotal:", {
    x: margin + 350,
    y: y - 8,
    size: 8.5,
    font: fontSans,
    color: rgb(0.4, 0.45, 0.5),
  });
  page1.drawText(formatPdfMoney(activeOption.subtotal, quote.currency), {
    x: pageWidth - margin - 75,
    y: y - 8,
    size: 8.5,
    font: fontMono,
    color: rgb(0.2, 0.2, 0.25),
  });

  y -= 14;
  page1.drawText("Taxes (unverified):", {
    x: margin + 310,
    y: y - 8,
    size: 8,
    font: fontSans,
    color: rgb(0.5, 0.5, 0.5),
  });
  page1.drawText("Excluded", {
    x: pageWidth - margin - 75,
    y: y - 8,
    size: 8,
    font: fontSansOblique,
    color: rgb(0.5, 0.5, 0.5),
  });

  y -= 16;
  page1.drawRectangle({
    x: margin + 280,
    y: y - 16,
    width: contentWidth - 280,
    height: 20,
    color: rgb(0.92, 0.95, 0.99),
  });

  page1.drawText(`TOTAL (${quote.billingPeriod.toUpperCase()}):`, {
    x: margin + 290,
    y: y - 11,
    size: 9.5,
    font: fontSansBold,
    color: rgb(0.1, 0.25, 0.65),
  });

  page1.drawText(formatPdfMoney(activeOption.total, quote.currency), {
    x: pageWidth - margin - 85,
    y: y - 11,
    size: 10.5,
    font: fontMono,
    color: rgb(0.05, 0.2, 0.55),
  });

  y -= 32;

  // Section 3: Capacity Fulfillment
  page1.drawText("3. WORKLOAD CAPACITY FULFILLMENT MATRIX", {
    x: margin,
    y,
    size: 9.5,
    font: fontSansBold,
    color: rgb(0.12, 0.14, 0.2),
  });
  y -= 12;

  page1.drawRectangle({
    x: margin,
    y: y - 14,
    width: contentWidth,
    height: 16,
    color: rgb(0.94, 0.95, 0.97),
  });
  page1.drawText("MONITORED METRIC", { x: margin + 6, y: y - 10, size: 7.5, font: fontSansBold, color: rgb(0.3, 0.35, 0.4) });
  page1.drawText("DEMANDED", { x: margin + 170, y: y - 10, size: 7.5, font: fontSansBold, color: rgb(0.3, 0.35, 0.4) });
  page1.drawText("BASE INCLUDED", { x: margin + 245, y: y - 10, size: 7.5, font: fontSansBold, color: rgb(0.3, 0.35, 0.4) });
  page1.drawText("VIA ADD-ONS", { x: margin + 335, y: y - 10, size: 7.5, font: fontSansBold, color: rgb(0.3, 0.35, 0.4) });
  page1.drawText("TOTAL CAPACITY", { x: margin + 415, y: y - 10, size: 7.5, font: fontSansBold, color: rgb(0.3, 0.35, 0.4) });
  page1.drawText("STATUS", { x: pageWidth - margin - 45, y: y - 10, size: 7.5, font: fontSansBold, color: rgb(0.3, 0.35, 0.4) });

  y -= 16;

  for (const cov of activeOption.coverage) {
    const rowHeight = 16;
    page1.drawText(cov.label, { x: margin + 6, y: y - 8, size: 8, font: fontSans, color: rgb(0.15, 0.15, 0.2) });
    page1.drawText(String(cov.required), { x: margin + 180, y: y - 8, size: 8, font: fontMono, color: rgb(0.2, 0.2, 0.25) });
    page1.drawText(String(cov.included), { x: margin + 255, y: y - 8, size: 8, font: fontMono, color: rgb(0.4, 0.45, 0.5) });
    page1.drawText(String(cov.viaAddOns), { x: margin + 345, y: y - 8, size: 8, font: fontMono, color: rgb(0.4, 0.45, 0.5) });
    page1.drawText(String(cov.total), { x: margin + 425, y: y - 8, size: 8, font: fontMono, color: rgb(0.1, 0.1, 0.15) });
    page1.drawText(cov.satisfied ? "[x] Satisfied" : "[!] Deficit", {
      x: pageWidth - margin - 55,
      y: y - 8,
      size: 7.5,
      font: fontSansBold,
      color: cov.satisfied ? rgb(0.1, 0.55, 0.25) : rgb(0.8, 0.2, 0.2),
    });

    page1.drawLine({
      start: { x: margin, y: y - rowHeight + 4 },
      end: { x: pageWidth - margin, y: y - rowHeight + 4 },
      thickness: 0.5,
      color: rgb(0.9, 0.92, 0.94),
    });
    y -= rowHeight;
  }

  y -= 18;

  // Assumptions & Exclusions
  page1.drawText("4. ASSUMPTIONS & EXCLUSIONS", {
    x: margin,
    y,
    size: 9.5,
    font: fontSansBold,
    color: rgb(0.12, 0.14, 0.2),
  });
  y -= 12;

  const combinedAssumptions = [
    ...(quote.assumptions || []).slice(0, 3),
    ...(quote.exclusions || []).slice(0, 2),
  ];

  for (const text of combinedAssumptions) {
    const bullet = "- ";
    const cleanText = safePdfText(text.length > 105 ? `${text.slice(0, 102)}...` : text);
    page1.drawText(bullet + cleanText, {
      x: margin + 6,
      y: y - 7,
      size: 7.5,
      font: fontSans,
      color: rgb(0.35, 0.4, 0.45),
    });
    y -= 12;
  }

  // Footer on Page 1
  page1.drawLine({
    start: { x: margin, y: 40 },
    end: { x: pageWidth - margin, y: 40 },
    thickness: 0.5,
    color: rgb(0.85, 0.87, 0.9),
  });

  page1.drawText("Official Verification & Procurement: https://quotes.joanathan.in/", {
    x: margin,
    y: 28,
    size: 7.5,
    font: fontSansBold,
    color: rgb(0.2, 0.35, 0.65),
  });

  page1.drawText(`Page 1 of 1  |  Generated by Quote24x7 v1.0.0  |  Ref: ${quote.id}`, {
    x: pageWidth - margin - 220,
    y: 28,
    size: 7.5,
    font: fontSans,
    color: rgb(0.5, 0.55, 0.6),
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
