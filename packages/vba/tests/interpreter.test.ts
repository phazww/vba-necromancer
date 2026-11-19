import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { runMacro } from "../src/run.js";
import { MemoryWorkbook } from "../src/memory-workbook.js";
import type { VBAValue } from "../src/host.js";
import { RuntimeError, UnsupportedError } from "../src/errors.js";

/** Run `Sub T()` from the given module text on a one-sheet workbook; results are read from column A. */
function exec(source: string, options?: { maxIterations?: number }) {
  const wb = new MemoryWorkbook([{ name: "S" }]);
  const result = runMacro("T", [parse(tokenize(source), "Module1")], wb, options);
  const a = (row: number): VBAValue => wb.cell("S", row, 1);
  return { wb, result, a };
}

const sub = (body: string, header = ""): string => `${header}\nSub T()\n${body}\nEnd Sub\n`;

describe("control flow", () => {
  it("For counts to 5 and the variable ends at 6", () => {
    const { a, result } = exec(
      sub("Dim i As Long, n As Long\nFor i = 1 To 5\nn = n + 1\nNext i\nCells(1, 1).Value = n\nCells(2, 1).Value = i"),
    );
    expect(result.error).toBeUndefined();
    expect(a(1)).toBe(5);
    expect(a(2)).toBe(6);
  });

  it("Exit For keeps the loop variable", () => {
    const { a } = exec(
      sub("Dim i As Long\nFor i = 1 To 10\nIf i = 3 Then Exit For\nNext i\nCells(1, 1).Value = i"),
    );
    expect(a(1)).toBe(3);
  });

  it("For with negative and fractional Step", () => {
    const { a } = exec(
      sub("Dim i As Long, x As Double, s As String\nFor i = 5 To 1 Step -2\ns = s & i\nNext\nFor x = 0 To 1 Step 0.5\ns = s & \"|\" & x\nNext\nCells(1, 1).Value = s"),
    );
    expect(a(1)).toBe("531|0|0.5|1");
  });

  it("Do While, Do Until, Loop While, Loop Until", () => {
    const { a } = exec(
      sub(
        "Dim x As Long\nDo While x < 3\nx = x + 1\nLoop\nCells(1, 1).Value = x\n" +
          "Do Until x >= 10\nx = x + 5\nLoop\nCells(2, 1).Value = x\n" +
          "Do\nx = x + 1\nLoop While x < 5\nCells(3, 1).Value = x\n" +
          "Do\nx = x + 1\nLoop Until x > 0\nCells(4, 1).Value = x",
      ),
    );
    expect([a(1), a(2), a(3), a(4)]).toEqual([3, 13, 14, 15]);
  });

  it("While...Wend and Exit Do", () => {
    const { a } = exec(
      sub("Dim x As Long\nWhile x < 4\nx = x + 1\nWend\nDo\nx = x + 10\nIf x > 20 Then Exit Do\nLoop\nCells(1, 1).Value = x"),
    );
    expect(a(1)).toBe(24);
  });

  it("Select Case: single-line 'Case 2: stmt', lists, ranges, Is, Else", () => {
    const body = (v: number): string =>
      `Dim y As Long, v As Long\nv = ${v}\nSelect Case v\nCase 1: y = 11\nCase 2: y = 99\nCase 3, 4: y = 34\nCase 5 To 8: y = 58\nCase Is > 100: y = 100\nCase Else: y = -1\nEnd Select\nCells(1, 1).Value = y`;
    expect(exec(sub(body(2))).a(1)).toBe(99);
    expect(exec(sub(body(1))).a(1)).toBe(11);
    expect(exec(sub(body(4))).a(1)).toBe(34);
    expect(exec(sub(body(7))).a(1)).toBe(58);
    expect(exec(sub(body(500))).a(1)).toBe(100);
    expect(exec(sub(body(50))).a(1)).toBe(-1);
  });

  it("Select Case on strings honours Option Compare Text", () => {
    const body = 'Dim y As Long\nSelect Case "ABC"\nCase "abc": y = 1\nCase Else: y = 2\nEnd Select\nCells(1, 1).Value = y';
    expect(exec(sub(body)).a(1)).toBe(2);
    expect(exec(sub(body, "Option Compare Text")).a(1)).toBe(1);
  });

  it("If / ElseIf / Else and single-line If with Else", () => {
    const { a } = exec(
      sub(
        "Dim x As Long, y As Long\nx = 5\nIf x < 3 Then\ny = 1\nElseIf x < 6 Then\ny = 2\nElse\ny = 3\nEnd If\nCells(1, 1).Value = y\n" +
          "If x = 5 Then y = 10 Else y = 20\nCells(2, 1).Value = y\nCells(3, 1).Value = 7",
      ),
    );
    expect([a(1), a(2), a(3)]).toEqual([2, 10, 7]);
  });

  it("For Each over an array", () => {
    const { a } = exec(
      sub('Dim v As Variant, s As String\nFor Each v In Array(3, 4, 5)\ns = s & v\nNext v\nCells(1, 1).Value = s'),
    );
    expect(a(1)).toBe("345");
  });

  it("With block resolves .Member against the target", () => {
    const { a } = exec(
      sub('Dim ws As Worksheet\nSet ws = Worksheets("S")\nWith ws\n.Cells(1, 1).Value = 7\n.Range("A2").Value = "x"\nEnd With'),
    );
    expect([a(1), a(2)]).toEqual([7, "x"]);
  });

  it("stops runaway loops with RuntimeError(0)", () => {
    const { result } = exec(sub("Do\nLoop"), { maxIterations: 100 });
    expect(result.status).toBe("failed");
    expect(result.error).toBeInstanceOf(RuntimeError);
    expect((result.error as RuntimeError).code).toBe(0);
    expect(result.error?.message).toContain("max iterations exceeded");
  });

  it("labels and GoTo", () => {
    const { a } = exec(sub("Cells(1, 1).Value = 1\nGoTo Done\nCells(2, 1).Value = 2\nDone:\nCells(3, 1).Value = 3"));
    expect([a(1), a(2), a(3)]).toEqual([1, null, 3]);
  });
});

