# Requirements — vba-resurrection-core

Spec: `vba-resurrection-core`  
Deadline: Fri 4 Dec 2026, 14:00 PST  
Format: EARS (Easy Approach to Requirements Syntax)

---

## REQ-01 — CFB/OLE2 container parsing (`packages/ovba`)

**REQ-01.1** The system shall parse a Compound File Binary (CFB/OLE2) container from an `ArrayBuffer` and expose a directory tree of named streams and storage nodes.

**REQ-01.2** When a CFB file has a `vbaProject.bin` root or is itself the vba project binary, the system shall locate and return the raw bytes of every stream inside the `VBA/` storage directory.

**REQ-01.3** When the CFB sector size is 512 bytes or 4096 bytes, the system shall handle both correctly.

**REQ-01.4** When a stream is split across multiple FAT sectors, the system shall reassemble the full stream bytes in order.

**REQ-01.5** The system shall not make any network calls; all processing shall happen in-memory from the supplied `ArrayBuffer`.

*Acceptance criteria:*
- Given the bytes of a known `.xlsm` file, `parseCFB(bytes)` returns an object with a property `streams` whose keys include `"VBA/dir"` and at least one `"VBA/<ModuleName>"`.
- Given a 4096-sector CFB, the same API works without error.
- Given random bytes that are not a valid CFB signature (`0xD0CF11E0A1B11AE1`), `parseCFB` throws `CFBFormatError`.

---

## REQ-02 — MS-OVBA decompression (`packages/ovba`)

**REQ-02.1** The system shall implement the MS-OVBA compressed container decompression algorithm as specified in MS-OVBA §2.4.1 (CompressedContainer → DecompressedBuffer).

**REQ-02.2** When given a CompressedChunk where the IsCompressed flag is 0, the system shall copy the 4096-byte raw chunk verbatim.

**REQ-02.3** When given a CompressedChunk where the IsCompressed flag is 1, the system shall decode the CopyToken back-references and produce the correct decompressed bytes.

**REQ-02.4** The decompressor shall be a pure function `decompress(input: Uint8Array): Uint8Array` with no side effects.

**REQ-02.5** When input is empty or malformed (truncated chunk), the system shall throw `OVBADecompressError` with a byte-offset indicating where parsing failed.

*Acceptance criteria:*
- Round-trip property: for any sequence of printable ASCII bytes up to 65 536 bytes in length, `decompress(compress(bytes))` equals `bytes` (fast-check property test, 10 000 runs).
- `decompress` of a known fixture stream matches the hand-verified source bytes exactly.
- Given a truncated chunk, `OVBADecompressError` is thrown.

---

## REQ-03 — `dir` stream parsing and module extraction (`packages/ovba`)

**REQ-03.1** The system shall parse the PROJECTSYSKIND, PROJECTCODEPAGE, PROJECTNAME, PROJECTMODULES and each MODULE record from the decompressed `dir` stream.

**REQ-03.2** For each module, the system shall extract: `name` (MODULENAME), `streamName` (MODULESTREAM), `textOffset` (MODULEOFFSET), and `type` (procedural/class/document/designer).

**REQ-03.3** The system shall decompress each module stream, skip the first `textOffset` bytes, and return the remaining bytes decoded as the project's code page (default Windows-1252 when PROJECTCODEPAGE is 1252).

**REQ-03.4** The system shall expose a single entry-point `extractModules(xlsmBytes: Uint8Array): VBAModule[]` where `VBAModule` is `{ name: string; type: ModuleType; source: string }`.

*Acceptance criteria:*
- `extractModules` applied to a generated fixture `.xlsm` returns a `VBAModule` array whose `source` strings match the hand-written `.bas` source files in `fixtures/src/`.
- Module `name` is a non-empty string, `source` starts with `Attribute VB_Name` or begins with the first Sub/Function line.
- If the `vbaProject.bin` stream is absent, `extractModules` throws `NoVBAProjectError`.

