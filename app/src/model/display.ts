import { formatNumber, hasCellFormats } from "@vba-necromancer/workbook";
import type { SheetHandle, VBAValue } from "@vba-necromancer/workbook";
import { formatValue } from "./format";

/**
 * The text of a cell in the grid. A number in a cell with a number format is shown through
 * that format; everything else is `formatValue`. The stored value is not changed.
 */
export function displayText(sheet: SheetHandle, row: number, col: number, value: VBAValue): string {
  if (typeof value === "number" && hasCellFormats(sheet)) {
    const format = sheet.getCellFormat(row, col);
    if (format !== null) return formatNumber(value, format);
  }
  return formatValue(value);
}
