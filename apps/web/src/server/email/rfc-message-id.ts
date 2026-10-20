/**
 * RFC 2822 message-id handling for email threading.
 *
 * Two invariants this module exists to enforce:
 *
 *  1. Only a real RFC 2822 message-id — a `<local@domain>` token — may ever be
 *     emitted in In-Reply-To or References, or stored as a message's own id.
 *     A provider's internal UUID (Resend's `7e410824-...`) is not a message-id;
 *     putting one in the chain makes recipients' clients start a fresh thread.
 *
 *  2. Header parsing never throws. Email arrives from the network: a header can
 *     be missing, empty, an array, mixed-case, or malformed. Every reader here
 *     returns a safe empty value instead of propagating.
 */

const RFC_TOKEN_RE = /<[^<>\s]+@[^<>\s]+>/g;

/**
 * Extracts RFC 2822 message-id tokens from an arbitrary header value.
 * Accepts a string, an array of strings, null or undefined. Never throws.
 */
export function extractMessageIds(value: unknown): string[] {
  if (value === null || value === undefined) return [];

  const raw: string[] = Array.isArray(value)
    ? value.map((v) => (typeof v === "string" ? v : ""))
    : typeof value === "string"
      ? [value]
      : [];

  if (raw.length === 0) return [];

  const text = raw.join(" ");
  const matches = text.match(RFC_TOKEN_RE);
  return matches ? matches : [];
}

/**
 * Normalizes a single message-id to `<local@domain>`, or returns null when the
 * value is not a usable RFC 2822 token. A bare value such as `abc@def.com` is
 * wrapped; a provider UUID with no `@` is rejected outright.
 */
export function normalizeRfcMessageId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // If the value already contains an RFC token, prefer the first one.
  const tokens = extractMessageIds(trimmed);
  if (tokens.length > 0) return tokens[0]!;

  // Otherwise, see if the trimmed value is a bare `local@domain` (no angle
  // brackets) and wrap it. A provider UUID has no `@` and is rejected here.
  const bare = trimmed.replace(/^[<>\s]+|[<>\s]+$/g, "");
  const bareMatch = bare.match(/^([^<>\s]+)@([^<>\s]+)$/);
  if (bareMatch && bareMatch[1] && bareMatch[2]) {
    return `<${bareMatch[1]}@${bareMatch[2]}>`;
  }
  return null;
}

/**
 * Case-insensitive header lookup across string or array values.
 * Returns the raw value so the caller can decide how to interpret it.
 */
export function getHeaderValue(
  headers: Record<string, unknown> | null | undefined,
  name: string
): string | string[] | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const target = name.trim().toLowerCase();
  if (!target) return undefined;

  for (const [key, value] of Object.entries(headers)) {
    if (String(key).trim().toLowerCase() !== target) continue;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : ""));
    return undefined;
  }
  return undefined;
}

/** The message-id of a message, or null when it carries none. */
export function messageIdOf(message: { messageIdHeader?: string | null }): string | null {
  return normalizeRfcMessageId(message.messageIdHeader);
}

/** All message-ids of a message that participate in a threading chain. */
export function messageChainIds(message: {
  messageIdHeader?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
}): string[] {
  const ids: string[] = [];
  for (const value of [message.messageIdHeader, message.inReplyTo, message.references]) {
    ids.push(...extractMessageIds(value));
  }
  return dedupe(ids);
}

/** De-duplicates while preserving first-seen order. */
export function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}