---

## REQ-04 — VBA lexer (`packages/vba`)

**REQ-04.1** The lexer shall tokenise the VBA language subset defined in CONCEPT.md: keywords (`Sub`, `Function`, `End`, `Dim`, `Const`, `If`, `ElseIf`, `Else`, `Select`, `Case`, `For`, `Each`, `Next`, `Do`, `Loop`, `While`, `Wend`, `Exit`, `With`, `Set`, `Let`, `New`, `Nothing`, `True`, `False`, `And`, `Or`, `Not`, `Mod`, `Is`, `Like`, `ByVal`, `ByRef`, `As`, `Option`, `Base`, `Explicit`, `Compare`, `Text`, `ReDim`, `Preserve`, `Public`, `Private`, `Static`), identifiers, integer/long/double/currency literals, string literals, date literals, operators, punctuation, comments (`'` and `Rem`), and line-continuation (`_`).

**REQ-04.2** The lexer shall be case-insensitive for keywords.

**REQ-04.3** The lexer shall attach to every token: `type`, `value`, `line`, and `col` (1-based).

**REQ-04.4** The lexer shall handle type-declaration characters (`%`, `&`, `!`, `#`, `@`, `$`) as part of identifiers.

**REQ-04.5** When the lexer encounters any byte sequence, it shall not throw; unrecognised characters shall produce a `TokenType.Unknown` token so the parser can emit `UnsupportedError`.

*Acceptance criteria:*
- Fast-check property: `tokenize(s)` does not throw for any string `s` of up to 4096 chars (10 000 runs).
- Given `"Dim x As Integer"`, the token stream is `[Dim, Identifier("x"), As, Integer]` (keywords and type names normalised to their enum value).
- Given `"' this is a comment\nSub Foo()"`, comment tokens have `type = TokenType.Comment` and the `Sub` token has `line = 2`.
- Type-declaration `x%` produces an `Identifier` token with value `"x%"`.

---

## REQ-05 — VBA parser (`packages/vba`)

**REQ-05.1** The parser shall produce a typed AST for the following constructs: module-level declarations (`Option Explicit`, `Option Base`, `Option Compare`), `Sub` and `Function` declarations with parameter lists (by-value and by-reference), `Dim` and `Const` (local and module-level), assignment (`:=` named and `=` positional), `If`/`ElseIf`/`Else`/`End If`, `Select Case`/`Case`/`Case Else`, `For … Next`, `For Each … Next`, `Do … Loop` (all four variants), `While … Wend`, `With … End With`, `Set`, `Exit Sub`/`Exit Function`/`Exit For`/`Exit Do`, `ReDim`/`ReDim Preserve`, `On Error Resume Next`, `On Error GoTo 0`, call statements, member-access chains (`obj.prop.method(args)`), and index expressions.

**REQ-05.2** When the parser encounters a construct it recognises syntactically but that maps to an unsupported feature at interpretation time, it shall still produce an AST node so the interpreter can throw `UnsupportedError` with line information.

**REQ-05.3** When the parser encounters a syntax error it cannot recover from, it shall throw `ParseError` containing `module`, `line`, `col`, and a human-readable message.

**REQ-05.4** The parser shall be a pure function `parse(tokens: Token[], moduleName: string): ModuleAST`.

*Acceptance criteria:*
- Parsing the source of each `fixtures/src/*.bas` file produces a `ModuleAST` without throwing.
- Round-trip property: for the VBA subset grammar, `parse(tokenize(validSource))` does not throw and the AST's statement count equals the hand-counted number of statements in `validSource`.
- Given `"Sub Foo()\nEnd Sub"`, `parse` returns a `ModuleAST` with one `SubDecl` whose `name` is `"Foo"` and body is empty.

---

## REQ-06 — Tree-walking interpreter — control flow and variables (`packages/vba`)