describe("procedures", () => {
  const lib = `
Function Twice(ByVal n As Long) As Long
    n = n * 2
    Twice = n
End Function
Sub Bump(ByRef n As Long)
    n = n + 1
End Sub
Sub BumpVal(ByVal n As Long)
    n = n + 100
End Sub
Function Fact(n As Long) As Long
    If n <= 1 Then
        Fact = 1
    Else
        Fact = n * Fact(n - 1)
    End If
End Function
Function Opt(Optional x As Long = 7) As Long
    Opt = x
End Function
Function Early() As String
    Early = "set"
    Exit Function
    Early = "not reached"
End Function
`;

  it("returns by assigning the function name", () => {
    const { a } = exec(sub("Cells(1, 1).Value = Twice(21)\nCells(2, 1).Value = Fact(5)\nCells(3, 1).Value = Early()", lib));
    expect([a(1), a(2), a(3)]).toEqual([42, 120, "set"]);
  });

  it("ByRef changes the caller's variable, ByVal does not", () => {
    const { a } = exec(sub("Dim k As Long\nk = 1\nBump k\nBump k\nBumpVal k\nCells(1, 1).Value = k", lib));
    expect(a(1)).toBe(3);
  });

  it("ByRef with an array element writes back", () => {
    const { a } = exec(sub("Dim arr(2) As Long\narr(1) = 5\nBump arr(1)\nCells(1, 1).Value = arr(1)", lib));
    expect(a(1)).toBe(6);
  });

  it("Optional parameters take their default; Call works", () => {
    const { a } = exec(sub("Cells(1, 1).Value = Opt()\nCells(2, 1).Value = Opt(3)\nCall Bump(Cells(9, 9).Value)", lib));
    expect([a(1), a(2)]).toEqual([7, 3]);
  });

  it("a missing required argument is error 449", () => {
    const { result } = exec(sub("Dim x As Long\nx = Twice()", lib));
    expect((result.error as RuntimeError).code).toBe(449);
  });

  it("module-level variables and constants", () => {
    const { a } = exec(
      sub("Counter = Counter + LIMIT\nCells(1, 1).Value = Counter", "Dim Counter As Long\nConst LIMIT As Long = 40"),
    );
    expect(a(1)).toBe(40);
  });
});

