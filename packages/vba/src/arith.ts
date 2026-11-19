/**
 * VBA arithmetic with Integer/Long/Double typing.
 * Rounding, Mod and integer division come from coerce.ts.
 */

import { RuntimeError } from "./errors.js";
import { intDiv, toLong, vbaMod } from "./coerce.js";
import { IntValue, isObject, mkInt, mkLong, parseNumber, toStr, type Value } from "./values.js";

export type NumKind = "int" | "long" | "double";

export interface Num {
  n: number;
  kind: NumKind;
}

export function unwrap(v: Value): Value {
  if (isObject(v)) {
    if (v.defaultValue) return v.defaultValue();
    throw new RuntimeError(438, "Object doesn't support this property or method");
  }
  return v;
}

/** Numeric operand with its VBA type. Empty and Boolean act as Integer; numeric strings as Double. */
export function numOperand(v: Value): Num {
  v = unwrap(v);
  if (v === null) return { n: 0, kind: "int" };
  if (typeof v === "number") return { n: v, kind: "double" };
  if (v instanceof IntValue) return { n: v.n, kind: v.long ? "long" : "int" };
  if (typeof v === "boolean") return { n: v ? -1 : 0, kind: "int" };
  if (typeof v === "string") {
    const n = parseNumber(v);
    if (n === null) throw new RuntimeError(13, "Type mismatch");
    return { n, kind: "double" };
  }
  throw new RuntimeError(13, "Type mismatch");
}

function widest(a: NumKind, b: NumKind): NumKind {
  if (a === "double" || b === "double") return "double";
  if (a === "long" || b === "long") return "long";
  return "int";
}

/** Store a result in its VBA type; Integer and Long results overflow with error 6. */
export function box(n: number, kind: NumKind): Value {
  if (kind === "int") return mkInt(n);
  if (kind === "long") return mkLong(n);
  if (!Number.isFinite(n)) throw new RuntimeError(6, "Overflow");
  return n;
}

export function arith(op: string, left: Value, right: Value): Value {
  const l = unwrap(left);
  const r = unwrap(right);

  if (op === "+") {
    const ls = typeof l === "string";
    const rs = typeof r === "string";
    if ((ls && (rs || r === null)) || (rs && l === null)) return toStr(l) + toStr(r);
  }

  const a = numOperand(l);
  const b = numOperand(r);

  switch (op) {
    case "+":
      return box(a.n + b.n, widest(a.kind, b.kind));
    case "-":
      return box(a.n - b.n, widest(a.kind, b.kind));
    case "*":
      return box(a.n * b.n, widest(a.kind, b.kind));
    case "/":
      if (b.n === 0) throw new RuntimeError(11, "Division by zero");
      return box(a.n / b.n, "double");
    case "^": {
      if (a.n === 0 && b.n < 0) throw new RuntimeError(11, "Division by zero");
      const p = Math.pow(a.n, b.n);
      if (Number.isNaN(p)) throw new RuntimeError(5, "Invalid procedure call or argument");
      return box(p, "double");
    }
    case "\\":
      // Operands become Long first (overflow = error 6), then are rounded and truncated.
      return box(intDiv(toLong(a.n), toLong(b.n)), widest(a.kind, b.kind) === "int" ? "int" : "long");
    case "mod":
      return box(vbaMod(toLong(a.n), toLong(b.n)), widest(a.kind, b.kind) === "int" ? "int" : "long");
    default:
      throw new RuntimeError(5, `Unknown operator ${op}`);
  }
}

export function negate(v: Value): Value {
  const a = numOperand(v);
  return box(-a.n, a.kind);
}
