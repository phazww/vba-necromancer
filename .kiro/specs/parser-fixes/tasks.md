# Tasks: parser-fixes

Ordered so each task leaves the checks green. IDs use the `PTASK-` prefix. Design references are to `design.md`.

Rules for every task:
- Do not edit `fixtures/expected/*.json` or `.gitignore`.
- The LIT table in `requirements.md` is a hand-written oracle. Never change an expected value to make a test pass. If a row looks wrong, stop and write why under that task.
- Mark a task done only when `npm test`, `npm run lint`, `npm run typecheck` and `npm run build -w app` are all green.
- No `any` in `packages/vba`. Do not commit.

---

## PTASK-01: Lexer reads `&H` and `&O` literals

**Status:** Done
**Requires:** LIT-01, LIT-04 (lexer side)
**Design:** 2.1

### What to do
1. `lexer.ts`: enter `readHexOrOctal` only when `&` is followed by `h`/`o` and a digit valid for the base; read octal with `0-7`; accept suffix `%`, `&`, `^`. Otherwise emit `Concat`.

### Tests (`packages/vba/tests/lexer.test.ts`)
- Every LIT row source tokenizes to one literal token with the full text (`&HFFFF&`, `&hff`, `&O177777`, `&HFF%`).
- `&O19` gives literal `&O1` then the integer `9`; `&HG` gives `Concat` then identifier.
- `"a"&"b"`, `n & ""`, `"a" & H1`, `"a" & h` tokenize with `Concat`.
- The 10 000-run no-crash property still passes.

---

## PTASK-02: Parser gives literals their value and type

**Status:** Done
**Requires:** LIT-01, LIT-02, LIT-03, LIT-04
**Depends on:** PTASK-01
**Design:** 2.2, 2.3

### What to do
1. `parser.ts`: add the radix-literal decoding in `parsePrimary` as designed.

### Tests (`packages/vba/tests/literals.test.ts`)
- All 14 rows of the LIT table: `Literal.value` and `typeName`, and `TypeName(x)`/value through `runMacro`.
- `&H100000000` and `&O77777777777777` are `ParseError` with module and line; `&H10000%` is a `ParseError`; `&H1^` is `UnsupportedError` with construct `LongLong literal`.
- LIT-04: `x = "a" & h`, `x = "a"&"b"`, `x = n & ""`, `x = "a" & H1` (variables `h`, `n`, `H1`) give `"a"+h`, `"ab"`, `n` as text, `"a"+H1`.

---

## PTASK-03: Unary sign after a call name

**Status:** Done
**Requires:** CALL-01, CALL-02
**Design:** 3

### What to do
1. `parser.ts` `parseAssignOrCall`: apply the whitespace rule from section 3.

### Tests
- `calls.test.ts` (parser part): `Foo -1, 2`, `obj.Method -1, 2`, `d.Add -1, "minus one"` give a `CallStatement` with the expected args (a `UnaryExpr` first); `x = y -1`, `Foo - 1` and `x = Foo -1` stay binary.
- `calls.test.ts` (run part): two-line module `Sub S(n)` / `Sub T()` calling `S -1` receives -1; `d.Add -1, "m"` then `d.Exists(-1)` is True and `d.Item(-1)` is `"m"`.

---

## PTASK-04: `endLine` on `ProcedureDecl`

**Status:** Done
**Requires:** END-01
**Design:** 4

### What to do
1. `ast.ts`: add `endLine` to `SubDecl` and `FunctionDecl`. `parser.ts`: record it in `parseBody`. Fix every place that builds these nodes.

### Tests (`packages/vba/tests/parser.test.ts`)
- Sub and Function: `endLine` is the line of `End Sub`/`End Function`, with blank lines, comments and a multi-line `If` in the body; two procedures in one module.
- Missing `End Sub`: `endLine` is the last line seen.
- `End Property`: no `Property` procedures exist in the AST, so nothing to test. Noted as deferred in the final report.

---

## PTASK-05: Spans and prediction use `endLine`

**Status:** Done
**Requires:** END-02
**Depends on:** PTASK-04
**Design:** 4

### What to do
1. `app/src/model/macros.ts` `procedureSpans` uses `proc.endLine`; update `predict.ts` and other callers.

### Tests (`app/tests/model`)
- `procedureSpans` for two procedures with a comment and a `Dim` between them: the first span ends at its `End Sub`.
- Prediction: an unsupported construct on a module-level line between two procedures is not attributed to the first procedure through the span (it follows the declaration-level rule).
- The existing `procedureSpans` graveyard test expected the old guess (first span ending on blank line 19, second on the last line). It now expects 5 to 18 and 20 to 24, the `End Sub` lines. This test is not an oracle table; it encoded the behaviour END-02 replaces.
- All other prediction and exhume tests unchanged.

---

## PTASK-06: BACKLOG

**Status:** Done
**Requires:** Acceptance (BACKLOG)

### What to do
Strike items 7 and 9 and the `&H` part of item 6 in `BACKLOG.md`, in the style of the other done items.

---

## PTASK-07: `^` after a decimal literal is the exponent operator

**Status:** Done
**Requires:** POW-01
**Design:** 7

### What to do
1. `lexer.ts` `readNumber`: stop accepting `^` as a type suffix on decimal literals (`%` and `&` stay).
2. `parser.ts`: make `^` left-associative (`2^3^2` = 64); the right operand is an optional sign then a postfix expression, so `10^-1` still parses.

### Tests (`packages/vba/tests/literals.test.ts`)
- `2^3` tokenizes as `2`, `^`, `3`.
- `2^3` = 8, `2 ^ 3` = 8, `2^3^2` = 64, `10^-1` = 0.1, `x^2` with x = 3 gives 9.
- `-2^2` is not tested here. The hex `&H1^` LongLong report is unchanged.
