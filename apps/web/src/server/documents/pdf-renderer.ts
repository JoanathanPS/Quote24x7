import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import type { Quote, EmailThread, CurrencyCode } from "@/types/domain";
import { formatMoney } from "../pricing/money.ts";
import { buildComparisonLine } from "../pricing/engine.ts";

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
 * Robust word-wrapping helper for pdf-lib text rendering.
 * Breaks lines at word boundaries to strictly fit maxWidth.
 * If an individual token/URL exceeds maxWidth, cleanly breaks at character boundaries.
 */
function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  const clean = text.trim();
  if (!clean) return [];

  const rawParagraphs = clean.split("\n");
  const resultLines: string[] = [];

  for (const para of rawParagraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    const words = trimmedPara.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      if (!word) continue;
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);

      if (testWidth <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          resultLines.push(currentLine);
          // Test if single word fits on a new line
          const wordWidth = font.widthOfTextAtSize(word, fontSize);
          if (wordWidth <= maxWidth) {
            currentLine = word;
          } else {
            // Very long word/URL: break character by character
            let subWord = "";
            for (const char of word) {
              if (font.widthOfTextAtSize(subWord + char, fontSize) <= maxWidth) {
                subWord += char;
              } else {
                if (subWord) resultLines.push(subWord);
                subWord = char;
              }
            }
            currentLine = subWord;
          }
        } else {
          // Empty current line and single word exceeds maxWidth
          let subWord = "";
          for (const char of word) {
            if (font.widthOfTextAtSize(subWord + char, fontSize) <= maxWidth) {
              subWord += char;
            } else {
              if (subWord) resultLines.push(subWord);
              subWord = char;
            }
          }
          currentLine = subWord;
        }
      }
    }

    if (currentLine) {
      resultLines.push(currentLine);
    }
  }

  return resultLines;
}

