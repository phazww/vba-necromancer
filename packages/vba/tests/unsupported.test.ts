import { describe, it, expect } from "vitest";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { runMacro } from "../src/run.js";
import { scanUnsupported } from "../src/constructs.js";
import { MemoryWorkbook } from "../src/memory-workbook.js";
import { UnsupportedError } from "../src/errors.js";

const mod = (src: string) => parse(tokenize(src), "Module1");
const run = (src: string) => runMacro("T", [mod(src)], new MemoryWorkbook([{ name: "S" }]));
const sub = (body: string, header = "") => `${header}\nSub T()\n${body}\nEnd Sub\n`;

describe("static scan", () => {
  it("names constructs the way REQ-12.2 does", () => {
    const src = sub(
      'Dim f As Object\nSet f = CreateObject("X.Y")\nOpen "a" For Output As #1\nPrint #1, "x"\nInput #1, v\nClose #1\nKill "a"\nx = Dir("*")\nDoEvents\nShell "calc"\nSendKeys "x"\nSet c = New Foo',
      'Private Declare PtrSafe Function GetTickCount Lib "kernel32" () As Long',
    );
    expect(scanUnsupported([mod(src)]).map((h) => [h.line, h.construct])).toEqual([
      [1, "Declare"],
      [4, "CreateObject"],
      [5, "Open"],
      [6, "Print #"],
      [7, "Input #"],
      [8, "Close"],
      [9, "Kill"],
      [10, "Dir"],
      [11, "DoEvents"],
      [12, "Shell"],
      [13, "SendKeys"],
      [14, "New Foo"],
    ]);
  });

  it("names Line Input # and Write # like REQ-12.2 names the other file statements", () => {
    const src = sub("Line Input #1, s\nWrite #1, s");
    expect(scanUnsupported([mod(src)]).map((h) => [h.line, h.construct])).toEqual([
      [3, "Line Input #"],
      [4, "Write #"],
    ]);
  });

  it("finds CreateObject inside an expression and on a line that never runs", () => {
    const src = sub('If False Then\nSet f = CreateObject("Scripting.Dictionary")\nEnd If');
    expect(scanUnsupported([mod(src)])).toEqual([{ module: "Module1", line: 4, construct: "CreateObject" }]);
  });

  it("does not flag a variable or procedure that happens to be named Dir", () => {
    const src = sub("Dim dir As String\ndir = \"x\"\nCells(1, 1).Value = dir");
    expect(scanUnsupported([mod(src)])).toEqual([]);
  });

  it("is empty for a module with no unsupported constructs", () => {
    expect(scanUnsupported([mod(sub("Cells(1, 1).Value = 1"))])).toEqual([]);
  });
});

describe("running unsupported constructs", () => {
  it("CreateObject stops the run with construct CreateObject and its line", () => {
    const r = run(sub('Cells(1, 1).Value = 1\nSet f = CreateObject("Scripting.FileSystemObject")\nCells(2, 1).Value = 2'));
    expect(r.error).toBeInstanceOf(UnsupportedError);
    expect(r.stoppedAt).toEqual({ module: "Module1", line: 4, construct: "CreateObject" });
    expect(r.status).toBe("partly resurrected");
    expect(r.trace.filter((e) => e.kind === "write")).toHaveLength(1);
  });

  it("Declare is listed statically, and calling the declared function stops at the Declare", () => {
    const r = run(sub("Dim t As Long\nt = GetTickCount()", 'Private Declare PtrSafe Function GetTickCount Lib "kernel32" () As Long'));
    expect(r.staticUnsupported).toEqual([{ module: "Module1", line: 1, construct: "Declare" }]);
    expect(r.stoppedAt).toEqual({ module: "Module1", line: 1, construct: "Declare" });
    expect(r.status).toBe("partly resurrected");
  });

  it("a macro that never calls the Declare still runs, with the Declare in the static list", () => {
    const r = run(sub("Cells(1, 1).Value = 1", 'Private Declare PtrSafe Function GetTickCount Lib "kernel32" () As Long'));
    expect(r.status).toBe("fully resurrected");
    expect(r.staticUnsupported).toHaveLength(1);
    expect(r.stoppedAt).toBeUndefined();
  });

  it("a module with no unsupported constructs is fully resurrected", () => {
    const r = run(sub("Cells(1, 1).Value = 1"));
    expect(r.status).toBe("fully resurrected");
    expect(r.staticUnsupported).toEqual([]);
  });

  it("an unsupported call under On Error Resume Next is partly resurrected without stoppedAt", () => {
    const r = run(sub("On Error Resume Next\nDoEvents\nCells(1, 1).Value = 1"));
    expect(r.status).toBe("partly resurrected");
    expect(r.stoppedAt).toBeUndefined();
    expect(r.unsupported).toEqual([{ module: "Module1", line: 4, construct: "DoEvents" }]);
  });

  it("an ordinary runtime error is still failed", () => {
    const r = run(sub("Dim x As Long\nx = 1 / 0"));
    expect(r.status).toBe("failed");
    expect(r.stoppedAt).toBeUndefined();
  });
});
