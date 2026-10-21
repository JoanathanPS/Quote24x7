/**
 * Turns a stored plain-text email body into display blocks.
 *
 * Gmail's text/plain part of an HTML email hard-wraps lines near 78 columns and
 * renders every bullet as a lone "-" followed by a blank line and the indented
 * item. Shown verbatim that reads as noise, so this rebuilds paragraphs and
 * lists, and separates quoted reply history from the new text.
 *
 * Pure and dependency-free: it runs in the browser as well as in tests. The
 * stored body is never modified; this only affects how it is displayed.
 */

export type EmailBodyBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

export interface FormattedEmailBody {
  blocks: EmailBodyBlock[];
  /** Quoted history from earlier messages, verbatim, or null when there is none. */
  quoted: string | null;
}

const BULLET_ONLY = /^(?:[-*•·◦▪]|(\d{1,3})[.)])$/;
const BULLET_ITEM = /^[-*•·◦▪]\s+(.+)$/;
const NUMBERED_ITEM = /^(\d{1,3})[.)]\s+(.+)$/;

/** Narrowest common hard-wrap width; Gmail wraps at 78, many clients at 72. */
const WRAP_WIDTH = 72;

function isQuoteStart(lines: string[], i: number): boolean {
  const line = lines[i]!.trim();
  const next = (lines[i + 1] ?? "").trim();
  if (line.startsWith(">")) return true;
  if (/^On\s.+\swrote:$/i.test(line)) return true;
  // Gmail wraps a long attribution line: "On Thu, ... Name <a@b.c>" / "wrote:".
  if (/^On\s/i.test(line) && /wrote:$/i.test(next)) return true;
  if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(line)) return true;
  // Outlook: a "From:" header block followed closely by "Sent:" or "Date:".
  if (/^From:\s/i.test(line)) {
    return lines.slice(i + 1, i + 5).some((l) => /^(?:Sent|Date):\s/i.test(l.trim()));
  }
  return false;
}

function splitQuoted(lines: string[]): { main: string[]; quoted: string[] } {
  for (let i = 0; i < lines.length; i++) {
    if (isQuoteStart(lines, i)) {
      const main = lines.slice(0, i);
      // A message that is nothing but quoted text is shown as-is.
      if (main.every((l) => l.trim() === "")) break;
      return { main, quoted: lines.slice(i) };
    }
  }
  return { main: lines, quoted: [] };
}

/** Joins Gmail's lone bullet markers to the item text that follows them. */
function mergeOrphanBullets(lines: string[]): string[] {
  const merged: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const marker = BULLET_ONLY.exec(lines[i]!.trim());
    if (!marker) {
      merged.push(lines[i]!);
      continue;
    }
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === "") j++;
    if (j < lines.length && !BULLET_ONLY.test(lines[j]!.trim())) {
      merged.push(`${marker[1] ? `${marker[1]}.` : "-"} ${lines[j]!.trim()}`);
      i = j;
    }
    // A marker with no item after it is dropped.
  }
  return merged;
}

/** Matches a horizontal separator line (e.g. "---", "===", "--------------------------------------------------------------------------------", "|---|---|") */
function isSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3) return false;
  if (/^[-=_*]{3,}$/.test(trimmed)) return true;
  if (/^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(trimmed)) return true;
  return false;
}

/** Splits a pipe-delimited row into trimmed cell strings */
function splitCells(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((c) => c.trim());
}

/** Checks whether a line looks like a valid table row with 2 or more columns */
function isTableRowLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || isSeparatorLine(trimmed)) return false;
  if (!trimmed.includes("|")) return false;
  const cells = splitCells(trimmed);
  return cells.length >= 2;
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
  endIndex: number;
}

