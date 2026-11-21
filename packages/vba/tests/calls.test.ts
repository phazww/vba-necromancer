import { describe, it, expect } from "vitest";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { runMacro } from "../src/run.js";
import { MemoryWorkbook } from "../src/memory-workbook.js";
import type { AssignStatement, BinaryExpr, CallStatement, SubDecl, UnaryExpr } from "../src/ast.js";

function firstStatement(line: string) {
  const ast = parse(tokenize(`Sub T()\n${line}\nEnd Sub`), "M");
  return (ast.procedures[0] as SubDecl).body[0];
}

describe("PTASK-03: unary sign after a call name (CALL-01)", () => {
  it.each([
    ["Foo -1, 2", 2],
    ["obj.Method -1, 2", 2],
    ['d.Add -1, "minus one"', 2],
    ["Foo +1", 1],
    ["Foo -x", 1],
  ])("%s is a call with %d argument(s), the first one signed", (line, count) => {
    const stmt = firstStatement(line) as CallStatement;
    expect(stmt.kind).toBe("CallStatement");
    expect(stmt.args).toHaveLength(count);
    const first = stmt.args[0];
    if (line.startsWith("Foo +")) {
      expect(first.kind).toBe("Literal");
    } else {
      expect(first.kind).toBe("UnaryExpr");
      expect((first as UnaryExpr).op).toBe("-");
    }
  });

  it("x = y -1 stays a subtraction", () => {
    const stmt = firstStatement("x = y -1") as AssignStatement;
    expect(stmt.kind).toBe("AssignStatement");
    expect(stmt.value.kind).toBe("BinaryExpr");
    expect((stmt.value as BinaryExpr).op).toBe("-");
  });

  it("x = Foo -1 stays a subtraction", () => {
    const stmt = firstStatement("x = Foo -1") as AssignStatement;
    expect((stmt.value as BinaryExpr).op).toBe("-");
  });

  it.each(["Foo - 1", "Foo-1"])("%s keeps its binary meaning (no arguments)", (line) => {
    const stmt = firstStatement(line) as CallStatement;
    expect(stmt.kind).toBe("CallStatement");
    expect(stmt.args).toHaveLength(0);
    expect(stmt.callee.kind).toBe("BinaryExpr");
  });

  it("a parenthesised call followed by a sign stays binary", () => {
    const stmt = firstStatement("Foo(1) -1") as CallStatement;
    expect(stmt.args).toHaveLength(0);
    expect(stmt.callee.kind).toBe("BinaryExpr");
  });
});

describe("PTASK-03: calling with a signed argument (CALL-02)", () => {
  function run(source: string) {
    const wb = new MemoryWorkbook([{ name: "S", cells: [] }]);
    const result = runMacro("T", [parse(tokenize(source), "M")], wb);
    return { result, a: (row: number) => wb.cell("S", row, 1) };
  }

  it("Foo -1 calls a one-parameter Sub with -1", () => {
    const { result, a } = run("Sub S(n)\nCells(1, 1).Value = n\nEnd Sub\nSub T()\nS -1\nEnd Sub\n");
    expect(result.error).toBeUndefined();
    expect(a(1)).toBe(-1);
  });

  it("d.Add -1, \"m\" adds key -1", () => {
    const { result, a } = run(
      'Sub T()\nDim d As Object\nSet d = CreateObject("Scripting.Dictionary")\nd.Add -1, "m"\n' +
        'Cells(1, 1).Value = d.Exists(-1)\nCells(2, 1).Value = d.Item(-1)\nCells(3, 1).Value = d.Count\nEnd Sub\n',
    );
    expect(result.error).toBeUndefined();
    expect(a(1)).toBe(true);
    expect(a(2)).toBe("m");
    expect(a(3)).toBe(1);
  });
});
