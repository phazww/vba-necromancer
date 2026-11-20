import type { VBAValue } from "@vba-necromancer/workbook";

/** 1 -> "A", 27 -> "AA", 16384 -> "XFD". */
export function colLetters(col: number): string {
  let s = "";
  let n = col;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** `B7` for row 7, column 2. */
export function address(row: number, col: number): string {
  return `${colLetters(col)}${row}`;
}

/** "H2" or "$B$3" -> { row, col }; null when it is not a cell reference inside the sheet. */
export function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?([1-9]\d*)$/.exec(ref.trim());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = Number(m[2]);
  return row <= 1_048_576 && col <= 16_384 ? { row, col } : null;
}

const PLAIN_SHEET_NAME = /^[\p{L}_][\p{L}\p{N}_.]*$/u;
const LOOKS_LIKE_REF = /^([A-Za-z]{1,3}\d+|[Rr]\d*[Cc]\d*|[Rr]|[Cc])$/;

/** `Sheet!B7`, or `'My Sheet'!B7` when the name needs quotes. */
export function qualified(sheet: string, row: number, col: number): string {
  const plain = PLAIN_SHEET_NAME.test(sheet) && !LOOKS_LIKE_REF.test(sheet);
  const name = plain ? sheet : `'${sheet.replace(/'/g, "''")}'`;
  return `${name}!${address(row, col)}`;
}

/**
 * The text of a cell value in the grid and trace.
 *
 * Numbers are rounded to 15 significant digits, as Excel stores them for display, so
 * `0.1 + 0.2` shows `0.3`. Magnitudes from 1e-6 up to (not including) 1e21 are written
 * in plain decimal; others use Excel's exponent form (`1E+21`, `1.5E-07`).
 * Booleans are `TRUE` and `FALSE`, empty is the empty string. Arrays never reach this
 * function (a cell holds a scalar); they give an empty string.
 */
export function formatValue(v: VBAValue): string {
  if (v === null || Array.isArray(v)) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return "0";
  const rounded = Number(v.toPrecision(15));
  const abs = Math.abs(rounded);
  if (abs >= 1e-6 && abs < 1e21) return String(rounded);
  const [mantissa, exponent] = rounded.toExponential().split("e");
  const sign = exponent.startsWith("-") ? "-" : "+";
  return `${mantissa}E${sign}${exponent.replace(/^[+-]/, "").padStart(2, "0")}`;
}

/** 5212 -> "5.1 KB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
