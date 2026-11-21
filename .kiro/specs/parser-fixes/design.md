# Design: Parser fixes

Implements LIT-01..LIT-04, CALL-01, CALL-02, END-01, END-02 (see `requirements.md`). Changes are in `packages/vba` (`lexer.ts`, `parser.ts`, `ast.ts`) and two files in `app/src/model`. No change to `packages/workbook`, `packages/ovba` or `fixtures/expected`.

## 1. Current behaviour

| Gap | Where | Today |
|---|---|---|
| `&H`/`&O` literals | `lexer.ts` `readHexOrOctal`, `parser.ts` `parsePrimary` | the lexer emits a `LongLiteral` with text like `&HFF`; `parsePrimary` calls `parseFloat`, which gives `NaN`. Octal digits are read with `isHexDigit`. `&H` with no digit after it is still lexed as a literal. |
| `Foo -1, 2` | `parser.ts` `parseAssignOrCall` | after the postfix chain, `continueExpression` consumes `- 1` as a subtraction, then `, 2` is left over |
| procedure end | `ast.ts` `SubDecl`/`FunctionDecl` | no end line; `parseBody` discards the `End Sub` token position |

## 2. Literals (LIT-01..LIT-04)

### 2.1 Lexer

`readHexOrOctal` is entered only when `&` is followed by `h`/`H`/`o`/`O` **and** a digit valid for that base (hex: `0-9a-fA-F`, octal: `0-7`). Otherwise `&` is the concatenation operator. This keeps `"a" &Hello` style code and `x = n &H` from turning into broken literals; `"a" & H1` (space) never reached this path.

The literal text is `&` + base letter + digits + optional suffix. The suffix is `%`, `&` or `^`. The token type is `LongLiteral` for `&` and for no suffix, `IntegerLiteral` for `%`. The parser, not the lexer, decides the final type, because it depends on the value. The decimal path in `readNumber` is not touched.

### 2.2 Parser

A helper `parseRadixLiteral(tok): Literal` in `parser.ts` is called from `parsePrimary` when `tok.value` starts with `&`.

1. Split the text into base, digits and suffix. Parse with `parseInt(digits, base)` (digit strings of any length are safe to compare as numbers because over 32 bits is rejected anyway; a very long string gives a number above `0xFFFFFFFF` or `Infinity`, both rejected).
2. Suffix `^`: `UnsupportedError(module, line, "LongLong literal")`.
3. Suffix `%`: value above `0xFFFF` is a `ParseError`; else Integer, with `v >= 0x8000` mapped to `v - 0x10000`.
4. Suffix `&`: value above `0xFFFFFFFF` is a `ParseError`; else Long, with `v >= 0x80000000` mapped to `v - 0x100000000`. So `&HFFFF&` is 65535 and `&HFFFFFFFF` is -1.
5. No suffix: value up to `0xFFFF` is Integer as in step 3; up to `0xFFFFFFFF` is Long as in step 4; above is a `ParseError`.

`ParseError` already carries module, line and column. The oracle table in `requirements.md` is the test input; it is copied into the tests verbatim.

### 2.3 Concatenation (LIT-04)

The lexer already emits `Concat` for `&` not followed by a radix prefix. Tests run `x = "a" & h`, `x = "a"&"b"`, `x = n & ""`, `x = "a" & H1` through the interpreter and compare strings. The lexer rule in 2.1 is what protects `"a" &H1`-free forms; the tests for `H1` use a space, as the requirement states.

## 3. Unary sign after a call name (CALL-01, CALL-02)

Tokens carry `line` and `col` but not whitespace. Adjacency is computed from columns: a token ends at `col + value.length` (all tokens involved are single-line: names, `-`, `+`, numbers).

In `parseAssignOrCall`, after the assignment check and before `continueExpression`, a statement is a bare call with a signed first argument when all hold:

- `lhs.kind` is `Identifier` or `MemberExpr` (not `CallExpr`: `Foo(1) -1` stays binary);
- the current token is `Plus` or `Minus`;
- there is whitespace between the previous token and the sign (`prev.col + prev.value.length < sign.col`);
- there is none between the sign and the next token (`next.col === sign.col + 1`).

Then `continueExpression` is skipped and `parseArgListNoParens` runs; its `parseExpression` handles the unary sign. `Foo - 1`, `Foo-1` and `x = y -1` keep their meaning (the last because the assignment branch returns first). Line continuations are not special-cased: a sign after `_` is not treated as unary, which is the old behaviour.

CALL-02 needs no interpreter change: the call already evaluates `args`. Tests cover a two-line module with a one-parameter Sub, and `d.Add -1, "m"` on `Scripting.Dictionary` with `d.Exists(-1)`.

## 4. Procedure end lines (END-01, END-02)

`ast.ts`: `endLine: number` on `SubDecl` and `FunctionDecl`. `parseBody` returns `{ stmts, endLine }`, where `endLine` is the line of the `End` token of `End Sub`/`End Function`; if the end is missing it is the line of the last token before EOF. The parser has no `Property` procedures (they are not parsed into `ProcedureDecl`), so "End Property" in END-01 has nothing to attach to today; see PTASK-04 in `tasks.md`.

`app/src/model/macros.ts` `procedureSpans`: `to = proc.endLine`. The `lineCount` parameter becomes unused and is removed with its callers (`predict.ts`). `predict.ts` keeps using spans; a hit on a line outside every span (comment or `Dim` between procedures) now takes the existing "declaration level" branch, which applies to every macro of that module. That is the conservative direction and unchanged for hits before the first procedure.

## 5. Test strategy

- `packages/vba/tests/lexer.test.ts`: token type and text for each LIT row, octal digit rule, `&` followed by no digit.
- `packages/vba/tests/literals.test.ts` (new): parse each row of the oracle table and check `Literal.value` and `typeName`; errors with module and line; end-to-end through `runMacro` with `TypeName`; LIT-04 concatenation.
- `packages/vba/tests/calls.test.ts` (new): CALL-01 shapes and CALL-02.
- `packages/vba/tests/parser.test.ts`: `endLine`.
- `app/tests/model`: `procedureSpans` and prediction with a comment between two procedures.

## 6. Risks

- Making `&` not a literal without a following valid digit changes lexing for such text. Before, it produced a broken literal, so nothing valid depends on it.
- The sign rule is heuristic by whitespace, as in the VBA editor. `Foo -1` where `Foo` is a variable is not valid VBA anyway.

## 7. `^` after a decimal literal (POW-01)

`readNumber` took `^` as a LongLong suffix, so `2^3` lexed as one literal `2^` followed by `3`. The decimal path now accepts only `%` and `&` as suffixes; `^` is the `Caret` operator. `&H1^` keeps the LongLong report from 2.2. VBA's `^` is left-associative, but `parsePower` was right-associative (`2^3^2` gave 512). `parsePower` and `continuePower` now loop, and the right operand is an optional sign plus a postfix expression (so `10^-1` works). `-2^2` still parses as `-(2^2)`.