describe("variables, arrays and Variant", () => {
  it("Dim arr(2) is 0-based with 3 elements; explicit bounds; UBound/LBound", () => {
    const { a } = exec(
      sub("Dim x(2) As Long, y(3 To 5) As String\nCells(1, 1).Value = UBound(x)\nCells(2, 1).Value = LBound(y)\nCells(3, 1).Value = UBound(y)"),
    );
    expect([a(1), a(2), a(3)]).toEqual([2, 3, 5]);
  });

  it("Option Base 1: Dim arr(3) is 1..3 and arr(0) is error 9", () => {
    const base = "Option Base 1";
    const ok = exec(sub("Dim arr(3) As Long\narr(3) = 4\nCells(1, 1).Value = arr(3) + LBound(arr)", base));
    expect(ok.a(1)).toBe(5);
    const bad = exec(sub("Dim arr(3) As Long\narr(0) = 1", base));
    expect((bad.result.error as RuntimeError).code).toBe(9);
  });

  it("ReDim Preserve keeps elements and new ones are Empty", () => {
    const { a } = exec(
      sub('Dim arr() As Variant\nReDim arr(2)\narr(1) = "a"\nReDim Preserve arr(4)\nCells(1, 1).Value = arr(1)\nCells(2, 1).Value = IsEmpty(arr(4))\nCells(3, 1).Value = UBound(arr)'),
    );
    expect([a(1), a(2), a(3)]).toEqual(["a", true, 4]);
  });

  it("ReDim without Preserve clears; Preserve cannot change a non-last dimension", () => {
    const clear = exec(sub("Dim arr() As Long\nReDim arr(2)\narr(1) = 5\nReDim arr(2)\nCells(1, 1).Value = arr(1)"));
    expect(clear.a(1)).toBe(0);
    const twoD = exec(sub("Dim m() As Long\nReDim m(1, 1)\nm(1, 1) = 9\nReDim Preserve m(1, 3)\nCells(1, 1).Value = m(1, 1)\nCells(2, 1).Value = UBound(m, 2)"));
    expect([twoD.a(1), twoD.a(2)]).toEqual([9, 3]);
    const bad = exec(sub("Dim m() As Long\nReDim m(1, 1)\nReDim Preserve m(2, 1)"));
    expect((bad.result.error as RuntimeError).code).toBe(9);
  });

  it("assigning an array copies it", () => {
    const { a } = exec(sub("Dim p() As String, q() As String\np = Split(\"a,b\", \",\")\nq = p\nq(0) = \"z\"\nCells(1, 1).Value = p(0)\nCells(2, 1).Value = q(0)"));
    expect([a(1), a(2)]).toEqual(["a", "z"]);
  });

  it("Variant Empty: IsEmpty, 0 in arithmetic, empty string in concatenation, equal to 0 and \"\"", () => {
    const { a } = exec(
      sub(
        "Dim v As Variant\nCells(1, 1).Value = IsEmpty(v)\nCells(2, 1).Value = v + 5\nCells(3, 1).Value = \"[\" & v & \"]\"\nCells(4, 1).Value = (v = 0)\nCells(5, 1).Value = (v = \"\")\nCells(6, 1).Value = TypeName(v)\nv = 3\nCells(7, 1).Value = IsEmpty(v)\nCells(8, 1).Value = TypeName(v)\nv = Empty\nCells(9, 1).Value = IsEmpty(v)",
      ),
    );
    expect([a(1), a(2), a(3), a(4), a(5), a(6), a(7), a(8), a(9)]).toEqual([true, 5, "[]", true, true, "Empty", false, "Integer", true]);
  });

  it("an empty cell read into a Variant is Empty", () => {
    const { a } = exec(sub("Dim v As Variant\nv = Cells(50, 50).Value\nCells(1, 1).Value = IsEmpty(v)"));
    expect(a(1)).toBe(true);
  });

  it("typed variables convert on assignment", () => {
    const { a } = exec(
      sub('Dim l As Long, d As Double, s As String, b As Boolean\nl = 2.5\nd = "1.5"\ns = 12\nb = 3\nCells(1, 1).Value = l\nCells(2, 1).Value = d\nCells(3, 1).Value = s\nCells(4, 1).Value = b'),
    );
    expect([a(1), a(2), a(3), a(4)]).toEqual([2, 1.5, "12", true]);
  });

  it("assigning a non-numeric string to a Long is error 13", () => {
    const { result } = exec(sub('Dim l As Long\nl = "abc"'));
    expect((result.error as RuntimeError).code).toBe(13);
  });

  it("Dim inside a loop does not reset the variable", () => {
    const { a } = exec(sub("Dim i As Long\nFor i = 1 To 3\nDim n As Long\nn = n + 1\nNext\nCells(1, 1).Value = n"));
    expect(a(1)).toBe(3);
  });

  it("Option Explicit rejects undeclared variables", () => {
    const { result } = exec(sub("x = 1", "Option Explicit"));
    expect(result.status).toBe("failed");
  });
});

