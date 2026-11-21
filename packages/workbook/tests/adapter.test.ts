import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as XLSX from "xlsx";
import { hasCellFormats, openWorkbook } from "../src/index.js";

const ROOT = resolve(__dirname, "../../..");
const bytes = (): Uint8Array => new Uint8Array(readFileSync(resolve(ROOT, "fixtures/build/acts_by_category.xlsm")));
const cells = JSON.parse(
  readFileSync(resolve(ROOT, "fixtures/src/acts_by_category/cells.json"), "utf8"),
) as { sheets: Array<{ name: string; cells: Array<{ row: number; col: number; value: number | string | boolean }> }> };
const initial = (row: number, col: number) => cells.sheets[0].cells.find((c) => c.row === row && c.col === col)?.value ?? null;

describe("SheetJS workbook adapter", () => {
  it("lists the sheets of the fixture in order", () => {
    const wb = openWorkbook(bytes());
    expect(wb.sheets).toEqual(cells.sheets.map((s, i) => ({ name: s.name, index: i + 1 })));
    expect(wb.getSheet("журнал").name).toBe(cells.sheets[0].name);
    expect(() => wb.getSheet("нет такого")).toThrow();
  });

  it("reads the cells stored in cells.json", () => {
    const sheet = openWorkbook(bytes()).getSheet(1);
    for (const c of cells.sheets[0].cells) expect(sheet.getCellValue(c.row, c.col)).toEqual(c.value);
    expect(sheet.getCellValue(100, 100)).toBeNull();
  });

  it("writes and reads back a number, and null clears a cell", () => {
    const sheet = openWorkbook(bytes()).getSheet(1);
    sheet.setCellValue(2, 30, 42);
    expect(sheet.getCellValue(2, 30)).toBe(42);
    sheet.setCellValue(2, 30, null);
    expect(sheet.getCellValue(2, 30)).toBeNull();
  });

  it("A1:B2 is a 2-D array and A1 is a scalar", () => {
    const sheet = openWorkbook(bytes()).getSheet(1);
    expect(sheet.getRange("A1:B2").getValue()).toEqual([
      [initial(1, 1), initial(1, 2)],
      [initial(2, 1), initial(2, 2)],
    ]);
    expect(sheet.getRange("A1").getValue()).toBe(initial(1, 1));
  });

  it("setValue on a range writes a 2-D array and broadcasts a scalar", () => {
    const sheet = openWorkbook(bytes()).getSheet(2);
    sheet.getRange("A1:B2").setValue([[1, "x"], [true, null]]);
    expect(sheet.getRange("A1:B2").getValue()).toEqual([[1, "x"], [true, null]]);
    sheet.getRange("D1:D3").setValue(7);
    expect(sheet.getRange("D1:D3").getValue()).toEqual([[7], [7], [7]]);
  });

  it("End(xlUp) from below the data finds the last filled row", () => {
    const sheet = openWorkbook(bytes()).getSheet(1);
    const last = sheet.getRange("B500").end("xlUp");
    expect(last.topRow).toBe(Math.max(...cells.sheets[0].cells.map((c) => c.row)));
    expect(last.leftCol).toBe(2);
    expect(sheet.getRange("A1").end("xlDown").topRow).toBe(last.topRow);
    expect(sheet.getRange("A1").end("xlRight").leftCol).toBe(6);
  });

  it("tracks the used range after writes", () => {
    const sheet = openWorkbook(bytes()).getSheet(2);
    expect(sheet.usedRowCount()).toBe(0);
    sheet.setCellValue(5, 3, "x");
    expect([sheet.usedRowCount(), sheet.usedColCount()]).toEqual([5, 3]);
  });

  it("rejects malformed references", () => {
    const sheet = openWorkbook(bytes()).getSheet(1);
    expect(() => sheet.getRange("A")).toThrow();
    expect(() => sheet.getRange("A1:B2:C3")).toThrow();
  });

  it("save() produces an .xlsx that SheetJS reads back with the written values", () => {
    const wb = openWorkbook(bytes());
    wb.getSheet(2).setCellValue(1, 1, "результат");
    const out = wb.save();
    const back = XLSX.read(out, { type: "array" });
    expect(back.SheetNames).toEqual(wb.sheets.map((s) => s.name));
    expect(openWorkbook(out).getSheet(2).getCellValue(1, 1)).toBe("результат");
    expect(openWorkbook(out).getSheet(1).getCellValue(1, 1)).toBe(initial(1, 1));
  });

  it("exposes formulas with a leading = and their cached value", () => {
    const ws = XLSX.utils.aoa_to_sheet([[2, 3]]);
    ws["C1"] = { t: "n", v: 5, f: "A1+B1" };
    ws["!ref"] = "A1:C1";
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, "S");
    const sheet = openWorkbook(new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer)).getSheet(1);
    expect(sheet.getCellFormula(1, 3)).toBe("=A1+B1");
    expect(sheet.getCellValue(1, 3)).toBe(5);
    expect(sheet.getCellFormula(1, 1)).toBeNull();
    sheet.setCellValue(1, 3, 9);
    expect(sheet.getCellFormula(1, 3)).toBeNull();
  });
});

