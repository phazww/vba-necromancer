/**
 * In-memory workbook used by tests until the real adapter (TASK-10) exists.
 * Cells are stored sparsely; empty cells read as null.
 */

import type { RangeHandle, SheetHandle, VBAValue, WorkbookHandle, XlDirection } from "./host.js";
import { MAX_COLS, MAX_ROWS } from "./host.js";

export interface MemorySheetInit {
  name: string;
  cells?: Array<{ row: number; col: number; value: VBAValue }>;
}

function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseCell(ref: string): { row: number; col: number } {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref.trim());
  if (!m) throw new Error(`Bad cell reference: ${ref}`);
  const row = Number(m[2]);
  const col = colNumber(m[1]);
  if (row < 1 || row > MAX_ROWS || col < 1 || col > MAX_COLS) {
    throw new Error(`Cell reference out of range: ${ref}`);
  }
  return { row, col };
}

class MemoryRange implements RangeHandle {
  constructor(
    readonly sheet: MemorySheet,
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

  end(direction: XlDirection): RangeHandle {
    const dr = direction === "xlUp" ? -1 : direction === "xlDown" ? 1 : 0;
    const dc = direction === "xlLeft" ? -1 : direction === "xlRight" ? 1 : 0;
    let r = this.topRow;
    let c = this.leftCol;
    const inside = (rr: number, cc: number): boolean => rr >= 1 && rr <= MAX_ROWS && cc >= 1 && cc <= MAX_COLS;
    const filled = (rr: number, cc: number): boolean => this.sheet.getCellValue(rr, cc) !== null;
    if (inside(r + dr, c + dc)) {
      if (filled(r, c) && filled(r + dr, c + dc)) {
        // Walk to the last cell of the contiguous block.
        while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) {
          r += dr;
          c += dc;
        }
      } else {
        // Jump to the next filled cell, or the sheet edge when there is none.
        r += dr;
        c += dc;
        while (inside(r, c) && !filled(r, c)) {
          if (!inside(r + dr, c + dc)) break;
          r += dr;
          c += dc;
        }
      }
    }
    return new MemoryRange(this.sheet, r, c, r, c);
  }
}

class MemorySheet implements SheetHandle {
  private readonly cells = new Map<string, VBAValue>();

  constructor(
    readonly name: string,
    readonly index: number,
  ) {}

  private key(row: number, col: number): string {
    return `${row},${col}`;
  }

  getCellValue(row: number, col: number): VBAValue {
    return this.cells.get(this.key(row, col)) ?? null;
  }

  setCellValue(row: number, col: number, value: VBAValue): void {
    if (value === null) this.cells.delete(this.key(row, col));
    else this.cells.set(this.key(row, col), value);
  }

  getCellFormula(): string | null {
    return null;
  }

  getRange(ref: string): RangeHandle {
    const [a, b] = ref.split(":");
    const first = parseCell(a);
    const last = b === undefined ? first : parseCell(b);
    return new MemoryRange(
      this,
      Math.min(first.row, last.row),
      Math.min(first.col, last.col),
      Math.max(first.row, last.row),
      Math.max(first.col, last.col),
    );
  }

  usedRowCount(): number {
    let max = 0;
    for (const k of this.cells.keys()) max = Math.max(max, Number(k.split(",")[0]));
    return max;
  }

  usedColCount(): number {
    let max = 0;
    for (const k of this.cells.keys()) max = Math.max(max, Number(k.split(",")[1]));
    return max;
  }
}

export class MemoryWorkbook implements WorkbookHandle {
  private readonly all: MemorySheet[];

  constructor(sheets: MemorySheetInit[]) {
    this.all = sheets.map((init, i) => {
      const sheet = new MemorySheet(init.name, i + 1);
      for (const c of init.cells ?? []) sheet.setCellValue(c.row, c.col, c.value);
      return sheet;
    });
  }

  get sheets(): Array<{ name: string; index: number }> {
    return this.all.map((s) => ({ name: s.name, index: s.index }));
  }

  get activeSheet(): SheetHandle {
    return this.all[0];
  }

  getSheet(nameOrIndex: string | number): SheetHandle {
    const found =
      typeof nameOrIndex === "number"
        ? this.all[nameOrIndex - 1]
        : this.all.find((s) => s.name.toLowerCase() === nameOrIndex.toLowerCase());
    if (!found) throw new Error(`No sheet: ${String(nameOrIndex)}`);
    return found;
  }

  /** Test helper: read a cell by sheet name. */
  cell(sheet: string, row: number, col: number): VBAValue {
    return this.getSheet(sheet).getCellValue(row, col);
  }
}
