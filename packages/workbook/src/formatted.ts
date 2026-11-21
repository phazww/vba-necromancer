import type { SheetHandle } from "./types.js";

/** A sheet that knows the number formats of its cells. Optional: not every `SheetHandle` has them. */
export interface FormattedSheet {
  /** The number format string of a numeric cell, or null (no cell, not a number, no format or General). */
  getCellFormat(row: number, col: number): string | null;
}

export function hasCellFormats(sheet: SheetHandle): sheet is SheetHandle & FormattedSheet {
  return typeof (sheet as Partial<FormattedSheet>).getCellFormat === "function";
}
