import type { CurrencyCode, MinorUnits } from "@/types/domain";

/**
 * Money handling for Quote24x7.
 *
 * JavaScript has no decimal type, so every monetary value in this project is an
 * integer count of minor units (paise / cents). Nothing here ever produces a
 * fractional intermediate: multiplication is by whole pack counts, and the only
 * division is in `formatMoney`, which is a display concern.
 *
 * The future Python service uses `Decimal` for the same arithmetic. Both must
 * produce identical totals for identical inputs; that is what makes a quote
 * reproducible from its stored catalogue version.
 */

const MINOR_UNITS_PER_MAJOR: Record<CurrencyCode, number> = {
  INR: 100,
  USD: 100,
  EUR: 100,
  GBP: 100,
};

const LOCALE_BY_CURRENCY: Record<CurrencyCode, string> = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
};

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

function assertIntegerMinor(value: number, context: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(
      `${context}: expected an integer number of minor units, received ${value}. ` +
        "Fractional currency values are not representable in this engine.",
    );
  }
}

/** Sum of minor-unit amounts. Throws rather than silently losing precision. */
export function sumMinor(values: readonly MinorUnits[], context = "sumMinor"): MinorUnits {
  let total = 0;
  for (const value of values) {
    assertIntegerMinor(value, context);
    total += value;
  }
  assertIntegerMinor(total, context);
  return total;
}

/** Unit price × whole quantity. Quantity must be a non-negative integer. */
export function multiplyMinor(
  unitPrice: MinorUnits,
  quantity: number,
  context = "multiplyMinor",
): MinorUnits {
  assertIntegerMinor(unitPrice, context);
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new MoneyError(`${context}: quantity must be a non-negative integer, received ${quantity}.`);
  }
  const total = unitPrice * quantity;
  assertIntegerMinor(total, context);
  return total;
}

/** Formats minor units for display, e.g. 97110000 + "INR" -> "₹9,71,100.00". */
export function formatMoney(
  minor: MinorUnits,
  currency: CurrencyCode,
  options: { compact?: boolean; showDecimals?: boolean } = {},
): string {
  const { compact = false, showDecimals = true } = options;
  const divisor = MINOR_UNITS_PER_MAJOR[currency];
  const major = minor / divisor;

  return new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency], {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : showDecimals ? 2 : 0,
    minimumFractionDigits: compact ? 0 : showDecimals ? 2 : 0,
  }).format(major);
}

/** Currency symbol on its own, for table headers and axis labels. */
export function currencySymbol(currency: CurrencyCode): string {
  const parts = new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency], {
    style: "currency",
    currency,
  }).formatToParts(0);
  return parts.find((part) => part.type === "currency")?.value ?? currency;
}

/** Whole packs needed to cover `required` units at `packSize` per pack. */
export function packsRequired(required: number, packSize: number): number {
  if (packSize <= 0) {
    throw new MoneyError(`packsRequired: packSize must be positive, received ${packSize}.`);
  }
  if (required <= 0) return 0;
  return Math.ceil(required / packSize);
}
