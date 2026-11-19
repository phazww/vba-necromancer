import type { RangeHandle, SheetHandle, VBAValue, XlDirection } from "./types.js";

export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

export interface CellPos {
  row: number;
  col: number;
}

export function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function colLetters(col: number): string {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function parseCell(ref: string): CellPos {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref.trim());
  if (!m) throw new Error(`Bad cell reference: ${ref}`);
  const row = Number(m[2]);
  const col = colNumber(m[1]);
  if (row < 1 || row > MAX_ROWS || col < 1 || col > MAX_COLS) throw new Error(`Cell reference out of range: ${ref}`);
  return { row, col };
}

/** Parses "A1" or "A1:B2" (optionally with $) into normalised corners. Throws on anything else. */
export function parseRef(ref: string): { top: number; left: number; bottom: number; right: number } {
  const parts = ref.split(":");
  if (parts.length > 2) throw new Error(`Bad range reference: ${ref}`);
  const first = parseCell(parts[0]);
  const last = parts.length === 2 ? parseCell(parts[1]) : first;
  return {
    top: Math.min(first.row, last.row),
    left: Math.min(first.col, last.col),
    bottom: Math.max(first.row, last.row),
    right: Math.max(first.col, last.col),
  };
}

/** Cell access a range needs from its sheet. */
export interface RangeSheet extends SheetHandle {
  getRange(ref: string): RangeHandle;
}

export class SheetRange implements RangeHandle {
  constructor(
    readonly sheet: RangeSheet,
    readonly topRow: number,
    readonly leftCol: number,
    readonly bottomRow: number,
    readonly rightCol: number,
  ) {}

  getValue(): VBAValue {
    if (this.topRow === this.bottomRow && this.leftCol === this.rightCol) {
      return this.sheet.getCellValue(this.topRow, this.leftCol);
    }
    const rows: VBAValue[][] = [];
    for (let r = this.topRow; r <= this.bottomRow; r++) {
      const row: VBAValue[] = [];
      for (let c = this.leftCol; c <= this.rightCol; c++) row.push(this.sheet.getCellValue(r, c));
      rows.push(row);
    }
    return rows;
  }

  setValue(v: VBAValue): void {
    for (let r = this.topRow; r <= this.bottomRow; r++) {
      for (let c = this.leftCol; c <= this.rightCol; c++) {
        let cell: VBAValue = v;
        if (Array.isArray(v)) {
          const row = v[r - this.topRow];
          cell = Array.isArray(row) ? (row[c - this.leftCol] ?? null) : null;
        }
        this.sheet.setCellValue(r, c, cell);
      }
    }
  }

  /** Excel's Range.End: walk to the end of a filled block, or jump to the next filled cell. */
  end(direction: XlDirection): RangeHandle {
    const dr = direction === "xlUp" ? -1 : direction === "xlDown" ? 1 : 0;
    const dc = direction === "xlLeft" ? -1 : direction === "xlRight" ? 1 : 0;
    let r = this.topRow;
    let c = this.leftCol;
    const inside = (rr: number, cc: number): boolean => rr >= 1 && rr <= MAX_ROWS && cc >= 1 && cc <= MAX_COLS;
    const filled = (rr: number, cc: number): boolean => this.sheet.getCellValue(rr, cc) !== null;
    if (inside(r + dr, c + dc)) {
      if (filled(r, c) && filled(r + dr, c + dc)) {
        while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) {
          r += dr;
          c += dc;
        }
      } else {
        r += dr;
        c += dc;
        while (inside(r, c) && !filled(r, c)) {
          if (!inside(r + dr, c + dc)) break;
          r += dr;
          c += dc;
        }
      }
    }
    return new SheetRange(this.sheet, r, c, r, c);
  }
}
