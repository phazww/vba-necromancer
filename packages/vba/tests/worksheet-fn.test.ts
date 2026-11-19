import { describe, it, expect } from "vitest";
import { runBody } from "./sheetjs-helper.js";

const data = {
  Sheet1: [
    [1, "a", 10],
    [2.5, true, null],
    [null, "3", 30],
    [-4, "", 20],
  ],
};
const call = (expr: string) => {
  const r = runBody(`Cells(1, 6).Value = ${expr}`, data);
  return { value: r.cell("Sheet1", 1, 6), result: r.result };
};

describe("Application.WorksheetFunction", () => {
  it("Sum adds only the numbers of a range", () => {
    expect(call('Application.WorksheetFunction.Sum(Range("A1:A4"))').value).toBe(-0.5);
    expect(call('Application.WorksheetFunction.Sum(Range("A1:C4"))').value).toBe(1 + 2.5 - 4 + 10 + 30 + 20);
  });

  it("Count counts numbers, CountA counts non-empty cells including empty strings", () => {
    expect(call('Application.WorksheetFunction.Count(Range("A1:C4"))').value).toBe(6);
    expect(call('Application.WorksheetFunction.CountA(Range("A1:C4"))').value).toBe(10);
  });

  it("Max and Min over a range, and 0 when there are no numbers", () => {
    expect(call('Application.WorksheetFunction.Max(Range("A1:C4"))').value).toBe(30);
    expect(call('Application.WorksheetFunction.Min(Range("A1:C4"))').value).toBe(-4);
    expect(call('Application.WorksheetFunction.Max(Range("B1"))').value).toBe(0);
  });

  it("Average divides by the number of numeric cells", () => {
    expect(call('Application.WorksheetFunction.Average(Range("C1:C4"))').value).toBe(20);
  });

  it("Average of no numbers is error 1004", () => {
    const { result } = call('Application.WorksheetFunction.Average(Range("B1:B2"))');
    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ code: 1004 });
  });

  it("several arguments and scalars: ranges, numbers, numeric strings, True", () => {
    expect(call('Application.WorksheetFunction.Sum(Range("A1"), 2, "3", True)').value).toBe(7);
    expect(call('Application.WorksheetFunction.Count(Range("A1"), 2, "x")').value).toBe(2);
  });

  it("a non-numeric string argument to Sum is error 1004", () => {
    const { result } = call('Application.WorksheetFunction.Sum("abc")');
    expect(result.error).toMatchObject({ code: 1004 });
  });

  it("WorksheetFunction can be used without Application, and with a Worksheet range", () => {
    expect(call('WorksheetFunction.Sum(Worksheets(1).Range("C1:C4"))').value).toBe(60);
  });

  it("the reads are traced, one event per cell", () => {
    const r = runBody('Cells(1, 6).Value = Application.WorksheetFunction.Sum(Range("A1:A3"))', data);
    expect(r.result.trace.filter((e) => e.kind === "read")).toHaveLength(3);
    expect(r.result.status).toBe("fully resurrected");
  });

  it("functions that are not implemented are reported with their name", () => {
    const { result } = call('Application.WorksheetFunction.VLookup(1, Range("A1:B2"), 2, False)');
    expect(result.stoppedAt?.construct).toBe("WorksheetFunction.VLookup");
  });

  it("other Application members are reported as unsupported", () => {
    const r = runBody("Application.ScreenUpdating = False", data);
    expect(r.result.stoppedAt?.construct).toBe("Application.ScreenUpdating");
  });
});
