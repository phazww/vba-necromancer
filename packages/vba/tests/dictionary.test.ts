import { describe, it, expect } from "vitest";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { runMacro } from "../src/run.js";
import { MemoryWorkbook } from "../src/memory-workbook.js";
import type { VBAValue } from "../src/host.js";
import { RuntimeError, UnsupportedError } from "../src/errors.js";

/** Run `Sub T()` on a one-sheet workbook with A1 = 7; results are read from column A. */
function exec(source: string) {
  const wb = new MemoryWorkbook([{ name: "S", cells: [{ row: 1, col: 1, value: 7 }] }]);
  const result = runMacro("T", [parse(tokenize(source), "Module1")], wb);
  const col = (c: number, row: number): VBAValue => wb.cell("S", row, c);
  return { wb, result, a: (row: number) => col(1, row), b: (row: number) => col(2, row) };
}

const sub = (body: string, header = ""): string => `${header}\nSub T()\n${body}\nEnd Sub\n`;
const NEW_D = 'Dim d As Object\nSet d = CreateObject("Scripting.Dictionary")\n';

describe("DTASK-03: CreateObject and New", () => {
  it.each(["Scripting.Dictionary", "scripting.DICTIONARY"])("CreateObject(%s) gives a Dictionary", (progId) => {
    const { result, a } = exec(sub(`Dim d As Object\nSet d = CreateObject("${progId}")\nCells(1, 1).Value = TypeName(d)`));
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("fully resurrected");
    expect(a(1)).toBe("Dictionary");
  });

  it("Dim d As New Scripting.Dictionary works, local and module level", () => {
    const local = exec(sub('Dim d As New Scripting.Dictionary\nd.Add "a", 1\nCells(1, 1).Value = d.Count'));
    expect(local.result.error).toBeUndefined();
    expect(local.a(1)).toBe(1);
    const modLevel = exec(sub('d.Add "a", 1\nd.Add "b", 2\nCells(1, 1).Value = d.Count', "Dim d As New Scripting.Dictionary"));
    expect(modLevel.result.error).toBeUndefined();
    expect(modLevel.result.status).toBe("fully resurrected");
    expect(modLevel.a(1)).toBe(2);
  });

  it("Set d = New Scripting.Dictionary gives a usable object", () => {
    const { result, a } = exec(sub('Dim d As Object\nSet d = New Scripting.Dictionary\nd.Add 1, 2\nCells(1, 1).Value = d.Count'));
    expect(result.error).toBeUndefined();
    expect(a(1)).toBe(1);
  });

  it("Dim d As Scripting.Dictionary then Set d = CreateObject(...) works; a Range in it raises 13", () => {
    const ok = exec(sub('Dim d As Scripting.Dictionary\nSet d = CreateObject("Scripting.Dictionary")\nCells(1, 1).Value = d.Count'));
    expect(ok.result.error).toBeUndefined();
    expect(ok.a(1)).toBe(0);
    const bad = exec(sub('Dim d As Scripting.Dictionary\nSet d = Range("A1")'));
    expect(bad.result.status).toBe("failed");
    expect((bad.result.error as RuntimeError).code).toBe(13);
  });

  it("two CreateObject calls give independent Dictionaries", () => {
    const { a, b } = exec(
      sub(
        'Dim x As Object, y As Object\nSet x = CreateObject("Scripting.Dictionary")\nSet y = CreateObject("Scripting.Dictionary")\nx.Add 1, 1\nCells(1, 1).Value = x.Count\nCells(1, 2).Value = y.Count',
      ),
    );
    expect([a(1), b(1)]).toEqual([1, 0]);
  });

  it("another ProgID stops the run as partly resurrected and names the ProgID", () => {
    const { result, a } = exec(sub('Cells(1, 1).Value = 1\nSet f = CreateObject("Scripting.FileSystemObject")\nCells(2, 1).Value = 2'));
    expect(result.status).toBe("partly resurrected");
    expect(result.stoppedAt).toEqual({ module: "Module1", line: 4, construct: "CreateObject" });
    expect(result.error).toBeInstanceOf(UnsupportedError);
    expect(result.error?.message).toContain("CreateObject (\"Scripting.FileSystemObject\")");
    expect(a(2)).toBe(null);
  });

  it("another ProgID under On Error Resume Next gives one unsupported trace event", () => {
    const { result, a } = exec(sub('On Error Resume Next\nSet f = CreateObject("Scripting.FileSystemObject")\nCells(1, 1).Value = 1'));
    expect(result.status).toBe("partly resurrected");
    expect(result.stoppedAt).toBeUndefined();
    const events = result.trace.filter((e) => e.kind === "unsupported");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ construct: "CreateObject" });
    expect(a(1)).toBe(1);
  });

  it("CreateObject with a wrong argument count raises 450", () => {
    const { result } = exec(sub("Set d = CreateObject()"));
    expect((result.error as RuntimeError).code).toBe(450);
  });

  it("New Foo and Dim c As New Foo are still unsupported, naming New Foo", () => {
    const set = exec(sub("Set c = New Foo"));
    expect(set.result.stoppedAt).toEqual({ module: "Module1", line: 3, construct: "New Foo" });
    const dim = exec(sub("Dim c As New Foo\nc.Bar"));
    expect(dim.result.status).toBe("partly resurrected");
    expect(dim.result.stoppedAt).toMatchObject({ construct: "New Foo" });
  });
});