describe("number formats on cells (FMT-01, FMT-05)", () => {
  function withFormats(): Uint8Array {
    const ws: XLSX.WorkSheet = {
      A1: { t: "n", v: 46296, z: "yyyy-mm-dd" },
      A2: { t: "s", v: "text", z: "0.00" },
      A3: { t: "n", v: 5 },
      A4: { t: "n", v: 1234.5, z: "#,##0.00" },
      "!ref": "A1:A4",
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "S");
    return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
  }
  const sheetOf = (b: Uint8Array) => {
    const s = openWorkbook(b).getSheet("S");
    if (!hasCellFormats(s)) throw new Error("expected a sheet with formats");
    return s;
  };

  it("FMT-01 getCellFormat reports the format of a numeric cell and the stored value is unchanged", () => {
    const s = sheetOf(withFormats());
    expect(s.getCellFormat(1, 1)).toBe("yyyy-mm-dd");
    expect(s.getCellValue(1, 1)).toBe(46296);
    expect(s.getCellFormat(4, 1)).toBe("#,##0.00");
  });
  it("FMT-01 a string cell, an empty cell and a cell without a format report null", () => {
    const s = sheetOf(withFormats());
    expect(s.getCellFormat(2, 1)).toBeNull();
    expect(s.getCellFormat(9, 9)).toBeNull();
    expect(s.getCellFormat(3, 1)).toBeNull(); // SheetJS reads "General" for it; General is reported as no format
  });
  it("FMT-05 setCellValue keeps the format for a number, a string and a boolean", () => {
    const s = sheetOf(withFormats());
    s.setCellValue(1, 1, 46297);
    expect(s.getCellFormat(1, 1)).toBe("yyyy-mm-dd");
    expect(s.getCellValue(1, 1)).toBe(46297);
    s.setCellValue(1, 1, "x");
    s.setCellValue(1, 1, 7);
    expect(s.getCellFormat(1, 1)).toBe("yyyy-mm-dd");
    s.setCellValue(4, 1, true);
    s.setCellValue(4, 1, 2);
    expect(s.getCellFormat(4, 1)).toBe("#,##0.00");
  });
  it("FMT-05 a cell without a format stays without one; clearing a cell drops its format", () => {
    const s = sheetOf(withFormats());
    s.setCellValue(3, 1, 6);
    expect(s.getCellFormat(3, 1)).toBeNull();
    s.setCellValue(1, 1, null);
    s.setCellValue(1, 1, 3);
    expect(s.getCellFormat(1, 1)).toBeNull();
  });
  it("FMT-01 save() keeps the stored number and the format", () => {
    const s = sheetOf(withFormats());
    s.setCellValue(1, 1, 46297);
    const wb = openWorkbook(withFormats());
    const sheet = wb.getSheet("S");
    sheet.setCellValue(1, 1, 46297);
    const again = sheetOf(wb.save());
    expect(again.getCellValue(1, 1)).toBe(46297);
    expect(again.getCellFormat(1, 1)).toBe("yyyy-mm-dd");
    expect(again.getCellFormat(4, 1)).toBe("#,##0.00");
  });
  it("FMT-01 hasCellFormats tells sheets with formats from those without", () => {
    const s = sheetOf(withFormats());
    expect(hasCellFormats(s)).toBe(true);
    const plain = { name: "x" } as unknown as Parameters<typeof hasCellFormats>[0];
    expect(hasCellFormats(plain)).toBe(false);
  });
});
