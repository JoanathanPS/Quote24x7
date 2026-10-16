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
  | { type: "list"; ordered: boolean; items: string[] };

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

/** Rejoins lines a mail client broke at its wrap width; keeps deliberate breaks. */
function unwrapParagraph(lines: string[]): string {
  let text = lines[0] ?? "";
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]!;
    const next = lines[i]!;
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

  for (const line of mergeOrphanBullets(main)) {
    const trimmed = line.trim();
    if (trimmed === "") {
      // A blank line ends a paragraph; a list stays open until non-item text.
      flushParagraph();
      previousWasItem = false;
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