describe("DTASK-04: default member and indexed setters", () => {
  it('d("a") = 1, x = d("a"), d("a") = d("a") + 1', () => {
    const { result, a } = exec(sub(NEW_D + 'd("a") = 1\nx = d("a")\nd("a") = d("a") + 1\nCells(1, 1).Value = x\nCells(2, 1).Value = d("a")'));
    expect(result.error).toBeUndefined();
    expect([a(1), a(2)]).toEqual([1, 2]);
  });

  it("d.Item(k) get and set, and .Item(k) = v inside With", () => {
    const { result, a } = exec(
      sub(NEW_D + 'd.Item("a") = 2\nCells(1, 1).Value = d.Item("a")\nWith d\n.Item("a") = 3\nCells(2, 1).Value = .Item("a")\nEnd With'),
    );
    expect(result.error).toBeUndefined();
    expect([a(1), a(2)]).toEqual([2, 3]);
  });

  it('d.Key("a") = "b" as a statement', () => {
    const { result, a } = exec(sub(NEW_D + 'd.Add "a", 5\nd.Key("a") = "b"\nCells(1, 1).Value = d("b")\nCells(2, 1).Value = d.Exists("a")'));
    expect(result.error).toBeUndefined();
    expect([a(1), a(2)]).toEqual([5, false]);
  });

  it("storing a Range stores the cell value, not the Range", () => {
    const { result, a } = exec(sub(NEW_D + 'd("k") = Range("A1")\nCells(2, 1).Value = TypeName(d("k"))\nCells(3, 1).Value = d("k")'));
    expect(result.error).toBeUndefined();
    expect([a(2), a(3)]).toEqual(["Double", 7]);
  });

  it("Cells(1, 1) = 5 and ws.Cells(1, 1) = 5 still write to the cell", () => {
    const { result, a } = exec(sub('Dim ws As Worksheet\nSet ws = Worksheets("S")\nCells(1, 1) = 5\nws.Cells(2, 1) = 6'));
    expect(result.error).toBeUndefined();
    expect([a(1), a(2)]).toEqual([5, 6]);
  });

  it("reading a missing key adds it as Empty without trace events or errors", () => {
    const { result, a } = exec(
      sub(NEW_D + 'v = d("missing")\nCells(1, 1).Value = IsEmpty(v)\nCells(2, 1).Value = d.Exists("missing")\nCells(3, 1).Value = d.Count\nCells(4, 1).Value = Err.Number'),
    );
    expect(result.error).toBeUndefined();
    expect([a(1), a(2), a(3), a(4)]).toEqual([true, true, 1, 0]);
    expect(result.trace.filter((e) => e.kind === "unsupported")).toEqual([]);
    expect(result.trace.filter((e) => e.kind !== "write")).toEqual([]);
    expect(result.unsupported).toEqual([]);
  });

  it("calling d(key) on a variable that is Nothing raises 91", () => {
    const read = exec(sub("Dim d As Scripting.Dictionary\nx = d(\"a\")"));
    expect((read.result.error as RuntimeError).code).toBe(91);
    const write = exec(sub("Dim d As Scripting.Dictionary\nd(\"a\") = 1"));
    expect((write.result.error as RuntimeError).code).toBe(91);
  });

  it("an unknown member raises 438", () => {
    const { result } = exec(sub(NEW_D + "d.Foo"));
    expect((result.error as RuntimeError).code).toBe(438);
  });

  it("using the Dictionary itself as a value raises 438", () => {
    const { result } = exec(sub(NEW_D + "x = d + 1"));
    expect((result.error as RuntimeError).code).toBe(438);
  });
});

