/** VBA comparison operators (=, <>, <, >, <=, >=). */

import { RuntimeError } from "./errors.js";
import { numOperand, unwrap } from "./arith.js";
import { IntValue, VbArray, isNothing, parseNumber, type Value } from "./values.js";

export type CompareMode = "binary" | "text";

function isNumeric(v: Value): boolean {
  return typeof v === "number" || v instanceof IntValue || typeof v === "boolean";
}

export function compareStrings(a: string, b: string, mode: CompareMode): number {
  if (mode === "text") {
    a = a.toLowerCase();
    b = b.toLowerCase();
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Three-way comparison of two scalars.
 *
 * Number vs String: when `convert` is true (a side has a declared type, such as a literal or a
 * typed variable) the string becomes a number, or error 13 if it is not numeric. When both sides
 * are Variants, VBA orders every number before every string.
 */
export function compareValues(left: Value, right: Value, mode: CompareMode, convert: boolean): number {
  const a = unwrap(left);
  const b = unwrap(right);
  if (a instanceof VbArray || b instanceof VbArray || isNothing(a) || isNothing(b)) {
    throw new RuntimeError(13, "Type mismatch");
  }
  const aStr = typeof a === "string";
  const bStr = typeof b === "string";
  if (aStr && bStr) return compareStrings(a, b, mode);
  if (aStr && b === null) return compareStrings(a, "", mode);
  if (bStr && a === null) return compareStrings("", b, mode);
  if (aStr && isNumeric(b)) {
    if (!convert) return 1;
    const n = parseNumber(a);
    if (n === null) throw new RuntimeError(13, "Type mismatch");
    return Math.sign(n - numOperand(b).n);
  }
  if (bStr && isNumeric(a)) {
    if (!convert) return -1;
    const n = parseNumber(b);
    if (n === null) throw new RuntimeError(13, "Type mismatch");
    return Math.sign(numOperand(a).n - n);
  }
  const x = numOperand(a).n;
  const y = numOperand(b).n;
  return x < y ? -1 : x > y ? 1 : 0;
}

export function applyComparison(op: string, cmp: number): boolean {
  switch (op) {
    case "=":
      return cmp === 0;
    case "<>":
      return cmp !== 0;
    case "<":
      return cmp < 0;
    case ">":
      return cmp > 0;
    case "<=":
      return cmp <= 0;
    case ">=":
      return cmp >= 0;
    default:
      throw new RuntimeError(5, `Unknown comparison ${op}`);
  }
}
