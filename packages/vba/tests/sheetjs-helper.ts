/** Test helper: a workbook on the real SheetJS adapter, built from rows of values. */
import * as XLSX from "xlsx";
import { openWorkbook } from "@vba-necromancer/workbook";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { runMacro } from "../src/run.js";

export function makeWorkbook(sheets: Record<string, Array<Array<number | string | boolean | null>>>) {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return openWorkbook(new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer));
}

/** Runs `Sub T()` with the given body; results are read back through the workbook. */
export function runBody(body: string, sheets: Parameters<typeof makeWorkbook>[0]) {
  const wb = makeWorkbook(sheets);
  const src = `Sub T()\n${body}\nEnd Sub\n`;
  const result = runMacro("T", [parse(tokenize(src), "Module1")], wb);
  return { wb, result, cell: (sheet: string, row: number, col: number) => wb.getSheet(sheet).getCellValue(row, col) };
}