describe("DTASK-05: For Each", () => {
  it("For Each k In d visits keys in insertion order with their original types", () => {
    const { result, a } = exec(
      sub(NEW_D + 'd.Add "b", 1\nd.Add 5, 2\nd.Add "a", 3\nr = 1\nFor Each k In d\nCells(r, 1).Value = TypeName(k) & ":" & k\nr = r + 1\nNext'),
    );
    expect(result.error).toBeUndefined();
    expect([a(1), a(2), a(3)]).toEqual(["String:b", "Integer:5", "String:a"]);
  });

  it("For Each over d.Keys and d.Items", () => {
    const { result, a, b } = exec(
      sub(NEW_D + 'd.Add "b", 10\nd.Add "a", 20\nr = 1\nFor Each k In d.Keys\nCells(r, 1).Value = k\nr = r + 1\nNext\nr = 1\nFor Each v In d.Items\nCells(r, 2).Value = v\nr = r + 1\nNext'),
    );
    expect(result.error).toBeUndefined();
    expect([a(1), a(2), b(1), b(2)]).toEqual(["b", "a", 10, 20]);
  });

  it("an empty Dictionary gives zero iterations", () => {
    const { result, a } = exec(sub(NEW_D + "n = 0\nFor Each k In d\nn = n + 1\nNext\nCells(1, 1).Value = n"));
    expect(result.error).toBeUndefined();
    expect(a(1)).toBe(0);
  });

  // unverified against Excel
  it("adding a key inside the loop does not extend the iteration", () => {
    const { result, a, b } = exec(
      sub(NEW_D + 'd.Add "a", 1\nn = 0\nFor Each k In d\nn = n + 1\nd.Add k & "x", 0\nNext\nCells(1, 1).Value = n\nCells(1, 2).Value = d.Count'),
    );
    expect(result.error).toBeUndefined();
    expect([a(1), b(1)]).toEqual([1, 2]);
  });

  it("Exit For works inside the loop", () => {
    const { a } = exec(sub(NEW_D + 'd.Add 1, 1\nd.Add 2, 1\nd.Add 3, 1\nFor Each k In d\nIf k = 2 Then Exit For\nNext\nCells(1, 1).Value = k'));
    expect(a(1)).toBe(2);
  });

  it("For Each over a Range is still reported as unsupported", () => {
    const { result } = exec(sub('For Each x In Range("A1")\nNext'));
    expect(result.stoppedAt).toMatchObject({ construct: "For Each over a non-array" });
  });
});

