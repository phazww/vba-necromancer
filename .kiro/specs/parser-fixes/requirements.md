# Spec: Parser fixes (hex and octal literals, unary minus after a call name, procedure end lines)

## Why
Three known gaps from the backlog. `&H` hex literals lex wrongly (BACKLOG item 6), so any macro with a colour constant or a bit mask fails. `obj.Method -1, 2` parses as a subtraction (item 7). Procedures have no end line (item 9), so the UI guesses where a Sub ends.

## Requirements (EARS)

**LIT-01** The lexer shall read hexadecimal literals `&H` followed by hex digits (case-insensitive) and octal literals `&O` followed by octal digits, with an optional type suffix `%` (Integer), `&` (Long) or `^` (LongLong is out of scope: report it as unsupported).

**LIT-02** Without a suffix, a hex or octal literal whose value fits in 16 bits shall be an Integer, read as a 16-bit two's complement number; otherwise, if it fits in 32 bits, a Long read as a 32-bit two's complement number. More than 32 bits is a syntax error with module and line.

**LIT-03** With the `&` suffix the literal shall be a Long (32-bit two's complement); with the `%` suffix an Integer, and a value over 16 bits with `%` is a syntax error.

Hand-written expected values (these are the oracle; do not change them to match the code):

| Source | Type | Value |
|---|---|---|
| `&H10` | Integer | 16 |
| `&HFF` | Integer | 255 |
| `&hff` | Integer | 255 |
| `&H7FFF` | Integer | 32767 |
| `&H8000` | Integer | -32768 |
| `&HFFFF` | Integer | -1 |
| `&HFFFF&` | Long | 65535 |
| `&H10000` | Long | 65536 |
| `&H7FFFFFFF` | Long | 2147483647 |
| `&H80000000` | Long | -2147483648 |
| `&HFFFFFFFF` | Long | -1 |
| `&O17` | Integer | 15 |
| `&O177777` | Integer | -1 |
| `&HFF%` | Integer | 255 |

**LIT-04** `&` as the string concatenation operator shall keep working. Add tests for `x = "a" & h`, `x = "a"&"b"`, `x = n & ""` and `x = "a" & H1` where `h`, `n` and `H1` are variables.

**CALL-01** In a statement that starts with a procedure or method name and has no parentheses around its arguments (`Foo -1, 2`, `obj.Method -1, 2`, `d.Add -1, "minus one"`), a `-` or `+` immediately after whitespace and before an operand shall start the first argument (unary), not a binary operation on the name. `x = y -1` (an assignment) and `Foo - 1` inside an expression keep their binary meaning.

**CALL-02** A statement `Foo -1` where `Foo` is a Sub with one parameter shall call it with -1. Test with a two-line module and with `Scripting.Dictionary`: after `d.Add -1, "m"` the dictionary has key -1 and `d.Exists(-1)` is True.

**END-01** `ProcedureDecl` in the AST shall carry `endLine`: the line of its `End Sub`, `End Function` or `End Property`.

**END-02** `app/src/model/macros.ts` `procedureSpans` and `predict.ts` shall use `endLine` instead of "the line before the next procedure", so that module-level lines between two procedures (comments, declarations) are not attributed to the first one.

## Acceptance
- Lexer and parser unit tests for every row of the LIT table and for LIT-04, CALL-01, CALL-02.
- A small new fixture is not required; add tests at the package level (`packages/vba/tests`).
- `fixtures/expected/*.json` are not edited. All existing tests keep passing. `npm test`, `npm run lint`, `npm run typecheck` and `npm run build -w app` are green after every task.
- Update BACKLOG.md: strike items 7 and 9 and the `&H` part of item 6 when done.

## Addendum (developer, 21 Nov, found by an independent check after PTASK-06)

**POW-01** `^` directly after a decimal number literal shall be the exponent operator: `x = 2^3` gives 8, the same as `2 ^ 3`. Today `2^3` stores 2 and stops with "call on an expression result" (the lexer takes `^` as a LongLong type suffix on a decimal literal). VBA has no `^` suffix on a decimal literal in 32-bit code; treat `^` after a decimal literal as the operator. Tests: `2^3` = 8, `2^3^2` = 64 (VBA's `^` is left-associative), `10^-1` = 0.1, `x^2` with x = 3 gives 9, `-2^2` is not tested here.
