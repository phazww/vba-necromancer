import { UnsupportedError } from "../errors.js";
import type { CompareMode } from "../compare.js";
import { compareStrings } from "../compare.js";
import { VbArray, mkInt, mkLong, toLongArg, toNum, toStr, type Value } from "../values.js";
import { argc, invalidArg, type Builtin, type BuiltinContext } from "./types.js";

/** vbBinaryCompare = 0, vbTextCompare = 1, vbUseCompareOption = -1. */
function compareMode(arg: Value | undefined, fallback: CompareMode): CompareMode {
  if (arg === undefined || arg === null) return fallback;
  const n = toLongArg(arg);
  if (n === -1) return fallback;
  if (n === 0) return "binary";
  if (n === 1) return "text";
  throw new UnsupportedError("", 0, "vbDatabaseCompare");
}

const fold = (s: string, mode: CompareMode): string => (mode === "text" ? s.toLowerCase() : s);

function indexOfMode(hay: string, needle: string, from: number, mode: CompareMode): number {
  return fold(hay, mode).indexOf(fold(needle, mode), from);
}

const fn =
  (min: number, max: number, f: (args: Value[], ctx: BuiltinContext) => Value): Builtin =>
  (args, ctx) => {
    argc(args, min, max);
    return f(args, ctx);
  };

