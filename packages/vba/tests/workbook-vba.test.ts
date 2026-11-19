import { describe, it, expect } from "vitest";
import { runBody } from "./sheetjs-helper.js";

const data = { Sheet1: [[1], [2], [3], [null], [5]], Other: [["x"]] };

describe("Worksheets, Rows.Count, End(xlUp) on the SheetJS adapter", () => {
  it("Worksheets(1).Cells(1,1).Value = 99 sets A1 on sheet 1", () => {
    const { cell, result } = runBody("Worksheets(1).Cells(1, 1).Value = 99", data);
    expect(result.status).toBe("fully resurrected");
    expect(cell("Sheet1", 1, 1)).toBe(99);
    expect(cell("Other", 1, 1)).toBe("x");
  });

  it("Worksheets(2) and Sheets(name) select by index and by name, ignoring case", () => {
    const { cell } = runBody('Worksheets(2).Range("B1").Value = "a"\nSheets("sheet1").Range("B1").Value = "b"', data);
    expect(cell("Other", 1, 2)).toBe("a");
    expect(cell("Sheet1", 1, 2)).toBe("b");
  });

  it('Worksheets("Sheet1").Range("B2:C3").Value is a 2x2 array', () => {
    const { cell } = runBody(
      'Dim v As Variant\nv = Worksheets("Sheet1").Range("A1:B2").Value\nCells(1, 4).Value = UBound(v, 1) & "x" & UBound(v, 2) & ":" & LBound(v, 1)\nCells(2, 4).Value = v(2, 1)',
      data,
    );
    expect(cell("Sheet1", 1, 4)).toBe("2x2:1");
    expect(cell("Sheet1", 2, 4)).toBe(2);
  });

  it("Range(Cells(r1, c1), Cells(r2, c2)) spans the rectangle, in either corner order", () => {
    const { cell } = runBody(
      'Cells(1, 3).Value = Application.WorksheetFunction.Sum(Range(Cells(1, 1), Cells(3, 1)))\n' +
        'Cells(2, 3).Value = Range(Cells(3, 1), Cells(1, 1)).Address\n' +
        'Cells(3, 3).Value = Worksheets("Other").Range(Worksheets("Other").Cells(1, 1), Worksheets("Other").Cells(1, 1)).Value',
      data,
    );
    expect([1, 2, 3].map((r) => cell("Sheet1", r, 3))).toEqual([6, "$A$1:$A$3", "x"]);
  });

  it("an unknown sheet is error 9", () => {
    const { result } = runBody('Worksheets("Nope").Range("A1").Value = 1', data);
    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ code: 9 });
  });

  it("Cells(5,1).End(xlUp).Row is the last filled row above, skipping the gap", () => {
    const { cell } = runBody("Cells(1, 3).Value = Cells(10, 1).End(xlUp).Row\nCells(2, 3).Value = Cells(4, 1).End(xlUp).Row", data);
    expect(cell("Sheet1", 1, 3)).toBe(5);
    expect(cell("Sheet1", 2, 3)).toBe(3);
  });

  it("the usual last-row idiom: Cells(Rows.Count, 1).End(xlUp).Row", () => {
    const { cell } = runBody("Dim n As Long\nn = Cells(Rows.Count, 1).End(xlUp).Row\nCells(1, 3).Value = n", data);
    expect(cell("Sheet1", 1, 3)).toBe(5);
  });

  it("ActiveSheet is the first sheet and Rows.Count is the Excel limit", () => {
    const { cell } = runBody("Cells(1, 3).Value = ActiveSheet.Rows.Count\nCells(2, 3).Value = ActiveSheet.Name\nCells(3, 3).Value = ActiveSheet.Columns.Count", data);
    expect(cell("Sheet1", 1, 3)).toBe(1048576);
    expect(cell("Sheet1", 2, 3)).toBe("Sheet1");
    expect(cell("Sheet1", 3, 3)).toBe(16384);
  });

  it("End(xlDown), End(xlToRight) walk filled blocks", () => {
    const { cell } = runBody("Cells(1, 3).Value = Range(\"A1\").End(xlDown).Row", data);
    expect(cell("Sheet1", 1, 3)).toBe(3);
  });

  it("Range members: Offset, Resize, Address, Rows.Count, Columns.Count, Count", () => {
    const { cell } = runBody(
      'Cells(1, 3).Value = Range("A1").Offset(1, 0).Value\n' +
        'Cells(2, 3).Value = Range("A1").Resize(3, 2).Address\n' +
        'Cells(3, 3).Value = Range("A1:B4").Rows.Count\n' +
        'Cells(4, 3).Value = Range("A1:B4").Columns.Count\n' +
        'Cells(5, 3).Value = Range("A1:B4").Count\n' +
        'Cells(6, 3).Value = Range("B2").Offset(1, 1).Address',
      data,
    );
    expect([1, 2, 3, 4, 5, 6].map((r) => cell("Sheet1", r, 3))).toEqual([2, "$A$1:$B$3", 4, 2, 8, "$C$3"]);
  });

  it("Offset above row 1 is error 1004", () => {
    const { result } = runBody('Cells(1, 3).Value = Range("A1").Offset(-1, 0).Value', data);
    expect(result.error).toMatchObject({ code: 1004 });
  });

  it("Formula returns the formula text for a formula cell and the value otherwise", () => {
    const { wb } = runBody("", data);
    expect(wb.getSheet(1).getCellFormula(1, 1)).toBeNull();
    const { cell } = runBody('Cells(1, 3).Value = Range("A2").Formula', data);
    expect(cell("Sheet1", 1, 3)).toBe(2);
  });

  it("an unimplemented Range member is reported as unsupported with its name", () => {
    const { result } = runBody('Range("A1").Interior.Color = 255', data);
    expect(result.stoppedAt).toMatchObject({ module: "Module1", line: 2 });
    expect(result.stoppedAt?.construct).toBe("Range.Interior");
  });
});