**REQ-06.1** The interpreter shall execute `Sub` and `Function` calls, resolve module-level and local variable scopes, and return values from `Function`.

**REQ-06.2** The interpreter shall implement `If`/`ElseIf`/`Else`, `Select Case` (literal equality, `Is <relop>`, `a To b` ranges), `For i = start To end [Step n]`, `For Each element In collection`, `Do While`/`Do Until`/`Loop While`/`Loop Until`, and `While … Wend`.

**REQ-06.3** The interpreter shall implement `Exit Sub`, `Exit Function`, `Exit For`, and `Exit Do`.

**REQ-06.4** The interpreter shall implement `With … End With` so that `.Property` references resolve against the `With` target.

**REQ-06.5** The interpreter shall implement `On Error Resume Next` (suppress runtime errors and continue) and `On Error GoTo 0` (re-enable error propagation).

**REQ-06.6** When a statement or construct is not supported by the interpreter, it shall throw `UnsupportedError` containing `module: string`, `line: number`, and `construct: string`; the error shall not be swallowed silently.

**REQ-06.7** Under `On Error Resume Next`, `UnsupportedError` shall be caught and recorded in the execution trace but execution shall continue.

*Acceptance criteria:*
- Executing a `Sub` that uses all loop types and `Select Case` against a fixture produces the expected cell values in `fixtures/expected/`.
- `Exit For` inside a `For` loop halts the loop and continues after `Next`.
- Calling an unknown built-in under `On Error Resume Next` records an `UnsupportedError` entry and does not abort the run.

---

## REQ-07 — VBA numeric semantics (`packages/vba`)

**REQ-07.1** `Integer` variables shall be 16-bit signed; assigning a value outside −32 768 to 32 767 shall raise runtime error 6 (Overflow).

**REQ-07.2** `Long` variables shall be 32-bit signed; overflow shall raise runtime error 6.

**REQ-07.3** `Double` shall follow IEEE 754 double precision.

**REQ-07.4** The `\` operator shall truncate toward zero after rounding each operand using banker's rounding (round half to even) before dividing.

**REQ-07.5** The `Mod` operator shall round each operand with banker's rounding before computing the remainder.

**REQ-07.6** `Round(x, n)` shall use banker's rounding (round half to even) to `n` decimal places.

**REQ-07.7** `CInt(x)` and `CLng(x)` shall round half to even and then apply the respective overflow check.

**REQ-07.8** Date values shall be stored as `Double` (days since 1899-12-30, matching VBA's own epoch). `CDbl(DateSerial(1900,1,1))` = 2; `CDbl(DateSerial(1900,2,28))` = 60; `CDbl(DateSerial(1900,3,1))` = 61. VBA does not insert a fictitious February 29, 1900. For dates on or after 1900-03-01 the VBA double equals the Excel cell serial; for January 1 through February 28, 1900 the VBA double is one greater than the Excel cell serial. The helpers `excelSerialToVbaDate` and `vbaDateToExcelSerial` shall convert between the two representations for that window; `excelSerialToVbaDate(60)` (Excel's fictitious Feb 29) shall return `NaN`.

*Acceptance criteria:*
- `CInt(2.5)` → `2`; `CInt(3.5)` → `4`; `CInt(32768)` → runtime error 6.
- `7 \ 2` → `3`; `7 Mod 2` → `1`; `Round(2.5, 0)` → `2`; `Round(3.5, 0)` → `4`.
- `Round(2.675, 2)` → `2.67`; `Round(32.675, 2)` → `32.67`; `Round(0.125, 2)` → `0.12`; `Round(0.375, 2)` → `0.38`.
- Fast-check: for `n` in −32 768..32 767, assigning `n` to an `Integer` variable does not raise overflow.
- Fast-check: for `n` outside that range, assigning to `Integer` raises error 6.
- `dateSerial(1900,1,1)` = `2`; `dateSerial(1900,2,28)` = `60`; `dateSerial(1900,3,1)` = `61`; `dateSerial(2026,10,31)` = `46326`; `dateSerial(2000,1,1)` = `36526`.

---

## REQ-08 — VBA string and comparison semantics (`packages/vba`)

**REQ-08.1** String comparison with `=`, `<>`, `<`, `>`, `<=`, `>=` shall be binary (byte-by-byte) by default.

**REQ-08.2** When `Option Compare Text` is in effect for the module, string comparison shall be case-insensitive using the Unicode case-folding of the host locale.

**REQ-08.3** The `Like` operator shall support `*` (any sequence), `?` (any single character), `#` (any single digit), and `[charlist]` / `[!charlist]` patterns; case sensitivity shall follow the module's `Option Compare` setting.