describe("numeric typing", () => {
  it("Integer arithmetic overflows with error 6, Long does not", () => {
    const i = exec(sub("Dim i As Integer\ni = 32767\ni = i + 1"));
    expect((i.result.error as RuntimeError).code).toBe(6);
    const l = exec(sub("Dim n As Long\nn = 32767\nn = n + 1\nCells(1, 1).Value = n"));
    expect(l.a(1)).toBe(32768);
  });

  it("literals beyond 16 bits are Long, so 40000 * 2 does not overflow", () => {
    expect(exec(sub("Cells(1, 1).Value = 40000 * 2")).a(1)).toBe(80000);
    expect(exec(sub("Cells(1, 1).Value = 200 * 200")).result.error).toBeInstanceOf(RuntimeError);
  });

  it("division by zero is error 11", () => {
    expect((exec(sub("Cells(1, 1).Value = 1 / 0")).result.error as RuntimeError).code).toBe(11);
    expect((exec(sub("Cells(1, 1).Value = 1 \\ 0")).result.error as RuntimeError).code).toBe(11);
  });

  it("And / Or / Not on booleans and integers", () => {
    const { a } = exec(sub("Cells(1, 1).Value = (1 < 2 And 2 < 3)\nCells(2, 1).Value = (6 And 3)\nCells(3, 1).Value = (6 Or 1)\nCells(4, 1).Value = Not False\nCells(5, 1).Value = Not 5"));
    expect([a(1), a(2), a(3), a(4), a(5)]).toEqual([true, 2, 7, true, -6]);
  });
});

describe("error handling", () => {
  it("Resume Next skips the failing statement and sets Err", () => {
    const { a } = exec(
      sub("Dim i As Integer\nOn Error Resume Next\ni = 32767\ni = i + 1\nCells(1, 1).Value = Err.Number\nCells(2, 1).Value = Err.Description\nCells(3, 1).Value = i\nErr.Clear\nCells(4, 1).Value = Err.Number"),
    );
    expect([a(1), a(2), a(3), a(4)]).toEqual([6, "Overflow", 32767, 0]);
  });

  it("On Error GoTo 0 makes errors propagate again", () => {
    const { result } = exec(sub("On Error Resume Next\nOn Error GoTo 0\nCells(1, 1).Value = 1 / 0"));
    expect(result.status).toBe("failed");
    expect((result.error as RuntimeError).code).toBe(11);
  });

  it("On Error GoTo label jumps to the handler", () => {
    const { a, result } = exec(
      sub('On Error GoTo Oops\nCells(1, 1).Value = 1\nCells(2, 1).Value = 1 / 0\nCells(3, 1).Value = "skipped"\nExit Sub\nOops:\nCells(4, 1).Value = Err.Number\nCells(5, 1).Value = Err.Description'),
    );
    expect(result.status).toBe("fully resurrected");
    expect([a(1), a(2), a(3), a(4), a(5)]).toEqual([1, null, null, 11, "Division by zero"]);
  });

  it("an error inside a nested block reaches the handler", () => {
    const { a } = exec(
      sub("Dim i As Long\nOn Error GoTo H\nFor i = 1 To 5\nIf i = 3 Then Cells(1, 1).Value = 1 / 0\nNext\nExit Sub\nH:\nCells(2, 1).Value = i"),
    );
    expect(a(2)).toBe(3);
  });

  it("an error in a callee is handled by the caller's handler", () => {
    const { a } = exec(
      sub("On Error Resume Next\nBoom\nCells(1, 1).Value = Err.Number", "Sub Boom()\nDim x As Long\nx = 1 / 0\nEnd Sub"),
    );
    expect(a(1)).toBe(11);
  });

  it("Err.Raise raises a trappable error", () => {
    const { a } = exec(sub('On Error Resume Next\nErr.Raise 1001, , "custom"\nCells(1, 1).Value = Err.Number\nCells(2, 1).Value = Err.Description'));
    expect([a(1), a(2)]).toEqual([1001, "custom"]);
  });

  it("an untrapped error reports module and line", () => {
    const { result } = exec(sub("Dim x As Long\nx = 1 / 0"));
    const e = result.error as RuntimeError;
    expect(e.module).toBe("Module1");
    expect(e.line).toBe(4);
  });
});