export const stringBuiltins: Record<string, Builtin> = {
  len: fn(1, 1, (a) => mkLong(toStr(a[0]).length)),
  left: fn(2, 2, (a) => {
    const n = toLongArg(a[1]);
    if (n < 0) invalidArg();
    return toStr(a[0]).slice(0, n);
  }),
  right: fn(2, 2, (a) => {
    const s = toStr(a[0]);
    const n = toLongArg(a[1]);
    if (n < 0) invalidArg();
    return n === 0 ? "" : s.slice(Math.max(0, s.length - n));
  }),
  mid: fn(2, 3, (a) => {
    const s = toStr(a[0]);
    const start = toLongArg(a[1]);
    if (start < 1) invalidArg();
    if (a.length === 3 && a[2] !== null) {
      const len = toLongArg(a[2]);
      if (len < 0) invalidArg();
      return s.substr(start - 1, len);
    }
    return s.slice(start - 1);
  }),
  // VBA trims only the space character (U+0020).
  trim: fn(1, 1, (a) => toStr(a[0]).replace(/^ +| +$/g, "")),
  ltrim: fn(1, 1, (a) => toStr(a[0]).replace(/^ +/, "")),
  rtrim: fn(1, 1, (a) => toStr(a[0]).replace(/ +$/, "")),
  ucase: fn(1, 1, (a) => toStr(a[0]).toUpperCase()),
  lcase: fn(1, 1, (a) => toStr(a[0]).toLowerCase()),
  instr: fn(2, 4, (a, ctx) => {
    // InStr([start,] string1, string2 [, compare]): 3 arguments means a start position.
    const hasStart = a.length >= 3;
    const start = hasStart ? toLongArg(a[0]) : 1;
    if (start < 1) invalidArg();
    const s1 = toStr(a[hasStart ? 1 : 0]);
    const s2 = toStr(a[hasStart ? 2 : 1]);
    const mode = compareMode(a[3], ctx.compare);
    if (s1.length === 0 || start > s1.length) return mkLong(0);
    if (s2.length === 0) return mkLong(start);
    return mkLong(indexOfMode(s1, s2, start - 1, mode) + 1);
  }),
  instrrev: fn(2, 4, (a, ctx) => {
    const s1 = toStr(a[0]);
    const s2 = toStr(a[1]);
    const start = a.length >= 3 && a[2] !== null ? toLongArg(a[2]) : -1;
    if (start === 0 || start < -1) invalidArg();
    const mode = compareMode(a[3], ctx.compare);
    if (s1.length === 0) return mkLong(0);
    const from = start === -1 ? s1.length : start;
    if (s2.length === 0) return mkLong(from);
    const idx = fold(s1, mode).lastIndexOf(fold(s2, mode), from - s2.length);
    return mkLong(idx + 1);
  }),
  replace: fn(3, 6, (a) => {
    const expr = toStr(a[0]);
    const find = toStr(a[1]);
    const repl = toStr(a[2]);
    const start = a.length >= 4 && a[3] !== null ? toLongArg(a[3]) : 1;
    const count = a.length >= 5 && a[4] !== null ? toLongArg(a[4]) : -1;
    // Unlike InStr, Replace defaults to binary compare regardless of Option Compare.
    const mode = compareMode(a[5], "binary");
    if (start < 1 || count < -1) invalidArg();
    if (find.length === 0 || start > expr.length) return start > expr.length ? "" : expr.slice(start - 1);
    const text = expr.slice(start - 1);
    const hay = fold(text, mode);
    const needle = fold(find, mode);
    let out = "";
    let pos = 0;
    let done = 0;
    while (count === -1 || done < count) {
      const idx = hay.indexOf(needle, pos);
      if (idx === -1) break;
      out += text.slice(pos, idx) + repl;
      pos = idx + find.length;
      done++;
    }
    return out + text.slice(pos);
  }),
  split: fn(1, 4, (a) => {
    const expr = toStr(a[0]);
    const delim = a.length >= 2 && a[1] !== null ? toStr(a[1]) : " ";
    const limit = a.length >= 3 && a[2] !== null ? toLongArg(a[2]) : -1;
    const mode = compareMode(a[3], "binary");
    if (limit === 0 || limit < -1) invalidArg();
    if (expr.length === 0) return VbArray.allocate([0], [-1], "String");
    const parts: string[] = [];
    if (delim.length === 0) {
      parts.push(expr);
    } else {
      const hay = fold(expr, mode);
      const needle = fold(delim, mode);
      let pos = 0;
      while (limit === -1 || parts.length < limit - 1) {
        const idx = hay.indexOf(needle, pos);
        if (idx === -1) break;
        parts.push(expr.slice(pos, idx));
        pos = idx + delim.length;
      }
      parts.push(expr.slice(pos));
    }
    return VbArray.from1D(parts, 0, "String");
  }),
  join: fn(1, 2, (a) => {
    const arr = a[0];
    if (!(arr instanceof VbArray) || arr.dims !== 1) invalidArg();
    const delim = a.length === 2 && a[1] !== null ? toStr(a[1]) : " ";
    return arr.data.map((v) => toStr(v)).join(delim);
  }),
  strcomp: fn(2, 3, (a, ctx) => {
    const mode = compareMode(a[2], ctx.compare);
    return mkInt(compareStrings(toStr(a[0]), toStr(a[1]), mode));
  }),
  space: fn(1, 1, (a) => {
    const n = toLongArg(a[0]);
    if (n < 0) invalidArg();
    return " ".repeat(n);
  }),
  string: fn(2, 2, (a) => {
    const n = toLongArg(a[0]);
    if (n < 0) invalidArg();
    const c = typeof a[1] === "string" ? a[1] : String.fromCharCode(toLongArg(a[1]));
    if (c.length === 0) invalidArg();
    return c[0].repeat(n);
  }),
  chr: fn(1, 1, (a) => {
    const n = toLongArg(a[0]);
    if (n < 0 || n > 255) invalidArg();
    // Characters above 127 depend on the system code page.
    if (n > 127) throw new UnsupportedError("", 0, "Chr above 127");
    return String.fromCharCode(n);
  }),
  chrw: fn(1, 1, (a) => {
    const n = toLongArg(a[0]);
    if (n < -32768 || n > 65535) invalidArg();
    return String.fromCharCode(n < 0 ? n + 65536 : n);
  }),
  asc: fn(1, 1, (a) => {
    const s = toStr(a[0]);
    if (s.length === 0) invalidArg();
    const code = s.charCodeAt(0);
    if (code > 127) throw new UnsupportedError("", 0, "Asc above 127");
    return mkInt(code);
  }),
  ascw: fn(1, 1, (a) => {
    const s = toStr(a[0]);
    if (s.length === 0) invalidArg();
    const code = s.charCodeAt(0);
    return mkInt(code > 32767 ? code - 65536 : code);
  }),
  val: fn(1, 1, (a) => {
    const s = toStr(a[0]).replace(/\s+/g, "");
    const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s);
    return m ? Number(m[0]) : 0;
  }),
  str: fn(1, 1, (a) => {
    const n = toNum(a[0]);
    const s = toStr(n);
    return n >= 0 ? " " + s : s;
  }),
};