/**
 * Generates an official publication-quality A4 quotation proposal PDF using pdf-lib.
 * Adheres strictly to Phase 9 and user adaptive formatting requirements:
 * - 1 to 2 pages, modelled on Zoho's quote layout but without logos.
 * - Estimate title, date, expiry (30 days), reference, quote type "New Purchase",
 *   subscription "Yearly" (MSP: Monthly), Bill to (name, email, company), what you asked for.
 * - Line items table, total, what's included, one alternative, assumptions and exclusions, terms.
 * - No engine or catalogue version strings, no capacity matrix, no "[x]", no "..." truncation.
 * - Full multi-line word wrapping with adaptive vertical sizing and line spacing to eliminate cut-offs.
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

  // 1. Header: ESTIMATE & Subtitle
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

  y -= 72;

  // Header Divider
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 0.8,
    color: rgb(0.85, 0.88, 0.92),
  });

  y -= 14;

  // 2. Party & Requirements Section (Two-column layout with dynamic height)
  const partyStartY = y;

  // Left Column: BILL TO
  page.drawText("BILL TO", {
    x: margin,
    y: partyStartY,
    size: 7.5,
    font: fontSansBold,
    color: rgb(0.35, 0.42, 0.52),
  });

  const customerName = thread?.senderName || "Procurement Contact";
  page.drawText(safePdfText(customerName), {
    x: margin,
    y: partyStartY - 12,
    size: 9.5,
    font: fontSansBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  let leftCursorY = partyStartY - 24;
  if (thread?.organisation) {
    page.drawText(safePdfText(thread.organisation), {
      x: margin,
      y: leftCursorY,
      size: 8,
      font: fontSans,
      color: rgb(0.3, 0.35, 0.4),
    });
    leftCursorY -= 11;
  }
  const customerEmail = thread?.senderEmail || "quotes@client-domain.in";
  page.drawText(safePdfText(customerEmail), {
    x: margin,
    y: leftCursorY,
    size: 8,
    font: fontSans,
    color: rgb(0.4, 0.45, 0.5),
  });
  leftCursorY -= 11;
  const billToHeight = partyStartY - leftCursorY;

  // Right Column: WHAT YOU ASKED FOR (Wrapped lines + Solution)
  const reqX = margin + 240;
  const reqWidth = pageWidth - margin - reqX;

  page.drawText("WHAT YOU ASKED FOR", {
    x: reqX,
    y: partyStartY,
    size: 7.5,
    font: fontSansBold,
    color: rgb(0.35, 0.42, 0.52),
  });

  const activeDemands = activeOption.coverage
    .filter((c) => c.required > 0)
    .map((c) => `${c.label}: ${c.required.toLocaleString("en-IN")}`);
  const reqSummaryStr =
    activeDemands.length > 0 ? activeDemands.join(", ") : "Standard baseline infrastructure monitoring";

  const reqLines = wrapText(safePdfText(reqSummaryStr), fontSans, 7.8, reqWidth);
  let rightCursorY = partyStartY - 12;

  for (const rLine of reqLines) {
    page.drawText(rLine, {
      x: reqX,
      y: rightCursorY,
      size: 7.8,
      font: fontSans,
      color: rgb(0.2, 0.25, 0.3),
    });
    rightCursorY -= 11;
  }

  rightCursorY -= 2;
  page.drawText(`Selected Solution: ${activeOption.planName} (${subscriptionType})`, {
    x: reqX,
    y: rightCursorY,
    size: 8,
    font: fontSansBold,
    color: rgb(0.05, 0.2, 0.55),
  });
  rightCursorY -= 11;
  const reqHeight = partyStartY - rightCursorY;

  // Advance past the taller of both columns
  y = partyStartY - Math.max(billToHeight, reqHeight) - 14;

  // 3. Itemized Table
  page.drawText("LINE ITEMS", {
    x: margin,
    y,
    size: 8.5,
    font: fontSansBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  y -= 9;

  const tableHeaderHeight = 17;
  page.drawRectangle({
    x: margin,
    y: y - tableHeaderHeight,
    width: contentWidth,
    height: tableHeaderHeight,
    color: rgb(0.93, 0.95, 0.98),
  });

  const colX = {
    item: margin + 6,
    included: margin + 210,
    purchased: margin + 270,
    packSize: margin + 335,
    packs: margin + 395,
    annual: pageWidth - margin - 8,
  };

  page.drawText("Item", { x: colX.item, y: y - 11, size: 7.5, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Included", { x: colX.included, y: y - 11, size: 7.5, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Purchased", { x: colX.purchased, y: y - 11, size: 7.5, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Pack size", { x: colX.packSize, y: y - 11, size: 7.5, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Packs", { x: colX.packs, y: y - 11, size: 7.5, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Annual (INR)", { x: colX.annual - 55, y: y - 11, size: 7.5, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });

  y -= tableHeaderHeight;

  // Item rows with multi-line wrapping in item column
  for (const item of activeOption.lineItems) {
    const isBase = item.ruleId === "RULE-BASE-PRICE";
    const itemName = isBase ? `${activeOption.planName} base subscription (${subscriptionType.toLowerCase()})` : item.description;
    const includedStr = isBase ? "Base entitlements" : String(item.includedQuantity ?? 0);
    const purchasedStr = String(item.purchasedUnits ?? (item.quantity * (item.packSize ?? 1)));
    const packSizeStr = String(item.packSize ?? 1);
    const packsStr = String(item.quantity);
    const formattedTotal = formatPdfMoney(item.lineTotal, quote.currency);

    const nameLines = wrapText(safePdfText(itemName), isBase ? fontSansBold : fontSans, 7.2, 195);
    const rowHeight = Math.max(17, nameLines.length * 10 + 6);

    let itemTextY = y - 10;
    for (const nLine of nameLines) {
      page.drawText(nLine, {
        x: colX.item,
        y: itemTextY,
        size: 7.2,
        font: isBase ? fontSansBold : fontSans,
        color: rgb(0.1, 0.15, 0.2),
      });
      itemTextY -= 10;
    }

    const baselineY = y - 10;
    page.drawText(safePdfText(includedStr), {
      x: colX.included,
      y: baselineY,
      size: 7,
      font: fontMono,
      color: rgb(0.35, 0.4, 0.45),
    });

    page.drawText(safePdfText(purchasedStr), {
      x: colX.purchased,
      y: baselineY,
      size: 7,
      font: fontMono,
      color: rgb(0.15, 0.2, 0.25),
    });

    page.drawText(safePdfText(packSizeStr), {
      x: colX.packSize,
      y: baselineY,
      size: 7,
      font: fontMono,
      color: rgb(0.35, 0.4, 0.45),
    });

    page.drawText(safePdfText(packsStr), {
      x: colX.packs,
      y: baselineY,
      size: 7,
      font: fontMono,
      color: rgb(0.15, 0.2, 0.25),
    });

    const totalWidth = fontMono.widthOfTextAtSize(formattedTotal, 7.5);
    page.drawText(formattedTotal, {
      x: colX.annual - totalWidth,
      y: baselineY,
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
    y: y - 19,
    width: contentWidth,
    height: 19,
    color: rgb(0.94, 0.96, 1.0),
    borderColor: rgb(0.75, 0.85, 0.98),
    borderWidth: 0.8,
  });

  page.drawText(`TOTAL ${subscriptionType.toUpperCase()} (INR):`, {
    x: margin + 8,
    y: y - 13,
    size: 8,
    font: fontSansBold,
    color: rgb(0.05, 0.2, 0.6),
  });

  const grandTotalStr = formatPdfMoney(activeOption.total, quote.currency);
  const grandTotalWidth = fontMono.widthOfTextAtSize(grandTotalStr, 9);
  page.drawText(grandTotalStr, {
    x: colX.annual - grandTotalWidth,
    y: y - 13,
    size: 9,
    font: fontMono,
    color: rgb(0.05, 0.2, 0.6),
  });

  y -= 25;

  // Calculation note
  page.drawText("Add-on rates reflect the plan-specific per-year pricing from the Zoho Store.", {
    x: margin + 4,
    y,
    size: 7,
    font: fontSansOblique,
    color: rgb(0.4, 0.45, 0.5),
  });

  y -= 14;

  // 4. Adaptive Vertical Sizing & Layout Budgeting for Lower Sections
  // Available space down to the footer boundary (y = 48)
  const availableBottomSpace = y - 48;

  // Prepare & pre-wrap What's Included
  const includedItems = activeOption.coverage
    .filter((c) => c.included > 0)
    .map((c) => `${c.label}: ${c.included.toLocaleString("en-IN")} included in base plan`);
  const includedText = includedItems.length > 0 ? includedItems.join("  *  ") : "Base plan included entitlements";
  const includedLines = wrapText(safePdfText(includedText), fontSans, 7.2, contentWidth - 8);

  // Prepare Alternative (if available)
  const lowestCost = quote.options.find((o) => o.optionType === "lowest_cost");
  let compLines: string[] = [];
  if (lowestCost && lowestCost.planId !== activeOption.planId) {
    const compText = `Alternative: ${buildComparisonLine(lowestCost, activeOption)}`;
    compLines = wrapText(safePdfText(compText), fontSansBold, 7.2, contentWidth - 8);
  }

  // Prepare Assumptions & Exclusions
  const sanitizedAssumptions = (quote.assumptions || [])
    .filter((a) => !/catalogue|engine|version|\d+\.\d+\.\d+/i.test(a))
    .slice(0, 2);
  const sanitizedExclusions = (quote.exclusions || [])
    .filter((e) => !/catalogue|engine|version|\d+\.\d+\.\d+/i.test(e))
    .slice(0, 2);
  const notesList = [...sanitizedAssumptions, ...sanitizedExclusions];
  const wrappedNotes = notesList.map((note) =>
    wrapText(safePdfText(note), fontSans, 7.2, contentWidth - 18)
  );
  const totalNotesLines = wrappedNotes.reduce((acc, l) => acc + l.length, 0);

  // Prepare Terms & Conditions (Verbatim from quote.png)
  const termsClauses = [
    "1. Validity prices are open for acceptance for 30 days from quote date. Please re-confirm the prices after the expiry date before sending your purchase order.",
    "2. Payment Terms 100% due to ZOHO Corp after downloading the software with an official software key that is provided by ZOHO Corp. Orders placed through Zoho Store.",
    "3. Cost is in INR unless specified. Local Taxes extra as applicable.",
    "4. For other detail terms and conditions, Privacy policy & security visit: https://www.site24x7.com/privacypolicy.html | https://www.site24x7.com/terms.html | https://www.site24x7.com/security.html",
  ];
  const wrappedTerms = termsClauses.map((clause) =>
    wrapText(safePdfText(clause), fontSans, 7.2, contentWidth - 8)
  );
  const totalTermsLines = wrappedTerms.reduce((acc, l) => acc + l.length, 0);

  // Calculate content baseline requirement
  const totalSections = 3 + (compLines.length > 0 ? 1 : 0);
  const totalBodyLines = includedLines.length + compLines.length + totalNotesLines + totalTermsLines;
  const minRequiredHeight = totalBodyLines * 10.5 + totalSections * 15 + termsClauses.length * 4;
  const surplus = Math.max(0, availableBottomSpace - minRequiredHeight);

  // Dynamically budgeted spacing to gracefully fill the sheet without overflow
  const sectionGap = Math.min(22, Math.max(10, Math.floor(surplus / (totalSections + 1))));
  const bodyLineHeight = Math.min(13.2, Math.max(10.5, 10.5 + surplus * 0.012));
  const termParaGap = Math.min(6, Math.max(3, Math.floor(surplus / 22)));

  // Section A: WHAT'S INCLUDED
  page.drawText("WHAT'S INCLUDED", {
    x: margin,
    y,
    size: 7.8,
    font: fontSansBold,
    color: rgb(0.1, 0.15, 0.25),
  });
  y -= 11;

  for (const incLine of includedLines) {
    page.drawText(incLine, {
      x: margin + 4,
      y,
      size: 7.2,
      font: fontSans,
      color: rgb(0.25, 0.3, 0.38),
    });
    y -= bodyLineHeight;
  }

  y -= sectionGap;

  // Section B: ALTERNATIVE (if available)
  if (compLines.length > 0) {
    for (const cLine of compLines) {
      page.drawText(cLine, {
        x: margin + 4,
        y,
        size: 7.2,
        font: fontSansBold,
        color: rgb(0.35, 0.25, 0.05),
      });
      y -= bodyLineHeight;
    }
    y -= sectionGap;
  }

  // Section C: ASSUMPTIONS & EXCLUSIONS
  page.drawText("ASSUMPTIONS & EXCLUSIONS", {
    x: margin,
    y,
    size: 7.8,
    font: fontSansBold,
    color: rgb(0.1, 0.15, 0.25),
  });
  y -= 11;

  for (const nLines of wrappedNotes) {
    for (let li = 0; li < nLines.length; li++) {
      const lineText = nLines[li];
      if (!lineText) continue;

      if (li === 0) {
        page.drawText("-", {
          x: margin + 4,
          y,
          size: 7.2,
          font: fontSans,
          color: rgb(0.35, 0.4, 0.45),
        });
        page.drawText(lineText, {
          x: margin + 13,
          y,
          size: 7.2,
          font: fontSans,
          color: rgb(0.35, 0.4, 0.45),
        });
      } else {
        // Hanging indent for wrapped continuation lines
        page.drawText(lineText, {
          x: margin + 13,
          y,
          size: 7.2,
          font: fontSans,
          color: rgb(0.35, 0.4, 0.45),
        });
      }
      y -= bodyLineHeight;
    }
    y -= 2;
  }

  y -= sectionGap;

  // Section D: TERMS & CONDITIONS (Verbatim from quote.png)
  page.drawText("TERMS & CONDITIONS", {
    x: margin,
    y,
    size: 7.8,
    font: fontSansBold,
    color: rgb(0.1, 0.15, 0.25),
  });
  y -= 11;

  for (const tLines of wrappedTerms) {
    for (const tLine of tLines) {
      page.drawText(tLine, {
        x: margin + 4,
        y,
        size: 7.2,
        font: fontSans,
        color: rgb(0.35, 0.4, 0.45),
      });
      y -= bodyLineHeight;
    }
    y -= termParaGap;
  }

  // 5. Footer: Mandatory publication legal notice and pagination
  page.drawLine({
    start: { x: margin, y: 34 },
    end: { x: pageWidth - margin, y: 34 },
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