describe("unsupported constructs", () => {
  it("an UnsupportedStatement throws UnsupportedError with module and line", () => {
    const { result } = exec(sub('Open "x.txt" For Output As #1'));
    expect(result.status).toBe("failed");
    const e = result.error as UnsupportedError;
    expect(e).toBeInstanceOf(UnsupportedError);
    expect([e.module, e.line, e.construct]).toEqual(["Module1", 3, "Open"]);
  });

  it("under Resume Next the error is recorded and execution continues", () => {
    const { a, result } = exec(sub('On Error Resume Next\nOpen "x.txt" For Output As #1\nCells(1, 1).Value = 5'));
    expect(a(1)).toBe(5);
    expect(result.status).toBe("partly resurrected");
    expect(result.unsupported).toEqual([{ module: "Module1", line: 4, construct: "Open" }]);
  });

  it("known but unimplemented library functions are unsupported, not undefined", () => {
    const { result } = exec(sub("Dim s As String\ns = Format(1, \"0.00\")"));
    const e = result.error as UnsupportedError;
    expect(e).toBeInstanceOf(UnsupportedError);
    expect(e.construct).toBe("Format");
  });

  it("unsupported Range members and types are reported", () => {
    const m = exec(sub("Cells(1, 1).Interior.Color = 1"));
    expect((m.result.error as UnsupportedError).construct).toBe("Range.Interior");
    const t = exec(sub("Dim c As Currency\nc = 1"));
    expect((t.result.error as UnsupportedError).construct).toContain("Currency");
  });

  it("a call to a Declare'd function reports the Declare", () => {
    const { result } = exec(
      sub("Dim t As Long\nt = GetTickCount()", 'Private Declare PtrSafe Function GetTickCount Lib "kernel32" () As Long'),
    );
    const e = result.error as UnsupportedError;
    expect(e.construct.toLowerCase()).toBe("declare");
  });
});

describe("workbook stub", () => {
  it("Rows.Count and End(xlUp).Row find the last used row", () => {
    const wb = new MemoryWorkbook([
      { name: "S", cells: [1, 2, 3, 4].map((row) => ({ row, col: 1, value: row })) },
    ]);
    const src = sub("Cells(1, 3).Value = Cells(Rows.Count, 1).End(xlUp).Row\nCells(2, 3).Value = Rows.Count");
    runMacro("T", [parse(tokenize(src), "Module1")], wb);
    expect(wb.cell("S", 1, 3)).toBe(4);
    expect(wb.cell("S", 2, 3)).toBe(1048576);
  });

  it("multi-cell Range.Value is a 1-based 2-D array, and can be written back", () => {
    const wb = new MemoryWorkbook([
      { name: "S", cells: [{ row: 1, col: 1, value: 1 }, { row: 1, col: 2, value: 2 }, { row: 2, col: 1, value: 3 }, { row: 2, col: 2, value: 4 }] },
    ]);
    const src = sub('Dim v As Variant\nv = Range("A1:B2").Value\nCells(5, 1).Value = v(2, 1)\nCells(6, 1).Value = UBound(v, 2)\nRange("D1:E2").Value = v');
    const r = runMacro("T", [parse(tokenize(src), "Module1")], wb);
    expect(r.error).toBeUndefined();
    expect(wb.cell("S", 5, 1)).toBe(3);
    expect(wb.cell("S", 6, 1)).toBe(2);
    expect(wb.cell("S", 2, 5)).toBe(4);
  });

  it("an unknown sheet is error 9", () => {
    const { result } = exec(sub('Dim ws As Worksheet\nSet ws = Worksheets("Nope")'));
    expect((result.error as RuntimeError).code).toBe(9);
  });
});

