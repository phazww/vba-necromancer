import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import type { SubDecl, FunctionDecl, ForStatement, SelectStatement } from "../src/ast.js";

function parseSource(source: string) {
  return parse(tokenize(source), "M");
}

describe("parse", () => {
  it("parses empty Sub", () => {
    const ast = parseSource("Sub Foo()\nEnd Sub");
    expect(ast.procedures).toHaveLength(1);
    const sub = ast.procedures[0] as SubDecl;
    expect(sub.kind).toBe("SubDecl");
    expect(sub.name).toBe("Foo");
    expect(sub.body).toHaveLength(0);
    expect(sub.params).toHaveLength(0);
  });

  it("parses Function with two params and assignment to function name", () => {
    const src = "Function Add(a As Long, b As Long) As Long\n  Add = a + b\nEnd Function";
    const ast = parseSource(src);
    expect(ast.procedures).toHaveLength(1);
    const fn = ast.procedures[0] as FunctionDecl;
    expect(fn.kind).toBe("FunctionDecl");
    expect(fn.name).toBe("Add");
    expect(fn.params).toHaveLength(2);
    expect(fn.params[0].name).toBe("a");
    expect(fn.params[1].name).toBe("b");
    expect(fn.body).toHaveLength(1);
    expect(fn.body[0].kind).toBe("AssignStatement");
  });

  it("parses If/End If", () => {
    const ast = parseSource("Sub S()\nIf x > 0 Then\n  y = 1\nEnd If\nEnd Sub");
    const sub = ast.procedures[0] as SubDecl;
    expect(sub.body[0].kind).toBe("IfStatement");
  });

  it("parses For/Next i", () => {
    const ast = parseSource("Sub S()\nFor i = 1 To 10\nNext i\nEnd Sub");
    const sub = ast.procedures[0] as SubDecl;
    expect(sub.body[0].kind).toBe("ForStatement");
    const forStmt = sub.body[0] as ForStatement;
    expect(forStmt.variable).toBe("i");
  });

  it("parses Select Case with two arms", () => {
    const src = "Sub S()\nSelect Case x\n  Case 1\n    y = 1\n  Case Else\n    y = 0\nEnd Select\nEnd Sub";
    const ast = parseSource(src);
    const sub = ast.procedures[0] as SubDecl;
    expect(sub.body[0].kind).toBe("SelectStatement");
    const sel = sub.body[0] as SelectStatement;
    expect(sel.cases).toHaveLength(2);
    expect(sel.cases[0].tests).not.toBeNull();
    expect(sel.cases[1].tests).toBeNull(); // Case Else
  });

  it("parses Declare as UnsupportedStatement without throwing", () => {
    const src = "Private Declare PtrSafe Function GetTickCount Lib \"kernel32\" () As Long";
    const ast = parseSource(src);
    // Should appear as a declaration with kind UnsupportedStatement (from module level)
    // or as a procedure with module-level unsupported decl
    const allDecls = [...ast.declarations, ...ast.procedures];
    const unsupported = allDecls.find((d) => d.kind === "UnsupportedStatement");
    expect(unsupported).toBeDefined();
    expect((unsupported as { construct: string }).construct.toLowerCase()).toContain("declare");
  });

  it("parses Option Explicit", () => {
    const ast = parseSource("Option Explicit\n");
    expect(ast.options.explicit).toBe(true);
  });

  it("parses Option Base 1", () => {
    const ast = parseSource("Option Base 1\n");
    expect(ast.options.base).toBe(1);
  });

  it("parses Option Compare Text", () => {
    const ast = parseSource("Option Compare Text\n");
    expect(ast.options.compareMode).toBe("text");
  });

  it("parses Dim with array bounds (1 To 10) As String", () => {
    const ast = parseSource("Sub S()\nDim cats(1 To 10) As String\nEnd Sub");
    const sub = ast.procedures[0] as SubDecl;
    expect(sub.body[0].kind).toBe("DimStatement");
    const dim = sub.body[0] as import("../src/ast.js").DimStatement;
    expect(dim.declarators[0].dimensions).toHaveLength(1);
    expect(dim.declarators[0].dimensions![0][0]).not.toBeNull(); // lower bound
  });

  it("parses Dim with multiple declarators on one line", () => {
    const ast = parseSource("Sub S()\nDim i As Long, k As Long, n As Long\nEnd Sub");
    const sub = ast.procedures[0] as SubDecl;
    const dim = sub.body[0] as import("../src/ast.js").DimStatement;
    expect(dim.kind).toBe("DimStatement");
    expect(dim.declarators).toHaveLength(3);
  });

  it("parses Set statement", () => {
    const ast = parseSource('Sub S()\nSet ws = Worksheets("Sheet1")\nEnd Sub');
    const sub = ast.procedures[0] as SubDecl;
    expect(sub.body[0].kind).toBe("SetStatement");
  });

  it("parses For/Next k (named variable)", () => {
    const ast = parseSource("Sub S()\nFor k = 1 To 5\nNext k\nEnd Sub");
    const sub = ast.procedures[0] as SubDecl;
    const forStmt = sub.body[0] as ForStatement;
    expect(forStmt.variable).toBe("k");
  });

  it("parses Exit For", () => {
    const ast = parseSource("Sub S()\nFor i = 1 To 10\nExit For\nNext i\nEnd Sub");
    const sub = ast.procedures[0] as SubDecl;
    const forStmt = sub.body[0] as ForStatement;
    const exit = forStmt.body[0];
    expect(exit.kind).toBe("ExitStatement");
    expect((exit as import("../src/ast.js").ExitStatement).what).toBe("For");
  });

  it("parses If/ElseIf/Else/End If", () => {
    const src = "Sub S()\nIf x = 1 Then\n  a = 1\nElseIf x = 2 Then\n  a = 2\nElse\n  a = 3\nEnd If\nEnd Sub";
    const ast = parseSource(src);
    const sub = ast.procedures[0] as SubDecl;
    const ifStmt = sub.body[0] as import("../src/ast.js").IfStatement;
    expect(ifStmt.kind).toBe("IfStatement");
    expect(ifStmt.elseIfs).toHaveLength(1);
    expect(ifStmt.elseBody).not.toBeNull();
  });

  it("parses Select Case with single-line 'Case 2: statement'", () => {
    const src = "Sub S()\nSelect Case x\n  Case 2: y = 99\n  Case Else: y = 0\nEnd Select\nEnd Sub";
    const ast = parseSource(src);
    const sub = ast.procedures[0] as SubDecl;
    const sel = sub.body[0] as SelectStatement;
    expect(sel.kind).toBe("SelectStatement");
    expect(sel.cases[0].body).toHaveLength(1);
    expect(sel.cases[1].tests).toBeNull(); // Case Else
    expect(sel.cases[1].body).toHaveLength(1);
  });

  it("parses Do While … Loop", () => {
    const ast = parseSource("Sub S()\nDo While x < 10\n  x = x + 1\nLoop\nEnd Sub");
    const sub = ast.procedures[0] as SubDecl;
    expect(sub.body[0].kind).toBe("DoStatement");
  });

  it("parses On Error Resume Next", () => {
    const ast = parseSource("Sub S()\nOn Error Resume Next\nEnd Sub");
    const sub = ast.procedures[0] as SubDecl;
    const onErr = sub.body[0] as import("../src/ast.js").OnErrorStatement;
    expect(onErr.kind).toBe("OnErrorStatement");
    expect(onErr.mode).toBe("ResumeNext");
  });

  it("parses On Error GoTo 0", () => {
    const ast = parseSource("Sub S()\nOn Error GoTo 0\nEnd Sub");
    const sub = ast.procedures[0] as SubDecl;
    const onErr = sub.body[0] as import("../src/ast.js").OnErrorStatement;
    expect(onErr.mode).toBe("GoTo0");
  });

  it("parses Err.Number access as a MemberExpr", () => {
    const ast = parseSource("Sub S()\nx = Err.Number\nEnd Sub");
    const sub = ast.procedures[0] as SubDecl;
    const assign = sub.body[0] as import("../src/ast.js").AssignStatement;
    expect(assign.value.kind).toBe("MemberExpr");
    expect((assign.value as import("../src/ast.js").MemberExpr).member).toBe("Number");
  });

  it("parses Err.Clear call", () => {
    const ast = parseSource("Sub S()\nErr.Clear\nEnd Sub");
    const sub = ast.procedures[0] as SubDecl;
    expect(sub.body[0].kind).toBe("CallStatement");
  });

  it("parses Function with ByVal param and return by assigning to function name", () => {
    const src = "Function RateFor(ByVal grade As Integer) As Double\n  RateFor = 100\nEnd Function";
    const ast = parseSource(src);
    const fn = ast.procedures[0] as FunctionDecl;
    expect(fn.params[0].passing).toBe("ByVal");
    expect(fn.body[0].kind).toBe("AssignStatement");
  });

  it("parses method chain: src.Cells(src.Rows.Count, 1).End(xlUp).Row", () => {
    const src = "Sub S()\nx = src.Cells(src.Rows.Count, 1).End(xlUp).Row\nEnd Sub";
    const ast = parseSource(src);
    const sub = ast.procedures[0] as SubDecl;
    const assign = sub.body[0] as import("../src/ast.js").AssignStatement;
    // Should parse as a MemberExpr chain without throwing
    expect(assign.kind).toBe("AssignStatement");
  });

  it("parses Application.WorksheetFunction.Sum(range) chain", () => {
    const src = 'Sub S()\nx = Application.WorksheetFunction.Sum(dst.Range(dst.Cells(2, 4), dst.Cells(n + 1, 4)))\nEnd Sub';
    const ast = parseSource(src);
    const sub = ast.procedures[0] as SubDecl;
    const assign = sub.body[0] as import("../src/ast.js").AssignStatement;
    expect(assign.kind).toBe("AssignStatement");
  });

  it("parses Like operator", () => {
    const src = 'Sub S()\nx = ("ТР-01" Like "ТР-##")\nEnd Sub';
    const ast = parseSource(src);
    const sub = ast.procedures[0] as SubDecl;
    const assign = sub.body[0] as import("../src/ast.js").AssignStatement;
    expect(assign.kind).toBe("AssignStatement");
  });

  it("parses & concatenation", () => {
    const src = 'Sub S()\nx = "foo" & 42 & " bar"\nEnd Sub';
    const ast = parseSource(src);
    const sub = ast.procedures[0] as SubDecl;
    const assign = sub.body[0] as import("../src/ast.js").AssignStatement;
    expect(assign.kind).toBe("AssignStatement");
  });

  it("parses line continuation across lines", () => {
    const src = "Sub S()\nx = 1 + _\n  2\nEnd Sub";
    const ast = parseSource(src);
    const sub = ast.procedures[0] as SubDecl;
    expect(sub.body[0].kind).toBe("AssignStatement");
  });

  it("parses Open/Print/Close as UnsupportedStatement nodes", () => {
    const src =
      'Sub S()\nOpen "C:\\temp\\x.txt" For Output As #1\nPrint #1, "test"\nClose #1\nEnd Sub';
    const ast = parseSource(src);
    const sub = ast.procedures[0] as SubDecl;
    const constructs = sub.body.map((s) => s.kind);
    expect(constructs).toContain("UnsupportedStatement");
  });

  it("parsing does not throw ParseError on any fixture module", () => {
    const fixturesDir = resolve(__dirname, "../../../fixtures/src");
    const fixtures = readdirSync(fixturesDir);
    for (const fixture of fixtures) {
      const basFile = join(fixturesDir, fixture, "Module1.bas");
      let source: string;
      try {
        source = readFileSync(basFile, "utf-8");
      } catch {
        continue; // skip if no Module1.bas
      }
      expect(
        () => parse(tokenize(source), fixture),
        `fixture ${fixture}/Module1.bas should parse without error`,
      ).not.toThrow();
    }
  });
});

