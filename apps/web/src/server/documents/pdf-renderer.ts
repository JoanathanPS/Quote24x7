import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import type { Quote, EmailThread, CurrencyCode } from "@/types/domain";
import { formatMoney } from "../pricing/money.ts";

export interface RenderPdfOptions {
  quote: Quote;
  thread?: EmailThread;
  selectedOptionType?: "best_value" | "lowest_cost" | "best_coverage";
}

// ---------------------------------------------------------------------------
// Text helpers. Every string is measured with the real font metrics before it
// is drawn, so nothing can run into a neighbouring column or off the page.
// ---------------------------------------------------------------------------

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
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E]/g, " ")
    .trim();
}

function formatCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("en-IN") : String(value);
}

/** Truncates with an ellipsis so the text is never wider than `maxWidth`. */
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const ellipsis = "...";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(text.slice(0, mid).trimEnd() + ellipsis, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + ellipsis;
}

/** Word-wraps to `maxWidth`. Anything beyond `maxLines` is folded into an ellipsis on the last line. */
function wrap(
  raw: string | null | undefined,
  font: PDFFont,
  size: number,
  maxWidth: number,
  maxLines = Number.POSITIVE_INFINITY
): string[] {
  const words = safePdfText(raw).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = font.widthOfTextAtSize(word, size) <= maxWidth ? word : fit(word, font, size, maxWidth);
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const rest = lines.slice(maxLines - 1).join(" ") + " ...";
    return [...lines.slice(0, maxLines - 1), fit(rest, font, size, maxWidth)];
  }
  return lines.length ? lines : [""];
}

