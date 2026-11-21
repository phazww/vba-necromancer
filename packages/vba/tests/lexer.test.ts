import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { tokenize } from "../src/lexer.js";
import { TokenType } from "../src/ast.js";

describe("tokenize", () => {
  it("property: never throws on arbitrary string input (10 000 runs)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 4096 }), (s) => {
        tokenize(s);
        return true;
      }),
      { numRuns: 10_000 },
    );
  });

  it("tokenizes 'Dim x As Integer'", () => {
    const tokens = tokenize("Dim x As Integer").filter(
      (t) => t.type !== TokenType.EOF,
    );
    expect(tokens.map((t) => t.type)).toEqual([
      TokenType.Dim,
      TokenType.Identifier,
      TokenType.As,
      TokenType.TInteger,
    ]);
    expect(tokens.map((t) => t.value)).toEqual(["Dim", "x", "As", "Integer"]);
  });

  it("tokenizes a comment followed by a newline and Sub", () => {
    const tokens = tokenize("' this is a comment\nSub Foo()").filter(
      (t) => t.type !== TokenType.EOF,
    );
    expect(tokens[0].type).toBe(TokenType.Comment);
    expect(tokens[1].type).toBe(TokenType.Newline);
    expect(tokens[2].type).toBe(TokenType.Sub);
    expect(tokens[2].line).toBe(2);
  });

  it("tokenizes 'x%' as a single Identifier token with value 'x%'", () => {
    const tokens = tokenize("x%").filter((t) => t.type !== TokenType.EOF);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe(TokenType.Identifier);
    expect(tokens[0].value).toBe("x%");
  });

  it("tokenizes a date literal '#2024-01-01#'", () => {
    const tokens = tokenize("#2024-01-01#").filter(
      (t) => t.type !== TokenType.EOF,
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe(TokenType.DateLiteral);
  });

  it("line continuation: 'Dim _\\n  x As Long' has no Continuation token and x/Long appear in sequence", () => {
    const tokens = tokenize("Dim _\n  x As Long").filter(
      (t) => t.type !== TokenType.EOF && t.type !== TokenType.Newline,
    );
    expect(tokens.map((t) => t.value)).toEqual(["Dim", "x", "As", "Long"]);
  });

  it("tokenizes string with embedded double-quote escape", () => {
    const tokens = tokenize('"hello ""world"""').filter(
      (t) => t.type !== TokenType.EOF,
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe(TokenType.StringLiteral);
  });

  it("tokenizes hex literal &H1A", () => {
    const tokens = tokenize("&H1A").filter((t) => t.type !== TokenType.EOF);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe(TokenType.LongLiteral);
  });

  it("tokenizes <> as Neq", () => {
    const tokens = tokenize("<>").filter((t) => t.type !== TokenType.EOF);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe(TokenType.Neq);
  });

  it("tokenizes := as NamedAssign", () => {
    const tokens = tokenize(":=").filter((t) => t.type !== TokenType.EOF);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe(TokenType.NamedAssign);
  });

  it("tokenizes Cyrillic identifiers", () => {
    const tokens = tokenize("Dim кот As Long").filter(
      (t) => t.type !== TokenType.EOF,
    );
    expect(tokens[1].type).toBe(TokenType.Identifier);
    expect(tokens[1].value).toBe("кот");
  });

  it("tracks line numbers correctly across newlines", () => {
    const tokens = tokenize("a\nb\nc").filter(
      (t) => t.type !== TokenType.Newline && t.type !== TokenType.EOF,
    );
    expect(tokens[0].line).toBe(1);
    expect(tokens[1].line).toBe(2);
    expect(tokens[2].line).toBe(3);
  });

  it("Rem is treated as a comment", () => {
    const tokens = tokenize("Rem this is a comment\nx").filter(
      (t) => t.type !== TokenType.EOF,
    );
    expect(tokens[0].type).toBe(TokenType.Comment);
    expect(tokens[0].value.toLowerCase()).toContain("rem");
  });

  describe("PTASK-01: &H and &O literals, & as concatenation", () => {
    const lits: Array<[string, TokenType]> = [
      ["&H10", TokenType.LongLiteral],
      ["&HFF", TokenType.LongLiteral],
      ["&hff", TokenType.LongLiteral],
      ["&H7FFF", TokenType.LongLiteral],
      ["&H8000", TokenType.LongLiteral],
      ["&HFFFF", TokenType.LongLiteral],
      ["&HFFFF&", TokenType.LongLiteral],
      ["&H10000", TokenType.LongLiteral],
      ["&H7FFFFFFF", TokenType.LongLiteral],
      ["&H80000000", TokenType.LongLiteral],
      ["&HFFFFFFFF", TokenType.LongLiteral],
      ["&O17", TokenType.LongLiteral],
      ["&O177777", TokenType.LongLiteral],
      ["&HFF%", TokenType.IntegerLiteral],
    ];
    it.each(lits)("%s is one literal token with its full text", (src, type) => {
      const tokens = tokenize(src).filter((t) => t.type !== TokenType.EOF);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe(type);
      expect(tokens[0].value).toBe(src);
    });

    it("octal stops at a non-octal digit", () => {
      const t = tokenize("&O19").filter((x) => x.type !== TokenType.EOF);
      expect(t.map((x) => x.value)).toEqual(["&O1", "9"]);
    });

    it("& not followed by a valid digit is the concatenation operator", () => {
      const t = tokenize("&HG").filter((x) => x.type !== TokenType.EOF);
      expect(t.map((x) => x.type)).toEqual([TokenType.Concat, TokenType.Identifier]);
    });

    it.each(['"a"&"b"', 'n & ""', '"a" & H1', '"a" & h'])("%s uses Concat", (src) => {
      const t = tokenize(src);
      expect(t.filter((x) => x.type === TokenType.Concat)).toHaveLength(1);
    });
  });
});
