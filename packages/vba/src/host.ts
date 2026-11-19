/**
 * Minimal workbook interface the interpreter runs against.
 *
 * This mirrors the subset of design.md section 4.1 that TASK-08 needs. TASK-10 adds the
 * real adapter in packages/workbook; at that point these types become imports from there
 * (the shape is kept compatible on purpose).
 */

export type VBAValue = number | string | boolean | null | VBAValue[][];

export type XlDirection = "xlUp" | "xlDown" | "xlLeft" | "xlRight";

export interface RangeHandle {
  sheet: SheetHandle;
  topRow: number;
  leftCol: number;
  bottomRow: number;
  rightCol: number;
  /** Scalar for a 1x1 range, otherwise a 2-D array of rows (0-based JS array). */
  getValue(): VBAValue;
  /** Broadcasts a scalar, or writes a 2-D array cell by cell. */
  setValue(v: VBAValue): void;
  end(direction: XlDirection): RangeHandle;
}

export interface SheetHandle {
  name: string;
  /** 1-based. */
  index: number;
  getCellValue(row: number, col: number): VBAValue;
  setCellValue(row: number, col: number, value: VBAValue): void;
  getRange(ref: string): RangeHandle;
  usedRowCount(): number;
  usedColCount(): number;
}

export interface WorkbookHandle {
  sheets: Array<{ name: string; index: number }>;
  activeSheet: SheetHandle;
  /** Throws when no such sheet exists; the interpreter reports it as error 9. */
  getSheet(nameOrIndex: string | number): SheetHandle;
}

export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

/** 1 -> "A", 27 -> "AA". */
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

export function cellRef(row: number, col: number): string {
  return `${colLetters(col)}${row}`;
}
