/**
 * Runtime value model.
 *
 *  - Double      -> JS number
 *  - Integer/Long-> IntValue (tagged, so `i + 1` overflows as 16-bit when `i` is an Integer)
 *  - String      -> JS string
 *  - Boolean     -> JS boolean
 *  - Empty       -> null
 *  - Nothing     -> NOTHING
 *  - Arrays      -> VbArray (column-major, like VBA, so ReDim Preserve is a prefix copy)
 *  - Objects     -> VbObject
 *
 * Dates are plain numbers (days since 1899-12-30), same as in cells.
 * All numeric rounding and overflow rules come from coerce.ts.
 */

import { RuntimeError, UnsupportedError } from "./errors.js";
import { toInteger, toLong } from "./coerce.js";

export class IntValue {
  constructor(
    readonly n: number,
    readonly long: boolean,
  ) {}
}

export class NothingValue {
  readonly isNothing = true;
}
export const NOTHING = new NothingValue();

export interface VbObject {
  readonly typeName: string;
  /** Property read or method call that returns a value. */
  get(member: string, args: Value[]): Value;
  /** Property assignment. */
  set(member: string, args: Value[], value: Value): void;
  /** Value used when the object appears where a plain value is required. */
  defaultValue?(): Value;
  /** Member used for `obj(args)` and `obj(args) = v`. */
  readonly defaultMember?: string;
  /** Lower-case members that accept `obj.Member(args) = v`. */
  readonly indexedSetters?: ReadonlySet<string>;
  /** Elements visited by `For Each`; a snapshot. */
  enumerate?(): Value[];
}

export type Value = null | number | string | boolean | IntValue | VbArray | VbObject | NothingValue;

export function isObject(v: Value): v is VbObject {
  return typeof v === "object" && v !== null && "typeName" in v && "get" in v;
}

export function isNothing(v: Value): v is NothingValue {
  return v instanceof NothingValue;
}

// ─── Integer / Long ─────────────────────────────────────────────────────────

/** Integer value; throws error 6 outside the 16-bit range. */
export function mkInt(n: number): IntValue {
  if (n < -32768 || n > 32767) throw new RuntimeError(6, "Overflow");
  return new IntValue(n, false);
}

/** Long value; throws error 6 outside the 32-bit range. */
export function mkLong(n: number): IntValue {
  if (n < -2147483648 || n > 2147483647) throw new RuntimeError(6, "Overflow");
  return new IntValue(n, true);
}