describe("parser: single-line If, literal types, labels", () => {
  it("single-line If with Else does not swallow the following lines", () => {
    const ast = parseSource("Sub S()\nIf x = 1 Then y = 2 Else y = 3\ny = 4\nz = 5\nEnd Sub");
    const body = ast.procedures[0].body;
    expect(body.map((s) => s.kind)).toEqual(["IfStatement", "AssignStatement", "AssignStatement"]);
  });

  it("single-line If without Else does not swallow the following lines", () => {
    const ast = parseSource("Sub S()\nIf x = 1 Then y = 2\ny = 4\nEnd Sub");
    expect(ast.procedures[0].body.map((s) => s.kind)).toEqual(["IfStatement", "AssignStatement"]);
  });

  it("types small unsuffixed literals as Integer and large ones as Long", () => {
    const ast = parseSource("Sub S()\nx = 1\ny = 40000\nz = 1.5\nEnd Sub");
    const types = ast.procedures[0].body.map((s) =>
      s.kind === "AssignStatement" && s.value.kind === "Literal" ? s.value.typeName : null,
    );
    expect(types).toEqual(["Integer", "Long", "Double"]);
  });

  it("parses labels and GoTo", () => {
    const ast = parseSource("Sub S()\nGoTo Done\nx = 1\nDone:\nEnd Sub");
    expect(ast.procedures[0].body.map((s) => s.kind)).toEqual([
      "GoToStatement",
      "AssignStatement",
      "LabelStatement",
    ]);
  });

  it("reports Resume as an unsupported statement", () => {
    const ast = parseSource("Sub S()\nResume Next\nEnd Sub");
    const stmt = ast.procedures[0].body[0];
    expect(stmt.kind).toBe("UnsupportedStatement");
  });

  it("closes a multi-line If / ElseIf / Else at End If", () => {
    const ast = parseSource("Sub S()\nIf a Then\nx = 1\nElseIf b Then\nx = 2\nElse\nx = 3\nEnd If\ny = 4\nEnd Sub");
    const body = ast.procedures[0].body;
    expect(body.map((s) => s.kind)).toEqual(["IfStatement", "AssignStatement"]);
  });

  it("keeps omitted arguments of a call without parentheses", () => {
    const ast = parseSource('Sub S()\nErr.Raise 1001, , "custom"\nEnd Sub');
    const stmt = ast.procedures[0].body[0];
    expect(stmt.kind).toBe("CallStatement");
    if (stmt.kind === "CallStatement") {
      expect(stmt.args.map((a) => a.kind)).toEqual(["Literal", "NothingExpr", "Literal"]);
    }
  });
});

