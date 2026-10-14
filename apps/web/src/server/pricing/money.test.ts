import test from "node:test";
import assert from "node:assert/strict";

import {
  sumMinor,
  multiplyMinor,
  formatMoney,
  currencySymbol,
  packsRequired,
  MoneyError,
} from "./money.ts";

test("sumMinor calculates exact integer paise sum", () => {
  const values = [1026000, 2565000, 313500]; // 10,260 + 25,650 + 3,135 in paise
  const total = sumMinor(values);
  assert.equal(total, 3904500);
});

test("sumMinor throws MoneyError on fractional amounts", () => {
  assert.throws(() => sumMinor([100.5, 200]), MoneyError);
});

test("multiplyMinor multiplies whole quantity without floating point", () => {
  const unitPrice = 2565000; // ₹25,650.00
  const quantity = 3;
  assert.equal(multiplyMinor(unitPrice, quantity), 7695000);
});

test("multiplyMinor throws on negative or fractional quantity", () => {
  assert.throws(() => multiplyMinor(1000, -1), MoneyError);
  assert.throws(() => multiplyMinor(1000, 1.5), MoneyError);
});

test("packsRequired computes ceiling of packs needed", () => {
  assert.equal(packsRequired(0, 10), 0);
  assert.equal(packsRequired(5, 10), 1);
  assert.equal(packsRequired(10, 10), 1);
  assert.equal(packsRequired(11, 10), 2);
  assert.equal(packsRequired(25, 10), 3);
});

test("formatMoney formats INR with Indian number formatting", () => {
  const paise = 97110000; // ₹9,71,100.00
  const formatted = formatMoney(paise, "INR");
  // Check currency formatting output
  assert.match(formatted, /9,71,100/);
});

test("currencySymbol returns correct symbol", () => {
  assert.equal(currencySymbol("INR"), "₹");
  assert.equal(currencySymbol("USD"), "$");
});