**REQ-08.4** The built-in string functions `Len`, `Left`, `Right`, `Mid`, `InStr`, `InStrRev`, `UCase`, `LCase`, `Trim`, `LTrim`, `RTrim`, `Replace`, `Split`, `Join`, `String`, `Space`, `Chr`, `Asc`, `StrConv`, `Val`, `Str` shall produce results identical to Excel VBA for all in-range inputs.

*Acceptance criteria:*
- `"abc" = "ABC"` → `False` (binary compare); with `Option Compare Text`, → `True`.
- `"hello" Like "h*o"` → `True`; `"hello" Like "h?llo"` → `True`; `"hello" Like "h#llo"` → `False`.
- `Len("αβ")` → `2`; `Mid("abcdef", 2, 3)` → `"bcd"`.
- Fast-check: for any string `s` of printable ASCII, `Len(s) = Len(Left(s, Len(s)))`.

---

## REQ-09 — Array semantics (`packages/vba`)

**REQ-09.1** `Dim arr(n)` shall create a 0-based array of `n+1` elements when `Option Base 0` (default); a 1-based array of `n` elements when `Option Base 1`.

**REQ-09.2** `Dim arr(lower To upper)` shall create an array with explicit bounds.

**REQ-09.3** `ReDim` shall reallocate the array; `ReDim Preserve` shall reallocate and copy existing elements, resizing only the last dimension.

**REQ-09.4** Accessing an index outside the declared bounds shall raise runtime error 9 (Subscript out of range).

*Acceptance criteria:*
- With `Option Base 1`, `Dim arr(3)` creates indices 1..3; `arr(0)` raises error 9.
- `ReDim Preserve arr(5)` on a 3-element array keeps the first 3 values; `arr(5)` is `Empty`.
- `ReDim Preserve` on a two-dimensional array resizes only the last dimension.

---

## REQ-10 — Workbook interface (`packages/workbook`)

**REQ-10.1** The `Workbook` interface shall expose: `sheets: WorksheetHandle[]`, `activeSheet: WorksheetHandle`, `getSheet(nameOrIndex: string | number): WorksheetHandle`, `getCellValue(sheet, row, col): VBAValue`, `setCellValue(sheet, row, col, value: VBAValue): void`, `getCellFormula(sheet, row, col): string | null`, `getRange(sheet, ref: string): RangeHandle`, and `save(): Uint8Array` (returns `.xlsx` bytes).

**REQ-10.2** `Cells(row, col)` shall be 1-based for both row and column.

**REQ-10.3** `.Value` on a single cell shall return a `VBAValue` (number, string, boolean, date as Double, `null` for empty).

**REQ-10.4** `.Value` on a multi-cell `RangeHandle` shall return a 2-D 1-based `VBAValue[][]` array (rows × columns).

**REQ-10.5** The adapter shall wrap exactly one third-party library (SheetJS); no other xlsx library shall be imported anywhere in `packages/workbook`.

**REQ-10.6** `save()` shall produce a valid `.xlsx` binary that opens without error in Excel and LibreOffice.

