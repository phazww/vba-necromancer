/**
 * The workbook interface the interpreter runs against. It is defined in the vba package
 * (host.ts) so the interpreter never depends on a spreadsheet library; this package
 * implements it. SaveableWorkbook adds what the app needs on top.
 */
import type { RangeHandle, SheetHandle, VBAValue, WorkbookHandle, XlDirection } from "@vba-necromancer/vba";

export type { RangeHandle, SheetHandle, VBAValue, WorkbookHandle, XlDirection };

export interface SaveableWorkbook extends WorkbookHandle {
  /** Serialises the workbook as .xlsx. */
  save(): Uint8Array;
}