function tryParseTable(lines: string[], startIndex: number): ParsedTable | null {
  let i = startIndex;
  const line = lines[i]?.trim() ?? "";
  if (!line) return null;

  let hasTopSeparator = false;
  if (isSeparatorLine(line)) {
    if (i + 1 < lines.length && isTableRowLine(lines[i + 1]!)) {
      hasTopSeparator = true;
      i++;
    } else {
      return null;
    }
  }

  const headerLine = lines[i]?.trim() ?? "";
  if (!isTableRowLine(headerLine)) return null;

  const nextLine = lines[i + 1]?.trim() ?? "";
  const hasSeparatorBelowHeader = isSeparatorLine(nextLine);
  const nextIsTableRow = isTableRowLine(nextLine);

  if (!hasSeparatorBelowHeader && !nextIsTableRow) {
    return null;
  }

  const headers = splitCells(headerLine);
  i++;

  if (hasSeparatorBelowHeader) {
    i++;
  }

  const rows: string[][] = [];

  while (i < lines.length) {
    const currentLine = lines[i]!.trim();
    if (currentLine === "") {
      break;
    }

    if (isSeparatorLine(currentLine)) {
      let peek = i + 1;
      while (peek < lines.length && isSeparatorLine(lines[peek]!.trim())) {
        peek++;
      }
      if (peek < lines.length && isTableRowLine(lines[peek]!.trim())) {
        i = peek;
        continue;
      } else {
        i++;
        break;
      }
    }

    if (isTableRowLine(currentLine)) {
      const cells = splitCells(currentLine);
      while (cells.length < headers.length) {
        cells.push("");
      }
      rows.push(cells);
      i++;
    } else {
      break;
    }
  }

  if (rows.length === 0 && !hasSeparatorBelowHeader && !hasTopSeparator) {
    return null;
  }

  return {
    headers,
    rows,
    endIndex: i,
  };
}

/** Rejoins lines a mail client broke at its wrap width; keeps deliberate breaks. */
function unwrapParagraph(lines: string[]): string {
  let text = lines[0] ?? "";
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]!;
    const next = lines[i]!;
    // Never unwrap lines containing pipes or separator characters
    if (prev.includes("|") || next.includes("|") || isSeparatorLine(prev) || isSeparatorLine(next)) {
      text += `\n${next}`;
      continue;
    }
    const nextWord = next.split(/\s+/)[0] ?? "";
    const wasWrapped =
      prev.length >= 40 &&
      prev.length <= 80 &&
      prev.length + 1 + nextWord.length > WRAP_WIDTH &&
      !/^https?:\/\//i.test(nextWord);
    text += wasWrapped ? ` ${next}` : `\n${next}`;
  }
  return text;
}

export function formatEmailBody(raw: string): FormattedEmailBody {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""));

  const { main, quoted } = splitQuoted(lines);

  const mergedLines = mergeOrphanBullets(main);
  const blocks: EmailBodyBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let previousWasItem = false;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: unwrapParagraph(paragraph) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: "list", ...list });
      list = null;
    }
  };

  for (let idx = 0; idx < mergedLines.length; idx++) {
    const line = mergedLines[idx]!;
    const trimmed = line.trim();

    if (trimmed === "") {
      // A blank line ends a paragraph; a list stays open until non-item text.
      flushParagraph();
      previousWasItem = false;
      continue;
    }

    // Detect tables and emit table blocks
    const tableMatch = tryParseTable(mergedLines, idx);
    if (tableMatch) {
      flushParagraph();
      flushList();
      previousWasItem = false;
      blocks.push({
        type: "table",
        headers: tableMatch.headers,
        rows: tableMatch.rows,
      });
      idx = tableMatch.endIndex - 1;
      continue;
    }

    const bullet = BULLET_ITEM.exec(trimmed);
    const numbered = bullet ? null : NUMBERED_ITEM.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ? bullet[1]! : numbered![2]!).trim());
      previousWasItem = true;
      continue;
    }

    // An indented line directly under an item is that item wrapped.
    if (list && previousWasItem && /^\s/.test(line)) {
      const items: string[] = list.items;
      const last = items.length - 1;
      items[last] = `${items[last] ?? ""} ${trimmed}`;
      continue;
    }

    flushList();
    paragraph.push(trimmed);
    previousWasItem = false;
  }
  flushParagraph();
  flushList();

  const quotedText = quoted.join("\n").trim();
  return { blocks, quoted: quotedText.length > 0 ? quotedText : null };
}