// ─── Number <-> string ──────────────────────────────────────────────────────

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Parse a numeric string the way CDbl does with a "." decimal separator. */
export function parseNumber(s: string): number | null {
  const t = s.trim();
  if (!NUMBER_RE.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Format a Double the way CStr does: at most 15 significant digits, "E+nn" exponents. */
export function numToString(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const rounded = Number(n.toPrecision(15));
  const s = String(rounded);
  const m = /^(-?[\d.]+)e([+-])(\d+)$/.exec(s);
  if (!m) return s;
  return `${m[1]}E${m[2]}${m[3].padStart(2, "0")}`;
}

// ─── Scalar conversions ─────────────────────────────────────────────────────

function unwrapDefault(v: Value): Value {
  if (isObject(v)) {
    if (v.defaultValue) return v.defaultValue();
    throw new RuntimeError(438, "Object doesn't support this property or method");
  }
  return v;
}

/** Numeric value of a scalar. Empty is 0, True is -1, strings must look numeric (else error 13). */
export function toNum(v: Value): number {
  v = unwrapDefault(v);
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (v instanceof IntValue) return v.n;
  if (typeof v === "boolean") return v ? -1 : 0;
  if (typeof v === "string") {
    const n = parseNumber(v);
    if (n === null) throw new RuntimeError(13, "Type mismatch");
    return n;
  }
  throw new RuntimeError(13, "Type mismatch");
}

export function toStr(v: Value): string {
  v = unwrapDefault(v);
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return numToString(v);
  if (v instanceof IntValue) return String(v.n);
  if (typeof v === "boolean") return v ? "True" : "False";
  throw new RuntimeError(13, "Type mismatch");
}

export function toBool(v: Value): boolean {
  v = unwrapDefault(v);
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true") return true;
    if (t === "false") return false;
  }
  return toNum(v) !== 0;
}

/** Long index/count argument (rounded half to even, like VBA). */
export function toLongArg(v: Value): number {
  return toLong(toNum(v));
}

// ─── Types ──────────────────────────────────────────────────────────────────

const SUPPORTED_TYPES = new Map<string, string>([
  ["integer", "Integer"],
  ["long", "Long"],
  ["double", "Double"],
  ["string", "String"],
  ["boolean", "Boolean"],
  ["date", "Date"],
  ["variant", "Variant"],
  ["object", "Object"],
  ["worksheet", "Worksheet"],
  ["range", "Range"],
  ["workbook", "Workbook"],
  ["scripting.dictionary", "Dictionary"],
]);

/** Canonical type name, or null when the type is not supported by this interpreter. */
export function canonicalType(name: string | null): string | null {
  if (name === null) return "Variant";
  const key = name.toLowerCase().replace(/^excel\./, "");
  return SUPPORTED_TYPES.get(key) ?? null;
}

export function isObjectType(type: string): boolean {
  return (
    type === "Object" || type === "Worksheet" || type === "Range" || type === "Workbook" || type === "Dictionary"
  );
}

export function defaultValueFor(type: string): Value {
  switch (type) {
    case "Integer":
      return new IntValue(0, false);
    case "Long":
      return new IntValue(0, true);
    case "Double":
    case "Date":
      return 0;
    case "String":
      return "";
    case "Boolean":
      return false;
    case "Object":
    case "Worksheet":
    case "Range":
    case "Workbook":
    case "Dictionary":
      return NOTHING;
    default:
      return null;
  }
}

/** Convert a value for storage in a variable or array element of the given (canonical) type. */
export function coerceToType(type: string, v: Value): Value {
  if (type === "Variant") {
    if (v instanceof VbArray) return v.copy();
    return v;
  }
  if (type === "Dictionary") {
    if (isNothing(v) || (isObject(v) && v.typeName === "Dictionary")) return v;
    throw new RuntimeError(13, "Type mismatch");
  }
  if (isObjectType(type)) {
    if (isObject(v) || isNothing(v)) return v;
    throw new RuntimeError(91, "Object variable or With block variable not set");
  }
  if (v instanceof VbArray) throw new RuntimeError(13, "Type mismatch");
  switch (type) {
    case "Integer":
      return new IntValue(toInteger(toNum(v)), false);
    case "Long":
      return new IntValue(toLong(toNum(v)), true);
    case "Double":
      return toNum(v);
    case "Date":
      if (typeof unwrapDefault(v) === "string") throw new UnsupportedError("", 0, "Date from string");
      return toNum(v);
    case "String":
      return toStr(v);
    case "Boolean":
      return toBool(v);
    default:
      throw new UnsupportedError("", 0, `As ${type}`);
  }
}

export function typeNameOf(v: Value): string {
  if (v === null) return "Empty";
  if (typeof v === "number") return "Double";
  if (typeof v === "string") return "String";
  if (typeof v === "boolean") return "Boolean";
  if (v instanceof IntValue) return v.long ? "Long" : "Integer";
  if (v instanceof VbArray) return `${v.elemType ?? "Variant"}()`;
  if (isNothing(v)) return "Nothing";
  return v.typeName;
}

// ─── Arrays ─────────────────────────────────────────────────────────────────

const MAX_ARRAY_ELEMENTS = 50_000_000;

export class VbArray {
  private constructor(
    readonly lbounds: number[],
    readonly ubounds: number[],
    /** Canonical element type; "Variant" for untyped arrays. */
    readonly elemType: string,
    readonly data: Value[],
  ) {}

  /** A dynamic array that has not been sized yet (`Dim a() As String`). */
  static unallocated(elemType: string): VbArray {
    return new VbArray([], [], elemType, []);
  }

  static allocate(lbounds: number[], ubounds: number[], elemType: string): VbArray {
    let size = 1;
    for (let d = 0; d < lbounds.length; d++) {
      size *= Math.max(0, ubounds[d] - lbounds[d] + 1);
      if (size > MAX_ARRAY_ELEMENTS) throw new RuntimeError(7, "Out of memory");
    }
    const data: Value[] = new Array<Value>(size);
    for (let i = 0; i < size; i++) data[i] = defaultValueFor(elemType);
    return new VbArray(lbounds, ubounds, elemType, data);
  }

  /** One-dimensional array from existing values. */
  static from1D(values: Value[], lbound: number, elemType: string): VbArray {
    return new VbArray([lbound], [lbound + values.length - 1], elemType, values);
  }

  get allocated(): boolean {
    return this.lbounds.length > 0;
  }

  get dims(): number {
    return this.lbounds.length;
  }

  private offset(indices: number[]): number {
    if (!this.allocated || indices.length !== this.dims) {
      throw new RuntimeError(9, "Subscript out of range");
    }
    let offset = 0;
    let stride = 1;
    for (let d = 0; d < indices.length; d++) {
      const i = indices[d];
      if (i < this.lbounds[d] || i > this.ubounds[d]) {
        throw new RuntimeError(9, "Subscript out of range");
      }
      offset += (i - this.lbounds[d]) * stride;
      stride *= this.ubounds[d] - this.lbounds[d] + 1;
    }
    return offset;
  }

  get(indices: number[]): Value {
    return this.data[this.offset(indices)];
  }

  set(indices: number[], v: Value): void {
    this.data[this.offset(indices)] = coerceToType(this.elemType, v);
  }

  copy(): VbArray {
    const data = this.data.map((x) => (x instanceof VbArray ? x.copy() : x));
    return new VbArray([...this.lbounds], [...this.ubounds], this.elemType, data);
  }

  /**
   * New array with the given bounds. With `preserve`, only the last dimension may change
   * (error 9 otherwise) and existing elements are kept.
   */
  redim(lbounds: number[], ubounds: number[], preserve: boolean): VbArray {
    const fresh = VbArray.allocate(lbounds, ubounds, this.elemType);
    if (!preserve || !this.allocated) return fresh;
    if (lbounds.length !== this.dims) throw new RuntimeError(9, "Subscript out of range");
    const last = this.dims - 1;
    for (let d = 0; d < last; d++) {
      if (lbounds[d] !== this.lbounds[d] || ubounds[d] !== this.ubounds[d]) {
        throw new RuntimeError(9, "Subscript out of range");
      }
    }
    if (lbounds[last] !== this.lbounds[last]) throw new RuntimeError(9, "Subscript out of range");
    const keep = Math.min(this.data.length, fresh.data.length);
    for (let i = 0; i < keep; i++) fresh.data[i] = this.data[i];
    return fresh;
  }
}