/** Draws a single line at a fixed size; shrinks slightly before truncating (for emails, IDs). */
function shrinkToFit(text: string, font: PDFFont, size: number, minSize: number, maxWidth: number) {
  let s = size;
  while (s > minSize && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.25;
  return { text: fit(text, font, s, maxWidth), size: s };
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 45;
const CONTENT_W = PAGE_W - MARGIN * 2;
const RIGHT = MARGIN + CONTENT_W;
const BOTTOM = 62; // lowest y that content may reach; the footer lives below this
const LH = 10; // line height for 7.5-8pt text

const C = {
  ink: rgb(0.1, 0.1, 0.15),
  heading: rgb(0.12, 0.14, 0.2),
  body: rgb(0.15, 0.15, 0.2),
  muted: rgb(0.4, 0.45, 0.5),
  label: rgb(0.45, 0.5, 0.55),
  th: rgb(0.3, 0.35, 0.4),
  rule: rgb(0.9, 0.92, 0.94),
  panel: rgb(0.94, 0.95, 0.97),
  selected: rgb(0.93, 0.96, 1.0),
  accent: rgb(0.1, 0.3, 0.7),
  amber: rgb(0.75, 0.45, 0.05),
  warnText: rgb(0.55, 0.35, 0.05),
  ok: rgb(0.1, 0.55, 0.25),
  bad: rgb(0.8, 0.2, 0.2),
};

type Align = "left" | "right";

/** A table column, as left/right offsets from the left margin. Right-aligned columns anchor to `right`. */
interface Col {
  header: string;
  left: number;
  right: number;
  align: Align;
}

/**
 * Generates a paginated A4 quotation proposal PDF using pdf-lib.
 * Returns a Buffer ready for email attachment or HTTP download.
 */
export async function renderQuotePdf(options: RenderPdfOptions): Promise<Buffer> {
  const { quote, thread, selectedOptionType = "best_value" } = options;

  const activeOption =
    quote.options.find((o) => o.optionType === selectedOptionType) ??
    quote.options.find((o) => o.optionType === "best_value") ??
    quote.options[0];

  if (!activeOption) {
    throw new Error(`No quotation options available for quote ${quote.id}`);
  }

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Quote24x7 - Proposal #${quote.id}`);
  pdfDoc.setAuthor("Quote24x7 Pricing Engine");
  pdfDoc.setSubject("Site24x7 Infrastructure Monitoring Quotation");
  pdfDoc.setCreationDate(new Date(quote.createdAt));

  const sans = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const sansOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  let page: PDFPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const pages: PDFPage[] = [page];
  let y = PAGE_H - MARGIN;

  // -- primitives ----------------------------------------------------------

  interface TextOpts {
    font?: PDFFont;
    size?: number;
    color?: ReturnType<typeof rgb>;
    align?: Align;
    /** Maximum width; longer text is truncated with an ellipsis. */
    width?: number;
  }

  /** `x` is the left edge for left alignment and the right edge for right alignment. */
  const text = (raw: string, x: number, baseline: number, o: TextOpts = {}) => {
    const font = o.font ?? sans;
    const size = o.size ?? 8;
    let s = safePdfText(raw);
    if (o.width !== undefined) s = fit(s, font, size, o.width);
    if (!s) return;
    const w = font.widthOfTextAtSize(s, size);
    page.drawText(s, {
      x: o.align === "right" ? x - w : x,
      y: baseline,
      size,
      font,
      color: o.color ?? C.body,
    });
  };

  const hRule = (at: number, thickness = 0.5, color = C.rule) =>
    page.drawLine({ start: { x: MARGIN, y: at }, end: { x: RIGHT, y: at }, thickness, color });

  const newPage = () => {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = PAGE_H - MARGIN;
    text(`Quote24x7  |  Proposal #${quote.id} (continued)`, MARGIN, y - 10, {
      font: sansBold,
      size: 9,
      color: C.heading,
      width: CONTENT_W,
    });
    y -= 20;
    hRule(y, 0.8, rgb(0.85, 0.87, 0.9));
    y -= 16;
  };

  /** Starts a new page (and redraws a table header) if `height` doesn't fit above the footer. */
  const ensure = (height: number, redraw?: () => void) => {
    if (y - height >= BOTTOM) return;
    newPage();
    redraw?.();
  };

  const colText = (raw: string, c: Col, baseline: number, o: TextOpts = {}) =>
    text(raw, c.align === "right" ? MARGIN + c.right : MARGIN + c.left, baseline, {
      ...o,
      align: c.align,
      width: c.right - c.left,
    });

  const colLines = (lines: string[], c: Col, firstBaseline: number, o: TextOpts = {}) =>
    lines.forEach((line, i) => colText(line, c, firstBaseline - i * LH, o));

  const tableHeader = (cols: Col[]) => {
    page.drawRectangle({ x: MARGIN, y: y - 14, width: CONTENT_W, height: 16, color: C.panel });
    for (const c of cols) colText(c.header, c, y - 10, { font: sansBold, size: 7.5, color: C.th });
    y -= 16;
  };

  const sectionHeading = (title: string, minFollowing = 60) => {
    ensure(24 + minFollowing);
    text(title, MARGIN, y, { font: sansBold, size: 9.5, color: C.heading, width: CONTENT_W });
    y -= 12;
  };

  // -- page 1 header -------------------------------------------------------

  const brand = "Quote24x7";
  text(brand, MARGIN, y - 16, { font: sansBold, size: 20, color: C.heading });
  text("Commercial Proposal", MARGIN + sansBold.widthOfTextAtSize(brand, 20) + 10, y - 14, {
    font: sansBold,
    size: 9,
    color: C.label,
  });

  const issueDate = new Date(quote.createdAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  // Right-aligned block: every line ends on the same edge, whatever its length.
  text(`Reference: #${quote.id}`, RIGHT, y - 10, { size: 9, color: C.ink, align: "right", width: 220 });
  text(`Issue Date: ${issueDate}`, RIGHT, y - 22, { size: 8, color: C.muted, align: "right" });
  text("Status: Preliminary Estimate (Non-binding)", RIGHT, y - 34, {
    font: sansBold,
    size: 8,
    color: C.amber,
    align: "right",
  });

  y -= 46;
  hRule(y, 1, rgb(0.85, 0.87, 0.9));
  y -= 16;

  // -- notice box (height follows the wrapped text) ------------------------

  const noticeWidth = CONTENT_W - 20;
  const noticeLines = [
    ...wrap(
      `DEMO ESTIMATE: Calculated by Quote24x7 using unverified demo catalogue (v${quote.catalogueVersion}).`,
      sansBold,
      7.5,
      noticeWidth
    ).map((line) => ({ line, font: sansBold })),
    ...wrap(
      "Preliminary sizing estimate for planning purposes. Does not constitute an authorized commercial offer by Zoho Corporation.",
      sans,
      7.5,
      noticeWidth
    ).map((line) => ({ line, font: sans })),
  ];
  const noticeHeight = noticeLines.length * LH + 12;
  page.drawRectangle({
    x: MARGIN,
    y: y - noticeHeight,
    width: CONTENT_W,
    height: noticeHeight,
    color: rgb(0.99, 0.97, 0.93),
    borderColor: rgb(0.92, 0.85, 0.7),
    borderWidth: 0.8,
  });
  noticeLines.forEach(({ line, font }, i) =>
    text(line, MARGIN + 10, y - 13 - i * LH, { font, size: 7.5, color: C.warnText })
  );
  y -= noticeHeight + 18;

  // -- parties: two independent columns that can't collide -----------------

  const colGap = 24;
  const colWidth = (CONTENT_W - colGap) / 2;
  const rightColX = MARGIN + colWidth + colGap;
  const partiesTop = y;

  let leftY = partiesTop;
  text("PREPARED FOR", MARGIN, leftY, { font: sansBold, size: 8, color: C.label });
  leftY -= 13;
  for (const line of wrap(thread?.senderName || "Valued Customer", sansBold, 11, colWidth, 2)) {
    text(line, MARGIN, leftY, { font: sansBold, size: 11, color: C.ink });
    leftY -= 13;
  }
  if (thread?.organisation) {
    for (const line of wrap(thread.organisation, sans, 9, colWidth, 2)) {
      text(line, MARGIN, leftY, { size: 9, color: rgb(0.3, 0.35, 0.4) });
      leftY -= 11;
    }
  }
  const email = shrinkToFit(safePdfText(thread?.senderEmail || "Customer Email"), sans, 8.5, 6.5, colWidth);
  text(email.text, MARGIN, leftY, { size: email.size, color: C.muted });
  leftY -= 11;

  let rightY = partiesTop;
  text("COMMERCIAL TERMS", rightColX, rightY, { font: sansBold, size: 8, color: C.label });
  rightY -= 13;
  const terms = [
    `Billing: ${quote.billingPeriod === "annual" ? "Annual" : "Monthly"}`,
    `Currency: ${quote.currency}   |   Market: ${quote.market}`,
    `Catalogue: ${quote.catalogueVersion}`,
    `Pricing engine: ${quote.calculationVersion}`,
  ];
  terms.forEach((term, i) => {
    for (const line of wrap(term, i === 0 || i === 1 ? sansBold : sans, 8.5, colWidth, 2)) {
      text(line, rightColX, rightY, {
        font: i === 0 || i === 1 ? sansBold : sans,
        size: 8.5,
        color: i < 2 ? C.body : C.muted,
      });
      rightY -= 11;
    }
  });

  y = Math.min(leftY, rightY) - 14;

  // -- 1. options comparison ----------------------------------------------

  const optCols: Col[] = [
    { header: "OPTION TIER", left: 6, right: 98, align: "left" },
    { header: "BASE PLAN", left: 104, right: 192, align: "left" },
    { header: "SELECTION RATIONALE", left: 198, right: 400, align: "left" },
    { header: "TOTAL", left: 410, right: CONTENT_W - 6, align: "right" },
  ];
  const [oTier, oPlan, oReason, oTotal] = optCols as [Col, Col, Col, Col];

  sectionHeading("1. QUOTATION OPTIONS COMPARISON");
  tableHeader(optCols);

  for (const opt of quote.options) {
    const isSelected = opt.optionType === activeOption.optionType;
    const planLines = wrap(opt.planName, sansBold, 8, oPlan.right - oPlan.left, 2);
    const reasonLines = wrap(opt.rankReason, sans, 7.5, oReason.right - oReason.left, 3);
    const rowH = Math.max(planLines.length, reasonLines.length, 1) * LH + 8;
    ensure(rowH, () => tableHeader(optCols));

    if (isSelected) {
      page.drawRectangle({ x: MARGIN, y: y - rowH, width: CONTENT_W, height: rowH, color: C.selected });
    }
    const tierLabel =
      opt.optionType === "best_value"
        ? "Best Value (Rec.)"
        : opt.optionType === "lowest_cost"
        ? "Lowest Cost"
        : "Best Coverage";
    const base = y - 10;
    colText(tierLabel, oTier, base, {
      font: isSelected ? sansBold : sans,
      color: isSelected ? C.accent : rgb(0.2, 0.2, 0.25),
    });
    colLines(planLines, oPlan, base, { font: sansBold, color: C.ink });
    colLines(reasonLines, oReason, base, { size: 7.5, color: rgb(0.35, 0.4, 0.45) });
    colText(formatPdfMoney(opt.total, quote.currency), oTotal, base, { size: 8.5, color: C.ink });

    y -= rowH;
    hRule(y);
  }

  y -= 16;

  // -- 2. line items -------------------------------------------------------

  const itemCols: Col[] = [
    { header: "ITEM DESCRIPTION", left: 6, right: 206, align: "left" },
    { header: "QTY", left: 208, right: 238, align: "right" },
    { header: "UNIT SIZING", left: 250, right: 310, align: "left" },
    { header: "UNIT PRICE", left: 314, right: 404, align: "right" },
    { header: "TOTAL", left: 408, right: CONTENT_W - 6, align: "right" },
  ];
  const [iDesc, iQty, iUnit, iPrice, iTotal] = itemCols as [Col, Col, Col, Col, Col];

  sectionHeading(`2. RECOMMENDED CONFIGURATION BREAKDOWN: ${activeOption.planName.toUpperCase()}`);
  tableHeader(itemCols);

  for (const item of activeOption.lineItems) {
    const descLines = wrap(item.description, sans, 8, iDesc.right - iDesc.left, 3);
    const unitLines = wrap(item.unit, sans, 7.5, iUnit.right - iUnit.left, 2);
    const rowH = Math.max(descLines.length, unitLines.length, 1) * LH + 8;
    ensure(rowH, () => tableHeader(itemCols));

    const base = y - 10;
    colLines(descLines, iDesc, base, { color: C.body });
    colText(formatCount(item.quantity), iQty, base, { color: rgb(0.2, 0.2, 0.25) });
    colLines(unitLines, iUnit, base, { size: 7.5, color: C.muted });
    colText(formatPdfMoney(item.unitPrice, quote.currency), iPrice, base, { color: rgb(0.2, 0.2, 0.25) });
    colText(formatPdfMoney(item.lineTotal, quote.currency), iTotal, base, { font: sansBold, color: C.ink });

    y -= rowH;
    hRule(y);
  }

  // Totals block is kept together on one page.
  ensure(80);
  y -= 14;
  const totalsLabelRight = MARGIN + iPrice.right;
  const totalsValueRight = MARGIN + iTotal.right;
  text("Subtotal:", totalsLabelRight, y, { size: 8.5, color: C.muted, align: "right" });
  text(formatPdfMoney(activeOption.subtotal, quote.currency), totalsValueRight, y, {
    size: 8.5,
    color: rgb(0.2, 0.2, 0.25),
    align: "right",
  });
  y -= 14;
  text("Taxes (unverified):", totalsLabelRight, y, { size: 8, color: rgb(0.5, 0.5, 0.5), align: "right" });
  text("Excluded", totalsValueRight, y, { font: sansOblique, size: 8, color: rgb(0.5, 0.5, 0.5), align: "right" });
  y -= 10;

  const boxLeft = MARGIN + 250;
  page.drawRectangle({ x: boxLeft, y: y - 24, width: RIGHT - boxLeft, height: 24, color: rgb(0.92, 0.95, 0.99) });
  text(`TOTAL (${quote.billingPeriod.toUpperCase()}):`, boxLeft + 10, y - 16, {
    font: sansBold,
    size: 9.5,
    color: rgb(0.1, 0.25, 0.65),
  });
  text(formatPdfMoney(activeOption.total, quote.currency), RIGHT - 8, y - 16, {
    font: sansBold,
    size: 10.5,
    color: rgb(0.05, 0.2, 0.55),
    align: "right",
    width: RIGHT - boxLeft - 110,
  });
  y -= 24 + 22;

  // -- 3. capacity matrix --------------------------------------------------

  const covCols: Col[] = [
    { header: "MONITORED METRIC", left: 6, right: 150, align: "left" },
    { header: "DEMANDED", left: 152, right: 215, align: "right" },
    { header: "BASE INCLUDED", left: 217, right: 295, align: "right" },
    { header: "VIA ADD-ONS", left: 297, right: 370, align: "right" },
    { header: "TOTAL CAPACITY", left: 372, right: 448, align: "right" },
    { header: "STATUS", left: 458, right: CONTENT_W - 6, align: "left" },
  ];
  const [cLabel, cReq, cInc, cAdd, cTotal, cStatus] = covCols as [Col, Col, Col, Col, Col, Col];

  sectionHeading("3. WORKLOAD CAPACITY FULFILLMENT MATRIX");
  tableHeader(covCols);

  for (const cov of activeOption.coverage) {
    const labelLines = wrap(cov.label, sans, 8, cLabel.right - cLabel.left, 2);
    const rowH = labelLines.length * LH + 6;
    ensure(rowH, () => tableHeader(covCols));

    const base = y - 9;
    colLines(labelLines, cLabel, base, { color: C.body });
    colText(formatCount(cov.required), cReq, base, { color: rgb(0.2, 0.2, 0.25) });
    colText(formatCount(cov.included), cInc, base, { color: C.muted });
    colText(formatCount(cov.viaAddOns), cAdd, base, { color: C.muted });
    colText(formatCount(cov.total), cTotal, base, { font: sansBold, color: C.ink });
    colText(cov.satisfied ? "Satisfied" : "Deficit", cStatus, base, {
      font: sansBold,
      size: 7.5,
      color: cov.satisfied ? C.ok : C.bad,
    });

    y -= rowH;
    hRule(y);
  }

  y -= 20;

  // -- 4. assumptions & exclusions (complete text, wrapped, never cut) -----

  sectionHeading("4. ASSUMPTIONS & EXCLUSIONS", 30);
  const notes = [...(quote.assumptions || []), ...(quote.exclusions || [])];
  const noteX = MARGIN + 14;
  for (const note of notes) {
    const lines = wrap(note, sans, 7.5, RIGHT - noteX);
    const blockH = lines.length * LH + 3;
    ensure(blockH);
    text("-", MARGIN + 6, y - 8, { size: 7.5, color: C.muted });
    lines.forEach((line, i) => text(line, noteX, y - 8 - i * LH, { size: 7.5, color: rgb(0.35, 0.4, 0.45) }));
    y -= blockH;
  }

  // -- footer on every page, drawn last so the page count is correct -------

  const footerLeft = "Official Verification & Procurement: https://quotes.joanathan.in/";
  const footerLeftWidth = sansBold.widthOfTextAtSize(footerLeft, 7.5);
  pages.forEach((p, i) => {
    page = p;
    hRule(40, 0.5, rgb(0.85, 0.87, 0.9));
    text(footerLeft, MARGIN, 28, { font: sansBold, size: 7.5, color: rgb(0.2, 0.35, 0.65) });
    text(`Page ${i + 1} of ${pages.length}  |  Generated by Quote24x7 v1.0.0  |  Ref: ${quote.id}`, RIGHT, 28, {
      size: 7.5,
      color: rgb(0.5, 0.55, 0.6),
      align: "right",
      width: CONTENT_W - footerLeftWidth - 16,
    });
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