*Acceptance criteria:*
- `getCellValue(sheet, 1, 1)` on a fixture workbook returns the value that was written to A1 in the fixture source JSON.
- `setCellValue` followed by `getCellValue` for the same cell returns the new value.
- `.Value` on `getRange(sheet, "A1:B2")` returns a `[[v11, v12], [v21, v22]]` array (1-indexed).
- `save()` output passes SheetJS's own `read()` without throwing.

---

## REQ-11 — Execution trace (`packages/vba` + `packages/workbook`)

**REQ-11.1** The interpreter shall record a `TraceEvent` for every cell read and every cell write during a macro execution, containing: `kind: "read" | "write"`, `sheet: string`, `row: number`, `col: number`, `before: VBAValue` (write-only), `after: VBAValue`, and `statement: { module: string; line: number }`.

**REQ-11.2** `UnsupportedError` occurrences captured under `On Error Resume Next` shall also be recorded in the trace as `TraceEvent` with `kind: "unsupported"`.

**REQ-11.3** The trace shall be returned as `TraceEvent[]` from the top-level `runMacro` call, alongside the updated workbook.

**REQ-11.4** A macro run with zero cell accesses shall return an empty `TraceEvent[]` array, not an error.

*Acceptance criteria:*
- Running a fixture macro that writes to three cells produces exactly three `"write"` trace events, each with the correct `before` and `after` values.
- Running a macro that reads a cell before writing it produces a `"read"` event before the `"write"` event for that cell.
- An unsupported statement under `On Error Resume Next` produces a `"unsupported"` trace event with `module` and `line` matching the source.

---

## REQ-12 — `UnsupportedError` reporting (`packages/vba`)

**REQ-12.1** `UnsupportedError` shall be a subclass of `Error` with fields `module: string`, `line: number`, and `construct: string`.

**REQ-12.2** The interpreter shall throw `UnsupportedError` for every construct in the exclusion list: `UserForm`, `Declare` (Windows API), COM object creation (`CreateObject`, `New <ComClass>`), file-system functions (`Open`, `Close`, `Print #`, `Input #`, `Kill`, `Dir`), `DoEvents`, `Shell`, `SendKeys`, `Application.Run` calling external workbooks.

**REQ-12.3** When `On Error Resume Next` is not active, `UnsupportedError` shall propagate to the caller of `runMacro`.

**REQ-12.4** A macro is marked `"fully resurrected"` only when its `TraceEvent[]` contains zero `"unsupported"` events and no `UnsupportedError` propagated.

*Acceptance criteria:*
- Attempting to execute `Declare Function …` throws `UnsupportedError` with `construct = "Declare"`.
- Attempting to execute `CreateObject("Scripting.FileSystemObject")` throws `UnsupportedError` with `construct = "CreateObject"`.
- A module that uses no unsupported constructs returns `status: "fully resurrected"` from `runMacro`.
- A module that uses `Declare` returns `status: "partly resurrected"` from `runMacro`.

---

## REQ-13 — Project scaffolding and tooling

**REQ-13.1** The repository shall be an npm workspace with packages `ovba`, `vba`, and `workbook` under `packages/`, and an `app` package at `app/`.

**REQ-13.2** Each package shall have its own `tsconfig.json` with `"strict": true`, `"target": "ES2022"`, and `"noImplicitAny": true`.

**REQ-13.3** Each package shall have a Vitest configuration; `npm test` at root shall run all tests.

**REQ-13.4** ESLint and Prettier shall be configured at root with configs extending `eslint:recommended` and `plugin:@typescript-eslint/recommended`.

**REQ-13.5** The `app` package shall use Vite as a dev server and bundler; `npm run build` at root shall produce a `dist/` directory deployable to any static host.

*Acceptance criteria:*
- `npm install && npm test` exits with code 0 when all tests pass.
- `npm run build` produces `app/dist/index.html` and associated assets.
- TypeScript compilation (`tsc --noEmit`) exits with code 0 across all packages.
