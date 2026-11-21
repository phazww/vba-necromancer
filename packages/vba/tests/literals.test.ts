import { describe, it, expect } from "vitest";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { runMacro } from "../src/run.js";
import { MemoryWorkbook } from "../src/memory-workbook.js";
import { ParseError, UnsupportedError } from "../src/errors.js";
import type { AssignStatement, Literal, SubDecl } from "../src/ast.js";
import type { VBAValue } from "../src/host.js";

// The oracle: hand-written in .kiro/specs/parser-fixes/requirements.md. Do not adjust to match the code.
const LIT: Array<[string, "Integer" | "Long", number]> = [
  ["&H10", "Integer", 16],
  ["&HFF", "Integer", 255],
  ["&hff", "Integer", 255],
  ["&H7FFF", "Integer", 32767],
  ["&H8000", "Integer", -32768],
  ["&HFFFF", "Integer", -1],
  ["&HFFFF&", "Long", 65535],
  ["&H10000", "Long", 65536],
  ["&H7FFFFFFF", "Long", 2147483647],
  ["&H80000000", "Long", -2147483648],
  ["&HFFFFFFFF", "Long", -1],
  ["&O17", "Integer", 15],
  ["&O177777", "Integer", -1],
  ["&HFF%", "Integer", 255],
];

function literalOf(src: string): Literal {
  const ast = parse(tokenize(`Sub T()\nx = ${src}\nEnd Sub`), "M");
  const stmt = (ast.procedures[0] as SubDecl).body[0] as AssignStatement;
  return stmt.value as Literal;
}

function run(body: string, cells: Array<[number, VBAValue]> = []) {
  const wb = new MemoryWorkbook([
    { name: "S", cells: cells.map(([row, value]) => ({ row, col: 1, value })) },
  ]);
  const result = runMacro("T", [parse(tokenize(`Sub T()\n${body}\nEnd Sub\n`), "M")], wb);
  return { result, a: (row: number) => wb.cell("S", row, 1) };
}

describe("PTASK-02: hex and octal literals (LIT-01..LIT-03)", () => {
  it.each(LIT)("%s is %s %d", (src, type, value) => {
    const lit = literalOf(src);
    expect(lit.typeName).toBe(type);
    expect(lit.value).toBe(value);
  });

  it.each(LIT)("%s evaluates to the same type and value at run time", (src, type, value) => {
    const { result, a } = run(`Cells(1, 1).Value = ${src}\nCells(2, 1).Value = TypeName(${src})`);
    expect(result.error).toBeUndefined();
    expect(a(1)).toBe(value);
    expect(a(2)).toBe(type);
  });

  it("more than 32 bits is a ParseError with module and line", () => {
    for (const src of ["&H100000000", "&O77777777777777", "&H1FFFFFFFF&"]) {
      let err: unknown;
      try {
        parse(tokenize(`Sub T()\n\nx = ${src}\nEnd Sub`), "Mod1");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).module).toBe("Mod1");
      expect((err as ParseError).line).toBe(3);
    }
  });

  it("a value over 16 bits with % is a ParseError", () => {
    expect(() => literalOf("&H10000%")).toThrow(ParseError);
  });

  it("the ^ suffix is reported as unsupported with module and line", () => {
    let err: unknown;
    try {
      literalOf("&H1^");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnsupportedError);
    expect((err as UnsupportedError).module).toBe("M");
    expect((err as UnsupportedError).line).toBe(2);
    expect((err as UnsupportedError).construct).toBe("LongLong literal");
  });

  it("works in expressions: bit mask and colour constant", () => {
    const { result, a } = run("Cells(1, 1).Value = &HFF And &H0F\nCells(2, 1).Value = &HFF0000 + 1");
    expect(result.error).toBeUndefined();
    expect(a(1)).toBe(15);
    expect(a(2)).toBe(16711681);
  });
});

describe("PTASK-02: & stays the concatenation operator (LIT-04)", () => {
  const vars = 'h = "H"\nn = 5\nH1 = "x"\n';
  it.each([
    ['x = "a" & h', "aH"],
    ['x = "a"&"b"', "ab"],
    ['x = n & ""', "5"],
    ['x = "a" & H1', "ax"],
  ])("%s", (stmt, expected) => {
    const { result, a } = run(`${vars}${stmt}\nCells(1, 1).Value = x`);
    expect(result.error).toBeUndefined();
    expect(a(1)).toBe(expected);
  });
});

describe("PTASK-07: ^ after a decimal literal is the exponent operator (POW-01)", () => {
  it("lexes 2^3 as number, Caret, number", () => {
    const toks = tokenize("2^3").map((t) => t.value);
    expect(toks.slice(0, 3)).toEqual(["2", "^", "3"]);
  });
  it.each([
    ["x = 2^3", 8],
    ["x = 2 ^ 3", 8],
    ["x = 2^3^2", 64],
    ["x = 10^-1", 0.1],
    ["x = 3\nx = x^2", 9],
  ])("%s", (src, expected) => {
    const { result, a } = run(`${src}\nCells(1, 1).Value = x`);
    expect(result.error).toBeUndefined();
    expect(a(1)).toBe(expected);
  });
});