describe("parser: dotted type names and As New (DTASK-01)", () => {
  function declarators(src: string) {
    const sub = parseSource(`Sub S()\n${src}\nEnd Sub`).procedures[0] as SubDecl;
    const dim = sub.body[0] as import("../src/ast.js").DimStatement;
    return dim.declarators;
  }

  it("Dim d As New Scripting.Dictionary", () => {
    const [d] = declarators("Dim d As New Scripting.Dictionary");
    expect(d.typeName).toBe("Scripting.Dictionary");
    expect(d.isNew).toBe(true);
  });

  it("Dim d As Scripting.Dictionary is not New", () => {
    const [d] = declarators("Dim d As Scripting.Dictionary");
    expect(d.typeName).toBe("Scripting.Dictionary");
    expect(d.isNew).toBe(false);
  });

  it("Set d = New Scripting.Dictionary gives a NewExpr with the dotted class name", () => {
    const sub = parseSource("Sub S()\nSet d = New Scripting.Dictionary\nEnd Sub").procedures[0] as SubDecl;
    const set = sub.body[0] as import("../src/ast.js").SetStatement;
    expect(set.value.kind).toBe("NewExpr");
    expect((set.value as import("../src/ast.js").NewExpr).className).toBe("Scripting.Dictionary");
  });

  it("other declarations parse as before", () => {
    const [r] = declarators("Dim r As Excel.Range");
    expect(r).toMatchObject({ name: "r", typeName: "Excel.Range", isNew: false });
    const [x] = declarators("Dim x As Long");
    expect(x).toMatchObject({ typeName: "Long", isNew: false, dimensions: null });
    const [a] = declarators("Dim a(1 To 3) As String");
    expect(a.typeName).toBe("String");
    expect(a.dimensions).toHaveLength(1);
    expect(a.isNew).toBe(false);
  });
});