describe("string built-ins", () => {
  const val = (expr: string): VBAValue => exec(sub(`Cells(1, 1).Value = ${expr}`)).a(1);

  it("Left, Right, Mid, Trim, Len, UCase, LCase", () => {
    expect(val('Left("abcdef", 2)')).toBe("ab");
    expect(val('Right("abcdef", 2)')).toBe("ef");
    expect(val('Mid("abcdef", 3, 2)')).toBe("cd");
    expect(val('Mid("abcdef", 3)')).toBe("cdef");
    expect(val('Trim("  a b  ")')).toBe("a b");
    expect(val('Len("hello")')).toBe(5);
    expect(val('UCase("aб")')).toBe("AБ");
    expect(val('LCase("AB")')).toBe("ab");
  });

  it("InStr with and without start and compare", () => {
    expect(val('InStr("abcabc", "c")')).toBe(3);
    expect(val('InStr(4, "abcabc", "c")')).toBe(6);
    expect(val('InStr("abc", "B")')).toBe(0);
    expect(val('InStr(1, "abc", "B", vbTextCompare)')).toBe(2);
    expect(val('InStr("abc", "z")')).toBe(0);
  });

  it("Replace, Split, Join", () => {
    expect(val('Replace("a-b-c", "-", "+")')).toBe("a+b+c");
    expect(val('Replace("a-b-c", "-", "+", 1, 1)')).toBe("a+b-c");
    expect(val('Join(Split("a,b,,c", ","), "|")')).toBe("a|b||c");
    expect(val('UBound(Split("", ","))')).toBe(-1);
  });

  it("StrComp, Like", () => {
    expect(val('StrComp("a", "b")')).toBe(-1);
    expect(val('StrComp("B", "a", vbTextCompare)')).toBe(1);
    expect(val('"abc" Like "a*c"')).toBe(true);
    expect(val('"abc" Like "a?d"')).toBe(false);
    expect(val('"b" Like "[a-c]"')).toBe(true);
    expect(val('"b" Like "[!a-c]"')).toBe(false);
    expect(val('"A" Like "a"')).toBe(false);
  });

  it("Option Compare Text makes = and Like case-insensitive", () => {
    const { a } = exec(sub('Cells(1, 1).Value = ("abc" = "ABC")\nCells(2, 1).Value = ("abc" Like "A*")', "Option Compare Text"));
    expect([a(1), a(2)]).toEqual([true, true]);
  });

  it("concatenation formats numbers like CStr", () => {
    expect(val('"n=" & 2.5 & "/" & 1 & "/" & True')).toBe("n=2.5/1/True");
    expect(val("CStr(0.1 + 0.2)")).toBe("0.3");
  });

  it("property: Len(s) equals the JS length and Len(Left(s, Len(s))) is unchanged", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[ -~]{0,30}$/).filter((s) => !s.includes('"')), (s) => {
        const { a } = exec(sub(`Cells(1, 1).Value = Len("${s}")\nCells(2, 1).Value = Len(Left("${s}", Len("${s}")))`));
        return a(1) === s.length && a(2) === s.length;
      }),
      { numRuns: 50 },
    );
  });
});

describe("math and conversion built-ins", () => {
  const val = (expr: string): VBAValue => exec(sub(`Cells(1, 1).Value = ${expr}`)).a(1);

  it("rounds half to even in CInt, CLng, Round", () => {
    expect([val("CInt(0.5)"), val("CInt(1.5)"), val("CInt(2.5)"), val("CInt(-0.5)"), val("CInt(-1.5)")]).toEqual([0, 2, 2, 0, -2]);
    expect([val("CLng(2.5)"), val("CLng(3.5)")]).toEqual([2, 4]);
    expect([val("Round(2.675, 2)"), val("Round(0.125, 2)"), val("Round(-2.5)")]).toEqual([2.67, 0.12, -2]);
  });

  it("CInt overflows with error 6", () => {
    const { result } = exec(sub("Cells(1, 1).Value = CInt(40000)"));
    expect((result.error as RuntimeError).code).toBe(6);
  });

  it("Int floors, Fix truncates, Abs, Sgn, Sqr", () => {
    expect([val("Int(-2.5)"), val("Fix(-2.5)"), val("Int(2.9)"), val("Abs(-3.5)"), val("Sgn(-9)"), val("Sqr(16)")]).toEqual([-3, -2, 2, 3.5, -1, 4]);
  });

  it("CDbl, CStr, CBool accept numeric strings", () => {
    expect([val('CDbl("1.5") + 1'), val("CStr(12)"), val('CBool("True")'), val("CBool(0)")]).toEqual([2.5, "12", true, false]);
  });

  it("CLng on text that is not a number is error 13", () => {
    const { result } = exec(sub('Cells(1, 1).Value = CLng("abc")'));
    expect((result.error as RuntimeError).code).toBe(13);
  });
});
