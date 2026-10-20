import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import type { Quote, EmailThread, CurrencyCode, CoverageRow } from "@/types/domain";
import { formatMoney } from "../pricing/money.ts";
import { buildComparisonLine } from "../pricing/engine.ts";
import { formatShortRef } from "../pricing/quote-builder.ts";
import { loadActiveCatalogue } from "../catalogue/loader.ts";

export interface RenderPdfOptions {
  quote: Quote;
  thread?: EmailThread;
  selectedOptionType?: "best_value" | "lowest_cost" | "best_coverage";
  recipientName?: string | null;
}

function formatPdfMoney(amount: number, currency: string): string {
  return formatMoney(amount, currency as CurrencyCode, { showDecimals: false }).replace(/[^0-9,]/g, "");
}

function safePdfText(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/₹/g, "Rs. ")
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
          const wordWidth = font.widthOfTextAtSize(word, fontSize);
          if (wordWidth <= maxWidth) {
            currentLine = word;
          } else {
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

function getWhatItCovers(
  item: { ruleId: string; description: string; quantity: number; packSize?: number | null; purchasedUnits?: number | null; unit?: string },
  coverage: CoverageRow[]
): string {
  if (item.ruleId === "RULE-BASE-PRICE") {
    const unitPriority: Record<string, number> = {
      host_monitor: 1,
      basic_monitor: 2,
      advanced_monitor: 3,
      network_component: 4,
      applog_gb: 5,
      rum_pageview: 6,
    };

    const parts = [...coverage]
      .filter((c) => c.included > 0)
      .sort((a, b) => (unitPriority[a.unit] ?? 99) - (unitPriority[b.unit] ?? 99))
      .map((c) => {
        if (c.unit === "host_monitor") return `${c.included} servers`;
        if (c.unit === "basic_monitor") return `${c.included} websites`;
        if (c.unit === "advanced_monitor") return `${c.included} advanced monitor${c.included > 1 ? "s" : ""}`;
        if (c.unit === "network_component") return `${c.included} network devices`;
        if (c.unit === "applog_gb") return `${c.included} GB logs`;
        if (c.unit === "rum_pageview") return `${c.included.toLocaleString("en-IN")} RUM pageviews`;
        return `${c.included} ${c.label}`;
      });
    return parts.length > 0 ? `Base plan: includes ${parts.join(", ")}` : "Base plan included entitlements";
  }

  const desc = item.description.toLowerCase();
  const purchased = item.purchasedUnits ?? (item.quantity * (item.packSize ?? 1));

  if (desc.includes("host") || desc.includes("server") || item.unit === "host_monitor") {
    const cov = coverage.find((c) => c.unit === "host_monitor");
    const total = cov?.total ?? (cov ? cov.included + purchased : purchased);
    return `${purchased} more servers (${total} in total)`;
  }
  if (desc.includes("advanced") || item.unit === "advanced_monitor") {
    return `${purchased} more advanced monitors`;
  }
  if (desc.includes("log") || item.ruleId.includes("log") || item.unit === "applog_gb") {
    const cov = coverage.find((c) => c.unit === "applog_gb");
    const total = cov?.total ?? (cov ? cov.included + purchased : purchased);
    return `${purchased} GB more log ingestion per month (${total} GB in total)`;
  }
  if (desc.includes("network") || desc.includes("switch") || item.unit === "network_component") {
    const cov = coverage.find((c) => c.unit === "network_component");
    const total = cov?.total ?? (cov ? cov.included + purchased : purchased);
    return `${purchased} more network devices (${total} in total)`;
  }
  if (desc.includes("rum") || desc.includes("pageview") || item.unit === "rum_pageview") {
    const cov = coverage.find((c) => c.unit === "rum_pageview");
    const total = cov?.total ?? (cov ? cov.included + purchased : purchased);
    return `${purchased.toLocaleString("en-IN")} more RUM pageviews per month (${total.toLocaleString("en-IN")} in total)`;
  }
  return `${purchased} more ${item.description}`;
}

/**
 * Generates an official publication-quality A4 quotation proposal PDF using pdf-lib.
 * Adheres strictly to Golden Template & Phase 9 specifications:
 * - Clean short reference (e.g. Q-1042) everywhere; zero internal IDs.
 * - Customer name from signature/display name, never "Procurement Contact".
 * - 3 clean columns: Item | What it covers | Annual.
 * - No Included/Purchased/Pack size/Packs columns.
 * - No INR prefix, no monospace font, no .00 decimals.
 * - Deleted "Unquantified custom APM" line.
 * - Adaptive vertical sizing ensuring every line is strictly within page margins.
 */
export async function renderQuotePdf(options: RenderPdfOptions): Promise<Buffer> {
  const { quote, thread, selectedOptionType = "best_value", recipientName } = options;

  const pdfDoc = await PDFDocument.create();
  const shortRef = quote.shortRef || formatShortRef(quote.id);

  pdfDoc.setTitle(`Estimate #${shortRef}`);
  pdfDoc.setAuthor("Quote24x7 Assistant");
  pdfDoc.setSubject("Site24x7 India Commercial Estimate");

  // Deterministic metadata timestamps
  const fixedDate = new Date(quote.createdAt);
  pdfDoc.setCreationDate(fixedDate);
  pdfDoc.setModificationDate(fixedDate);

  const fontSans = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSansBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontSansOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

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

  // Meta details (Right column) - Uses shortRef everywhere, no internal IDs
  const metaRightX = pageWidth - margin - 170;
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

  page.drawText(`Estimate #: ${shortRef}`, {
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
  page.drawText(`Reference: #${shortRef}`, {
    x: metaRightX,
    y: y - 61,
    size: 8,
    font: fontSans,
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

  // 2. Party & Requirements Section (Never "Procurement Contact")
  const partyStartY = y;

  // Left Column: BILL TO
  page.drawText("BILL TO", {
    x: margin,
    y: partyStartY,
    size: 7.5,
    font: fontSansBold,
    color: rgb(0.35, 0.42, 0.52),
  });

  // Name rule: explicit recipientName, or thread contact_name, or senderName, or email localpart, NEVER "Procurement Contact" or "there"
  let customerName = (recipientName || thread?.contactName || thread?.contact_name || thread?.senderName || "").trim();
  if (!customerName || /^(?:Procurement Contact|Customer|Valued Customer|Unknown|there)$/i.test(customerName)) {
    customerName = thread?.senderEmail ? thread.senderEmail.split("@")[0]! : "Customer";
  }

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

  // Right Column: WHAT YOU ASKED FOR (Plain-word requirements + Selected Solution)
  const reqX = margin + 235;
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
    .map((c) => {
      const count = c.required.toLocaleString("en-IN");
      if (c.unit === "host_monitor") return `${count} servers`;
      if (c.unit === "network_component") return `${count} network devices`;
      if (c.unit === "basic_monitor") return `${count} websites`;
      if (c.unit === "advanced_monitor") return `${count} browser transactions`;
      if (c.unit === "applog_gb") return `${count} GB logs/mo`;
      if (c.unit === "rum_pageview") return `${count} RUM pageviews`;
      return `${count} ${c.label}`;
    });
  const reqSummaryStr =
    activeDemands.length > 0 ? activeDemands.join(", ") : "Standard infrastructure monitoring";

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

  // Advance past taller column
  y = partyStartY - Math.max(billToHeight, reqHeight) - 14;

  // 3. Itemized Table (3 Columns: Item | What it covers | Annual)
  // No Included/Purchased/Pack size/Packs columns, no INR prefix, no monospace
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
    whatItCovers: margin + 195,
    annual: pageWidth - margin - 8,
  };

  page.drawText("Item", { x: colX.item, y: y - 11, size: 7.5, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("What it covers", { x: colX.whatItCovers, y: y - 11, size: 7.5, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });
  page.drawText("Annual", { x: colX.annual - 35, y: y - 11, size: 7.5, font: fontSansBold, color: rgb(0.2, 0.25, 0.35) });

  y -= tableHeaderHeight;

  const catalogue = loadActiveCatalogue();
  const currentPlan = catalogue.plans.find((p) => p.id === activeOption.planId);

  for (const item of activeOption.lineItems) {
    const isBase = item.ruleId === "RULE-BASE-PRICE";
    const monthlyRate =
      currentPlan?.priceMonthlyAnnualBilled ??
      currentPlan?.basePrice ??
      (item.lineTotal ? Math.floor(item.lineTotal / 12) : 0);
    const monthlyStr = formatPdfMoney(monthlyRate, quote.currency);
    const itemName = isBase
      ? `${activeOption.planName} base subscription (Rs. ${monthlyStr} per month x 12)`
      : item.description;

    const coversText = getWhatItCovers(item, activeOption.coverage);
    const formattedTotal = formatPdfMoney(item.lineTotal, quote.currency);

    const nameLines = wrapText(safePdfText(itemName), isBase ? fontSansBold : fontSans, 7.2, 180);
    const coversLines = wrapText(safePdfText(coversText), fontSans, 7.2, 205);
    const maxLineCount = Math.max(nameLines.length, coversLines.length);
    const rowHeight = Math.max(17, maxLineCount * 10 + 6);

    let nameY = y - 10;
    for (const nLine of nameLines) {
      page.drawText(nLine, {
        x: colX.item,
        y: nameY,
        size: 7.2,
        font: isBase ? fontSansBold : fontSans,
        color: rgb(0.1, 0.15, 0.2),
      });
      nameY -= 10;
    }

    let coversY = y - 10;
    for (const cLine of coversLines) {
      page.drawText(cLine, {
        x: colX.whatItCovers,
        y: coversY,
        size: 7.2,
        font: fontSans,
        color: rgb(0.25, 0.3, 0.38),
      });
      coversY -= 10;
    }

    // Render price using fontSansBold (no monospace, no INR prefix)
    const totalWidth = fontSansBold.widthOfTextAtSize(formattedTotal, 7.8);
    page.drawText(formattedTotal, {
      x: colX.annual - totalWidth,
      y: y - 10,
      size: 7.8,
      font: fontSansBold,
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

  // Total Row (No INR prefix, no monospace)
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

  page.drawText(`TOTAL ${subscriptionType.toUpperCase()}:`, {
    x: margin + 8,
    y: y - 13,
    size: 8,
    font: fontSansBold,
    color: rgb(0.05, 0.2, 0.6),
  });

  const grandTotalStr = formatPdfMoney(activeOption.total, quote.currency);
  const grandTotalWidth = fontSansBold.widthOfTextAtSize(grandTotalStr, 9.5);
  page.drawText(grandTotalStr, {
    x: colX.annual - grandTotalWidth,
    y: y - 13,
    size: 9.5,
    font: fontSansBold,
    color: rgb(0.05, 0.2, 0.6),
  });

  y -= 25;

  // Calculation note
  page.drawText("Add-on prices are Site24x7's per-year prices for this plan.", {
    x: margin + 4,
    y,
    size: 7,
    font: fontSansOblique,
    color: rgb(0.4, 0.45, 0.5),
  });

  y -= 14;

  // 4. Adaptive Vertical Sizing & Layout Budgeting for Lower Sections
  const availableBottomSpace = y - 48;

  // What's Included
  const includedItems = activeOption.coverage
    .filter((c) => c.included > 0)
    .map((c) => `${c.label}: ${c.included.toLocaleString("en-IN")} included in base plan`);
  const includedText = includedItems.length > 0 ? includedItems.join("  *  ") : "Base plan included entitlements";
  const includedLines = wrapText(safePdfText(includedText), fontSans, 7.2, contentWidth - 8);

  // Alternative (if available)
  const lowestCost = quote.options.find((o) => o.optionType === "lowest_cost");
  let compLines: string[] = [];
  if (lowestCost && lowestCost.planId !== activeOption.planId) {
    const compText = `Alternative: ${buildComparisonLine(lowestCost, activeOption)}`;
    compLines = wrapText(safePdfText(compText), fontSansBold, 7.2, contentWidth - 8);
  }

  // Assumptions & Exclusions (Filtering out engine version and deleted Unquantified custom APM line)
  const sanitizedAssumptions = (quote.assumptions || [])
    .filter((a) => !/catalogue|engine|version|\d+\.\d+\.\d+|Unquantified custom APM/i.test(a))
    .slice(0, 4);
  const sanitizedExclusions = (quote.exclusions || [])
    .filter((e) => !/catalogue|engine|version|\d+\.\d+\.\d+|Unquantified custom APM/i.test(e))
    .slice(0, 3);
  const notesList = [...sanitizedAssumptions, ...sanitizedExclusions];
  const wrappedNotes = notesList.map((note) =>
    wrapText(safePdfText(note), fontSans, 7.2, contentWidth - 18)
  );
  const totalNotesLines = wrappedNotes.reduce((acc, l) => acc + l.length, 0);

  // Terms & Conditions (Verbatim from quote.png)
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

  // Dynamically budgeted spacing
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

  // Section D: TERMS & CONDITIONS
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