describe("DTASK-08: error paths through the interpreter", () => {
  const code = (r: ReturnType<typeof exec>) => (r.result.error as RuntimeError).code;

  it("duplicate Add without On Error fails with a RuntimeError 457", () => {
    const r = exec(sub(NEW_D + 'd.Add "a", 1\nd.Add "a", 2'));
    expect(r.result.status).toBe("failed");
    expect(r.result.error).toBeInstanceOf(RuntimeError);
    expect(code(r)).toBe(457);
  });

  it("On Error Resume Next: 457 with its description, and the run continues", () => {
    const { a, b, result } = exec(
      sub(NEW_D + 'On Error Resume Next\nd.Add "a", 1\nd.Add "a", 2\nCells(1, 1).Value = Err.Number\nCells(1, 2).Value = Err.Description\nCells(2, 1).Value = d.Count'),
    );
    expect(result.error).toBeUndefined();
    expect(a(1)).toBe(457);
    expect(b(1)).toBe("This key is already associated with an element of this collection");
    expect(a(2)).toBe(1);
  });

  it("Remove of a missing key gives Err.Number 32811", () => {
    const { a } = exec(sub(NEW_D + 'On Error Resume Next\nd.Remove "nope"\nCells(1, 1).Value = Err.Number'));
    expect(a(1)).toBe(32811);
  });

  it("CompareMode = vbTextCompare on a non-empty Dictionary gives Err.Number 5", () => {
    const { a } = exec(sub(NEW_D + 'On Error Resume Next\nd.Add "a", 1\nd.CompareMode = vbTextCompare\nCells(1, 1).Value = Err.Number'));
    expect(a(1)).toBe(5);
  });

  it("CompareMode = vbTextCompare on an empty Dictionary makes keys case-insensitive", () => {
    const { result, a } = exec(sub(NEW_D + 'd.CompareMode = vbTextCompare\nd.Add "a", 1\nCells(1, 1).Value = d.Exists("A")\nCells(2, 1).Value = d.CompareMode'));
    expect(result.error).toBeUndefined();
    expect([a(1), a(2)]).toEqual([true, 1]);
  });

  it("On Error GoTo handler is reached for 457, 32811 and 5", () => {
    const body = (stmt: string) =>
      NEW_D + `On Error GoTo handler\nd.Add "a", 1\n${stmt}\nCells(1, 1).Value = -1\nExit Sub\nhandler:\nCells(1, 1).Value = Err.Number`;
    expect(exec(sub(body('d.Add "a", 2'))).a(1)).toBe(457);
    expect(exec(sub(body('d.Remove "zz"'))).a(1)).toBe(32811);
    expect(exec(sub(body("d.CompareMode = 1"))).a(1)).toBe(5);
  });

  it("Option Compare Text in the module does not change Dictionary key matching", () => {
    const { result, a } = exec(sub(NEW_D + 'd.Add "a", 1\nCells(1, 1).Value = d.Exists("A")', "Option Compare Text"));
    expect(result.error).toBeUndefined();
    expect(a(1)).toBe(false);
  });

  it("vbDatabaseCompare is reported as unsupported with module and line", () => {
    const { result } = exec(sub(NEW_D + "d.CompareMode = 2"));
    expect(result.status).toBe("partly resurrected");
    expect(result.stoppedAt).toMatchObject({ line: 5, construct: "CompareMode vbDatabaseCompare" });
  });

  // unverified against Excel
  it("pinned choices: Boolean key distinct from number, Empty key accepted, array key raises 5", () => {
    const { a, result } = exec(
      sub(NEW_D + 'd.Add True, 1\nk = -1\nd.Add k, 2\nCells(1, 1).Value = d.Count\nd.Add Empty, 3\nCells(2, 1).Value = d.Exists(Empty)\nDim arr(1 To 2) As Long\nOn Error Resume Next\nd.Add arr, 4\nCells(3, 1).Value = Err.Number'),
    );
    expect(result.error).toBeUndefined();
    expect([a(1), a(2), a(3)]).toEqual([2, true, 5]);
  });
});

describe("DTASK-09: known deviations", () => {
  // Known deviation: VBA re-creates an `As New` object on the next use after `Set d = Nothing`.
  // This interpreter creates it at declaration, so the variable stays Nothing.
  it("after Set d = Nothing, an As New Dictionary raises 91 (VBA would re-create it)", () => {
    const { result } = exec(sub('Dim d As New Scripting.Dictionary\nd.Add "a", 1\nSet d = Nothing\nd.Add "b", 2'));
    expect(result.status).toBe("failed");
    expect((result.error as RuntimeError).code).toBe(91);
  });
});
