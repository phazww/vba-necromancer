import { describe, it, expect } from "vitest";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { runMacro } from "../src/run.js";
import { MemoryWorkbook } from "../src/memory-workbook.js";

function exec(body: string, cells: Array<{ row: number; col: number; value: number | string }> = [], trace = true) {
  const wb = new MemoryWorkbook([{ name: "S", cells }]);
  const src = `Sub T()\n${body}\nEnd Sub\n`;
  const result = runMacro("T", [parse(tokenize(src), "Module1")], wb, { trace });
  return { wb, result };
}

describe("execution trace", () => {
  it("three writes give exactly three write events with before, after and line", () => {
    const { result } = exec('Cells(1, 1).Value = 1\nCells(2, 1).Value = "x"\nRange("B1").Value = 2.5');
    expect(result.trace).toEqual([
      { kind: "write", sheet: "S", row: 1, col: 1, before: null, after: 1, statement: { module: "Module1", line: 2 } },
      { kind: "write", sheet: "S", row: 2, col: 1, before: null, after: "x", statement: { module: "Module1", line: 3 } },
      { kind: "write", sheet: "S", row: 1, col: 2, before: null, after: 2.5, statement: { module: "Module1", line: 4 } },
    ]);
  });

  it("a write records the previous value as before", () => {
    const { result } = exec("Cells(1, 1).Value = 9", [{ row: 1, col: 1, value: "old" }]);
    expect(result.trace).toMatchObject([{ kind: "write", before: "old", after: 9 }]);
  });

  it("a read of A1 comes before the write that follows it", () => {
    const { result } = exec("Dim x As Variant\nx = Cells(1, 1).Value\nCells(1, 1).Value = x + 1", [
      { row: 1, col: 1, value: 4 },
    ]);
    expect(result.trace.map((e) => e.kind)).toEqual(["read", "write"]);
    expect(result.trace[0]).toMatchObject({ kind: "read", value: 4, statement: { line: 3 } });
    expect(result.trace[1]).toMatchObject({ kind: "write", before: 4, after: 5, statement: { line: 4 } });
  });

  it("a multi-cell read records one event per cell", () => {
    const { result } = exec("Dim v As Variant\nv = Range(\"A1:A3\").Value", [{ row: 2, col: 1, value: 7 }]);
    expect(result.trace.map((e) => (e.kind === "read" ? e.value : "?"))).toEqual([null, 7, null]);
  });

  it("reads inside a called function carry the line of the statement that ran them", () => {
    const wb = new MemoryWorkbook([{ name: "S", cells: [{ row: 1, col: 1, value: 3 }] }]);
    const src = "Function F() As Long\nF = Cells(1, 1).Value\nEnd Function\nSub T()\nCells(2, 1).Value = F()\nEnd Sub\n";
    const result = runMacro("T", [parse(tokenize(src), "M")], wb);
    expect(result.trace).toMatchObject([
      { kind: "read", statement: { line: 2 } },
      { kind: "write", statement: { line: 5 } },
    ]);
  });

  it("a macro that touches no cells has an empty trace", () => {
    const { result } = exec("Dim x As Long\nx = 1 + 1");
    expect(result.trace).toEqual([]);
  });

  it("an unsupported statement under On Error Resume Next adds an unsupported event", () => {
    const { result } = exec('On Error Resume Next\nOpen "x.txt" For Output As #1\nCells(1, 1).Value = 1');
    expect(result.trace.map((e) => e.kind)).toEqual(["unsupported", "write"]);
    expect(result.trace[0]).toEqual({
      kind: "unsupported",
      module: "Module1",
      line: 3,
      construct: "Open",
      statement: { module: "Module1", line: 3 },
    });
  });

  it("trace: false drops cell events but keeps unsupported ones", () => {
    const { result } = exec('On Error Resume Next\nOpen "x" For Output As #1\nCells(1, 1).Value = 1', [], false);
    expect(result.trace.map((e) => e.kind)).toEqual(["unsupported"]);
  });

  it("each run returns its own trace", () => {
    const wb = new MemoryWorkbook([{ name: "S" }]);
    const mod = parse(tokenize("Sub T()\nCells(1, 1).Value = 1\nEnd Sub\n"), "M");
    const first = runMacro("T", [mod], wb);
    const second = runMacro("T", [mod], wb);
    expect(first.trace).toHaveLength(1);
    expect(second.trace).toHaveLength(1);
    expect(second.trace[0]).toMatchObject({ before: 1, after: 1 });
  });
});
