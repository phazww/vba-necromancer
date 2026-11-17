# Tasks — vba-resurrection-core

Tasks are ordered so each builds on the previous. Each task references the requirements it satisfies, lists the files to create/modify, and specifies the tests that must pass before the task is considered done.

---

## TASK-01 — Repository scaffolding and tooling ✅

**Status:** Done  
**Requires:** REQ-13  
**Blocks:** all subsequent tasks

### What to do
1. Initialise an npm workspace at repo root with `"workspaces"` in `package.json` listing `packages/*` and `app`.
2. Create `packages/ovba/`, `packages/vba/`, `packages/workbook/`, `app/` as separate packages, each with `package.json` (`name`, `version`, `type: "module"`).
3. Add root-level `package.json` with `"workspaces"` and dev-dependency scripts: `"test": "vitest run --reporter=verbose"`, `"build": "npm run build --workspaces --if-present"`, `"lint": "eslint . --ext .ts"`.
4. Add a root `tsconfig.base.json` with `"strict": true`, `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"noImplicitAny": true`. Each package has its own `tsconfig.json` extending the base.
5. Add Vitest config at root (`vitest.config.ts`) with `include: ["packages/*/src/**/*.test.ts", "packages/*/tests/**/*.ts"]`.
6. Add ESLint config (`eslint.config.js`) with `eslint:recommended` and `@typescript-eslint/recommended`.
7. Add Prettier config (`.prettierrc`) with defaults.
8. Create `packages/ovba/src/index.ts`, `packages/vba/src/index.ts`, `packages/workbook/src/index.ts` as empty barrel files.
9. Add a placeholder Vite app at `app/` with `vite.config.ts`, `index.html`, and `src/main.ts`.

### Tests
- `npm install` exits 0.
- `npm test` exits 0 (no test files yet — Vitest should report "no tests found" with exit 0, or use `passWithNoTests: true`).
- `tsc --noEmit` exits 0 across all packages.

---

## TASK-02 — CFB/OLE2 parser (`packages/ovba`)

**Status:** Done  
**Requires:** REQ-01  
**Depends on:** TASK-01

### What to do
1. Create `packages/ovba/src/errors.ts` — export `CFBFormatError`, `OVBADecompressError`, `NoVBAProjectError`.
2. Create `packages/ovba/src/cfb.ts` — implement `parseCFB(bytes: Uint8Array): CFBFile`:
   - Validate the 8-byte magic `D0 CF 11 E0 A1 B1 1A E1`; throw `CFBFormatError` on mismatch.
   - Read sector size from offset 30 (`1 << sectorSizePow2`; standard values 512 and 4096).
   - Build the FAT sector chain from the DIFAT array in the header.
   - Walk the directory sector chain; for each entry with `objectType = 2` (stream) collect its path and byte content by following its FAT chain (or MiniFAT for streams < 4096 bytes).
   - Return `{ streams: Map<string, Uint8Array> }` where keys are slash-separated paths from root (e.g., `"VBA/dir"`, `"VBA/Module1"`).
3. Update `packages/ovba/src/index.ts` to export `parseCFB`, `CFBFile`, `CFBFormatError`.

### Tests  (`packages/ovba/tests/cfb.test.ts`)
- Given the bytes of `fixtures/build/simple.xlsm` (generated in TASK-09), `parseCFB` returns a `CFBFile` whose `streams` map contains keys `"VBA/dir"` and `"VBA/Module1"`.
- Given a 4096-sector CFB (synthesise a minimal valid one in the test), `parseCFB` succeeds.
- Given bytes `[0, 1, 2, 3, 4, 5, 6, 7]` (wrong magic), `parseCFB` throws `CFBFormatError`.
- Given a CFB with a stream split across 3 FAT sectors, all bytes are reassembled in order (unit test with a hand-crafted minimal CFB).

---

## TASK-03 — MS-OVBA decompressor (`packages/ovba`)

**Status:** Done  
**Requires:** REQ-02  
**Depends on:** TASK-01

### What to do
1. Create `packages/ovba/src/decompress.ts` — implement `decompress(input: Uint8Array): Uint8Array`:
   - Verify the SignatureByte `0x01`; throw `OVBADecompressError` if absent.
   - Outer loop: read 2-byte CompressedChunkHeader (little-endian). If `IsCompressed` bit (bit 15) is 0, copy the next 4096 bytes verbatim to the output buffer. If 1, decode the compressed chunk.
   - Inner loop for compressed chunks: read a FlagByte; for each of the 8 bits, low-to-high: if 0, copy one literal byte; if 1, read a 2-byte CopyToken, decode length/offset using the decompressed-so-far buffer size (the window-size formula from MS-OVBA §2.4.1.3.6), copy from the sliding window.
   - Stop when input is exhausted.
   - Throw `OVBADecompressError` with `byteOffset` if the input ends mid-chunk or a copy token references beyond the window.
2. Create a minimal reference compressor in `packages/ovba/src/compress.ts` (used only in tests) that produces valid MS-OVBA compressed output for round-trip tests.
3. Export `decompress` from `packages/ovba/src/index.ts`.

### Tests (`packages/ovba/tests/decompress.test.ts`)
- **Property (fast-check):** `fc.property(fc.uint8Array({ minLength: 0, maxLength: 65536 }), bytes => arrayEquals(decompress(compress(bytes)), bytes))` — 10 000 runs.
- Given the known compressed bytes of the `dir` stream from `fixtures/build/simple.xlsm`, `decompress` returns the hand-verified source bytes exactly.
- Given `new Uint8Array([0x02, ...])` (wrong signature), `OVBADecompressError` is thrown.
- Given a truncated chunk (header present, body cut short), `OVBADecompressError` is thrown with a numeric `byteOffset`.

---

## TASK-04 — `dir` stream parser and module extraction (`packages/ovba`)

**Status:** Done  
**Requires:** REQ-03  
**Depends on:** TASK-02, TASK-03

### What to do
1. Create `packages/ovba/src/dir.ts` — implement `parseDirStream(decompressed: Uint8Array): DirStream`:
   - Sequential record loop: read `id: WORD`, `size: DWORD`, then `size` bytes of data.
   - Extract PROJECTSYSKIND (id=0x0001), PROJECTCODEPAGE (id=0x0003), PROJECTNAME (id=0x0004).
   - On PROJECTMODULES (id=0x000F), read the module count WORD, then loop over MODULE records extracting MODULENAME (0x0019), MODULESTREAM (0x001A), MODULEOFFSET (0x0031), MODULETYPE procedural (0x0021) / class (0x0022).
   - Return `DirStream` as defined in design.md.
2. Create `packages/ovba/src/extract.ts` — implement `extractModules(xlsmBytes: Uint8Array): VBAModule[]`:
   - Call `parseCFB`, locate `"VBA/dir"` stream, decompress it, call `parseDirStream`.
   - For each `DirModule`, locate `"VBA/<streamName>"` in the CFB, decompress it, slice from `textOffset`, decode with `TextDecoder` using code-page mapping (Windows-1252 → `"windows-1252"`, else fall back to `"utf-8"`).
   - Throw `NoVBAProjectError` if `"VBA/dir"` stream is absent.
3. Update barrel exports.

### Tests (`packages/ovba/tests/extract.test.ts`)
- `extractModules` on `fixtures/build/simple.xlsm` returns an array where the first element's `source` matches `fixtures/src/simple/Module1.bas` (read with `fs.readFileSync`).
- `extractModules` on `fixtures/build/simple.xlsm` returns `name === "Module1"` and `type === "procedural"`.
- Calling `extractModules` on a plain `.xlsx` with no VBA project throws `NoVBAProjectError`.

---

## TASK-05 — VBA lexer (`packages/vba`)

**Requires:** REQ-04  
**Depends on:** TASK-01

### What to do
1. Create `packages/vba/src/ast.ts` — empty placeholder (filled in TASK-06); export `Token`, `TokenType`.
2. Create `packages/vba/src/lexer.ts` — implement `tokenize(source: string, moduleName?: string): Token[]`:
   - Single-pass, character-by-character, tracking `line` and `col`.
   - Handle line continuation `_` at end-of-line: consume the newline and continue on the next line without emitting a `Newline` token.
   - Keyword matching: after scanning an identifier, check a `Map<string, TokenType>` (all entries lowercased); if found, emit keyword token; otherwise emit `Identifier`.
   - Type-declaration characters `%`, `&`, `!`, `#`, `@`, `$` immediately following an identifier (no space) are appended to the identifier value.
   - Date literals: `#<date string>#` → `DateLiteral`.
   - String literals: `"` ... `""` (escaped quote) ... `"`.
   - Comments: `'` to end-of-line; `Rem` after whitespace at statement start to end-of-line.
   - Unrecognised characters → `TokenType.Unknown`.
   - Never throw.
3. Export `tokenize`, `Token`, `TokenType` from `packages/vba/src/index.ts`.

### Tests (`packages/vba/tests/lexer.test.ts`)
- **Property (fast-check):** `fc.property(fc.string({ maxLength: 4096 }), s => { tokenize(s); return true; })` — 10 000 runs (must not throw).
- `tokenize("Dim x As Integer")` → tokens with types `[Dim, Identifier, As, TInteger]`, values `["Dim", "x", "As", "Integer"]`.
- `tokenize("' this is a comment\nSub Foo()")` → first token `type = Comment`, then `Newline`, then `Sub` at `line = 2`.
- `tokenize("x%")` → one `Identifier` token with `value = "x%"`.
- `tokenize("#2024-01-01#")` → one `DateLiteral` token.
- `tokenize("Dim _\n  x As Long")` → no `Continuation` token; `x` and `Long` appear in the same logical line sequence.

---

## TASK-06 — VBA parser (`packages/vba`)

**Requires:** REQ-05  
**Depends on:** TASK-05

### What to do
1. Flesh out `packages/vba/src/ast.ts` with all AST node types from design.md §3.3. Use discriminated unions with a `kind` field on each node.
2. Create `packages/vba/src/parser.ts` — implement `parse(tokens: Token[], moduleName: string): ModuleAST`:
   - Recursive-descent; each grammar rule is one function.
   - `parseModule` → reads options, then top-level declarations and procedure declarations.
   - `parseProcedure` → `Sub`/`Function`, parameter list, body until matching `End Sub`/`End Function`.
   - `parseStatement` dispatches on the current token.
   - `parseExpression` → standard precedence climbing: or → and → not → comparison → concat → add/sub → mul/div/mod → unary minus → power → postfix (member access, index).
   - On unrecognised statement-starting tokens, emit an `UnsupportedStatement` node with `construct: token.value` and advance past the line.
   - Throw `ParseError` on structural failures (e.g. `End Sub` without `Sub`).
3. Export `parse`, `ModuleAST` and all AST node types from `packages/vba/src/index.ts`.

### Tests (`packages/vba/tests/parser.test.ts`)
- `parse(tokenize("Sub Foo()\nEnd Sub"), "M")` → `ModuleAST` with one `SubDecl`, `name = "Foo"`, empty body, no `ParseError`.
- `parse(tokenize("Function Add(a As Long, b As Long) As Long\n  Add = a + b\nEnd Function"), "M")` → `FunctionDecl` with two params and one `AssignStatement` in body.
- `parse(tokenize("If x > 0 Then\n  y = 1\nEnd If"), "M")` → `IfStatement` node with one branch.
- `parse(tokenize("For i = 1 To 10\nNext i"), "M")` → `ForStatement`.
- `parse(tokenize("Select Case x\n  Case 1\n    y = 1\n  Case Else\n    y = 0\nEnd Select"), "M")` → `SelectStatement` with two arms.
- `parse(tokenize("Declare Function … "), "M")` → `UnsupportedStatement` with `construct = "Declare"`, no throw.
- Parsing each `fixtures/src/**/*.bas` file does not throw.

---

## TASK-07 — Interpreter — numeric semantics and coercion (`packages/vba`)

**Requires:** REQ-07  
**Depends on:** TASK-05

### What to do
1. Create `packages/vba/src/coerce.ts`:
   - `roundHalfEven(x: number): number` — banker's rounding to integer.
   - `roundHalfEvenTo(x: number, digits: number): number` — banker's rounding to `digits` decimal places.
   - `toInteger(x: number): number` — round + overflow check to [−32768, 32767]; throw `RuntimeError(6)` on overflow.
   - `toLong(x: number): number` — round + overflow check to [−2147483648, 2147483647]; throw `RuntimeError(6)`.
   - `intDiv(a: number, b: number): number` — round both with `roundHalfEven`, then `Math.trunc(a / b)`.
   - `vbaMod(a: number, b: number): number` — round both with `roundHalfEven`, then `a - b * Math.trunc(a / b)`.
   - `dateSerial(year, month, day): number` — Excel serial date (days since 1899-12-30).
2. Create `packages/vba/src/errors.ts` — `UnsupportedError`, `ParseError`, `RuntimeError`.
3. Export coerce helpers and errors.

### Tests (`packages/vba/tests/coerce.test.ts`)
- `roundHalfEven(0.5)` → `0`; `roundHalfEven(1.5)` → `2`; `roundHalfEven(2.5)` → `2`; `roundHalfEven(3.5)` → `4`.
- `toInteger(2.5)` → `2`; `toInteger(3.5)` → `4`.
- `toInteger(32767)` → `32767`; `toInteger(32768)` throws `RuntimeError(6)`.
- `toInteger(-32768)` → `-32768`; `toInteger(-32769)` throws `RuntimeError(6)`.
- `intDiv(7, 2)` → `3`; `intDiv(-7, 2)` → `-3`.
- `vbaMod(7, 2)` → `1`; `vbaMod(-7, 2)` → `-1`.
- `dateSerial(1900, 1, 1)` → `1`; `dateSerial(2000, 1, 1)` → `36526`.
- **Property (fast-check):** for `n` in `fc.integer({ min: -32768, max: 32767 })`, `toInteger(n)` does not throw.
- **Property (fast-check):** for `n` outside that range (using `fc.integer().filter`), `toInteger(n)` throws `RuntimeError`.

---

## TASK-08 — Interpreter — core execution engine (`packages/vba`)

**Requires:** REQ-06, REQ-09  
**Depends on:** TASK-06, TASK-07

### What to do
1. Create `packages/vba/src/scope.ts` — `CallFrame` and scope-chain lookup as defined in design.md §3.4.
2. Create `packages/vba/src/interpreter.ts` — `Interpreter` class:
   - Constructor takes `ModuleAST[]` and a `WorkbookHandle`.
   - `run(macroName: string, options: RunOptions): RunResult` — locates the named `SubDecl`, creates a root `CallFrame`, executes its body.
   - `executeStatement(stmt, frame)` — dispatches on `stmt.kind`.
   - `evaluateExpression(expr, frame): VBAValue`.
   - Implement all statement kinds from REQ-05 and REQ-06.
   - `With` statement: push evaluated object onto `frame.withStack`; resolve `.Prop` as `withTarget.Prop`.
   - `On Error Resume Next`: set `frame.onErrorMode = "resume_next"`.
   - `ReDim Preserve`: locate variable in scope, validate that only the last dimension changes, copy elements.
   - Unsupported AST node (`UnsupportedStatement`) → throw `UnsupportedError`.
   - Infinite-loop guard: increment iteration counter on each loop iteration; throw `RuntimeError(0, "max iterations exceeded")` when `options.maxIterations` is reached.
3. Create `packages/vba/src/builtins/math.ts`, `string.ts`, `conversion.ts`, `datetime.ts`, `info.ts`, `array.ts`, `interaction.ts`.
4. Wire `runMacro` as a convenience function in `packages/vba/src/index.ts`.

### Tests (`packages/vba/tests/interpreter.test.ts`)
- `For i = 1 To 5 / Next i` with a counter variable increments correctly and exits after 5 iterations.
- `For i = 1 To 10 / If i = 3 Then Exit For / Next i` → `i` ends at `3` after the loop.
- `Do While x < 3 / x = x + 1 / Loop` → `x = 3` after the loop.
- `Select Case 2 / Case 1: … / Case 2: y = 99 / End Select` → `y = 99`.
- `ReDim arr(2) / arr(1) = "a" / ReDim Preserve arr(4)` → `arr(1)` still `"a"`, `arr(4)` is `Empty`.
- With `Option Base 1`, `Dim arr(3)` and accessing `arr(0)` throws `RuntimeError(9)`.
- `UnsupportedStatement` node throws `UnsupportedError` with correct `module` and `line`.
- Under `On Error Resume Next`, `UnsupportedError` does not propagate; execution continues to next statement.
- **String built-ins (fast-check):** for any ASCII string `s`, `Len(s) === s.length`; `Len(Left(s, Len(s))) === Len(s)`.

---

## TASK-09 — Fixture infrastructure

**Requires:** REQ-03, REQ-13 (fixtures)  
**Depends on:** TASK-04

### What to do
1. Create `fixtures/src/simple/` with:
   - `Module1.bas`: a minimal VBA module with one `Sub FillCells()` that writes values to 3 cells using `Cells` and `Range`, and reads one cell.
   - `cells.json`: initial cell values for the fixture workbook (sheet name, row, col, value).
2. Create `fixtures/expected/simple.json`: expected cell state after `FillCells()` runs.
3. Create `fixtures/build/build.ts`: a Node.js script (run with `tsx` or `ts-node`) that reads each `fixtures/src/<name>/` directory, creates an `.xlsm` using SheetJS (embedding the VBA project binary), and writes it to `fixtures/build/<name>.xlsm`.
4. Run the build script to produce `fixtures/build/simple.xlsm`.
5. Add `"fixtures:build": "tsx fixtures/build/build.ts"` to root `package.json` scripts.

### Tests (integration, `packages/ovba/tests/extract.test.ts`)
- `extractModules(readFileSync("fixtures/build/simple.xlsm"))` returns a module whose `source` matches `fixtures/src/simple/Module1.bas` after normalising line endings.

---

## TASK-10 — Workbook interface and SheetJS adapter (`packages/workbook`)

**Requires:** REQ-10  
**Depends on:** TASK-01

### What to do
1. Create `packages/workbook/src/types.ts` — export `VBAValue`, `SheetInfo`, `XlDirection`, `WorkbookHandle`, `SheetHandle`, `RangeHandle` interfaces from design.md §4.1.
2. Create `packages/workbook/src/range.ts` — implement `parseRef(ref: string)` and `RangeHandle` (pure in-memory; delegates cell access to its `SheetHandle`).
3. Create `packages/workbook/src/adapter.ts` — implement `SheetJSWorkbook` and `SheetJSSheet` classes:
   - `openWorkbook(bytes: Uint8Array): WorkbookHandle` reads via `XLSX.read(bytes, { type: "array", cellFormula: true, cellNF: true })`.
   - `getCellValue` reads from the SheetJS cell object, coerces to `VBAValue` (number for `n`, string for `s`, boolean for `b`, Date → Excel serial number for `d`, null for empty).
   - `setCellValue` writes back to the SheetJS sheet using `XLSX.utils.encode_cell`.
   - `save()` calls `XLSX.write(wb, { type: "array", bookType: "xlsx" })` and returns the bytes.
   - `usedRowCount()` / `usedColCount()` derived from `sheet["!ref"]`.
   - `getRange(ref)` parses the ref and returns a `RangeHandle` backed by this sheet.
   - `SheetHandle.end(direction)` implements `xlUp`/`xlDown`/`xlLeft`/`xlRight` by scanning for the last non-empty cell in that direction.
4. Export `openWorkbook` from `packages/workbook/src/index.ts`.

### Tests (`packages/workbook/tests/adapter.test.ts`)
- `getCellValue(sheet, 1, 1)` on the fixture workbook returns the value from `fixtures/src/simple/cells.json` for A1.
- `setCellValue(sheet, 2, 3, 42)` followed by `getCellValue(sheet, 2, 3)` returns `42`.
- `getRange(sheet, "A1:B2").getValue()` returns a 2-D array `[[v11, v12], [v21, v22]]` matching the fixture cells.
- `save()` output is parseable by `XLSX.read` without throwing.
- `getRange(sheet, "A1")` → `getValue()` returns the scalar value of A1.
- `getRange(sheet, "B3").end("xlUp")` returns the range handle for the last non-empty cell above B3.

---

## TASK-11 — Execution trace (`packages/vba`)

**Requires:** REQ-11  
**Depends on:** TASK-08, TASK-10

### What to do
1. Create `packages/vba/src/trace.ts` — define `TraceEvent`, `SourceRef` as in design.md §5.
2. Create `packages/vba/src/tracing-workbook.ts` — `TracingWorkbook` class that wraps a `WorkbookHandle`, intercepts `getCellValue` / `setCellValue`, appends `"read"` / `"write"` `TraceEvent` objects to a shared `TraceEvent[]` array, then delegates to the underlying workbook.
3. Update `Interpreter` to:
   - Accept a trace array in its options.
   - Use `TracingWorkbook` internally.
   - Append `"unsupported"` `TraceEvent` when catching `UnsupportedError` under `On Error Resume Next`.
4. Update `runMacro` to pass a `TracingWorkbook` and return `trace` in `RunResult`.

### Tests (`packages/vba/tests/trace.test.ts`)
- Running the `simple` fixture macro via `runMacro` returns exactly 3 `"write"` events, each with correct `before`/`after` and matching `statement.line`.
- Running a macro that reads cell A1 before writing it produces a `"read"` event before the `"write"` event.
- An `UnsupportedStatement` under `On Error Resume Next` appends a `"unsupported"` event with correct `module`, `line`, and `construct`.
- A macro that accesses no cells returns `trace = []`.
- Each `"write"` event's `before` matches the cell value before the write and `after` matches the value after.

---

## TASK-12 — `UnsupportedError` for excluded constructs (`packages/vba`)

**Requires:** REQ-12  
**Depends on:** TASK-08

### What to do
1. Add handling in `interpreter.ts` for all constructs listed in REQ-12.2:
   - `Declare` statements → `UnsupportedStatement` node already emitted by parser; interpreter throws `UnsupportedError(module, line, "Declare")`.
   - `CreateObject(...)` calls → detect in `evaluateCallExpr`; throw `UnsupportedError(..., "CreateObject")`.
   - `New <Identifier>` expressions where the identifier is not a locally defined class → throw `UnsupportedError(..., "New <ClassName>")`.
   - File-system built-in names (`Open`, `Close`, `Print`, `Input`, `Kill`, `Dir`) → `UnsupportedError`.
   - `DoEvents`, `Shell`, `SendKeys` → `UnsupportedError`.
2. Add `status` computation to `runMacro`:
   - If `UnsupportedError` propagated (not caught by `On Error Resume Next`), `status = "failed"`.
   - If trace contains any `"unsupported"` events, `status = "partly resurrected"`.
   - Otherwise `status = "fully resurrected"`.

### Tests (`packages/vba/tests/unsupported.test.ts`)
- Executing `Declare Function …` → `UnsupportedError` with `construct = "Declare"`.
- Executing `CreateObject("Scripting.FileSystemObject")` → `UnsupportedError` with `construct = "CreateObject"`.
- A module with no unsupported constructs → `status = "fully resurrected"`.
- A module with `Declare` → `status = "failed"` (no `On Error Resume Next`).
- A module with unsupported call under `On Error Resume Next` → `status = "partly resurrected"`.

---

## TASK-13 — End-to-end fixture test

**Requires:** REQ-01 through REQ-12  
**Depends on:** TASK-09, TASK-10, TASK-11, TASK-12

### What to do
1. Create `packages/vba/tests/e2e.test.ts` (or `tests/e2e/simple.test.ts`):
   - Read `fixtures/build/simple.xlsm` with `fs.readFileSync`.
   - Call `extractModules` → parse each module with `tokenize` + `parse` → call `runMacro("FillCells", asts, wb)`.
   - Read `fixtures/expected/simple.json`.
   - Assert that every cell in the expected JSON matches the actual cell value returned by `getCellValue` after the run.
   - Assert `status === "fully resurrected"`.
2. Add a second fixture `fixtures/src/loops/` with a macro that uses `For`/`Do`/`While`, `Select Case`, and `Exit For`. Write corresponding `fixtures/expected/loops.json`. Run the build script to produce `fixtures/build/loops.xlsm`. Add a matching e2e test.

### Tests
- `simple` fixture: all expected cells match, `status = "fully resurrected"`.
- `loops` fixture: all expected cells match, `status = "fully resurrected"`.

---

## TASK-14 — Workbook `Worksheets`/`Sheets` collection and `Rows.Count` / `End(xlUp)` (`packages/vba`)

**Requires:** REQ-10  
**Depends on:** TASK-08, TASK-10

### What to do
1. In `interpreter.ts`, resolve the global names `Worksheets`, `Sheets` to the workbook's sheet collection.
2. Implement member access on sheet collections: `Worksheets(1)`, `Worksheets("Sheet1")` → `SheetHandle`.
3. On `SheetHandle`, implement `.Name` (string), `.Cells(r, c)` (single-cell range), `.Range(ref)`, `.Rows` (collection), `.Columns`.
4. On `RangeHandle`, implement `.Value` (get/set), `.Formula` (get), `.Rows.Count`, `.Columns.Count`, `.End(xlUp)` etc., `.Offset(r, c)`, `.Resize(r, c)`, `.Address`.
5. Constants: `xlUp = -4162`, `xlDown = -4121`, `xlLeft = -4159`, `xlRight = -4161` (register as global constants in interpreter scope).
6. `ActiveSheet` → resolves to `workbook.activeSheet`.

### Tests (`packages/vba/tests/workbook-vba.test.ts`)
- VBA snippet `Worksheets(1).Cells(1,1).Value = 99` sets A1 to 99 on sheet 1.
- `Worksheets("Sheet1").Range("B2:C3").Value` returns 2×2 array.
- `Worksheets(1).Cells(5,1).End(xlUp).Row` returns the row of the last non-empty cell above row 5 in column A.
- `ActiveSheet.Rows.Count` returns the number of rows in the used range (or 1 048 576 as the Excel sheet limit — either is acceptable and testable).

---

## TASK-15 — WorksheetFunction built-ins (`packages/vba`)

**Requires:** REQ-06, REQ-08  
**Depends on:** TASK-08, TASK-10

### What to do
1. Create `packages/vba/src/builtins/worksheet.ts`:
   - `Sum(range)`, `Count(range)`, `CountA(range)`, `Average(range)`, `Max(range)`, `Min(range)`: iterate `RangeHandle.cells()`, read values via `getCellValue`, compute.
   - `SumIf(range, criteria, sumRange)`, `CountIf(range, criteria)`: support numeric equality, string equality, `">n"`, `"<n"`, `">=n"`, `"<=n"` criteria strings.
   - `VLookup(value, tableRange, colIndex, [approxMatch])`: binary search (sorted) or linear search (exact).
   - `Index(array, rowNum, [colNum])`, `Match(lookupValue, lookupArray, [matchType])`.
2. Register all as properties of a `WorksheetFunction` object in interpreter scope.

### Tests (`packages/vba/tests/worksheet-fn.test.ts`)
- `WorksheetFunction.Sum` over a 3-cell range returns the numeric sum.
- `WorksheetFunction.CountIf(range, ">5")` returns the count of cells with value > 5.
- `WorksheetFunction.VLookup(2, tableRange, 2, False)` returns the correct value from column 2.
- `WorksheetFunction.Match(3, lookupArray, 0)` returns the 1-based position of `3` in the array.

---

## TASK-16 — `Option Compare Text`, `Like` operator, and string semantics (`packages/vba`)

**Requires:** REQ-08  
**Depends on:** TASK-08

### What to do
1. In `interpreter.ts`, read `ModuleAST.options.compareMode` (`"binary"` | `"text"`) and store it on the call frame.
2. Implement the `Like` operator in `evaluateExpression`:
   - Convert the pattern's `*`, `?`, `#`, `[charlist]`, `[!charlist]` to a `RegExp`.
   - Apply case folding if `compareMode === "text"`.
3. All string comparison operators (`=`, `<>`, `<`, `>`, `<=`, `>=`) shall consult `compareMode`.

### Tests (`packages/vba/tests/string-compare.test.ts`)
- `"abc" = "ABC"` → `false` (binary).
- Module with `Option Compare Text`: `"abc" = "ABC"` → `true`.
- `"hello" Like "h*o"` → `true`.
- `"hello" Like "h?llo"` → `true`.
- `"hello" Like "h#llo"` → `false` (`#` matches a digit, not a letter).
- `"a3b" Like "a#b"` → `true`.
- `"hello" Like "[hH]ello"` → `true`.
- `"hello" Like "[!abc]ello"` → `true`.

---

## TASK-17 — Final integration, `npm run build`, and smoke test

**Requires:** REQ-13  
**Depends on:** all previous tasks

### What to do
1. Add a minimal app UI in `app/src/main.ts` (Preact) with:
   - A file drop zone that accepts `.xlsm`/`.xls`.
   - Calls `extractModules`, `openWorkbook`, `tokenize+parse`, displays module names.
   - A "Run" button that calls `runMacro` and shows the trace table and graveyard list.
   - A "Download" button that calls `workbook.save()` and triggers a browser download.
2. Verify `npm run build` produces `app/dist/index.html`.
3. Verify `npm test` passes all tests (unit, property, integration).
4. Run `tsc --noEmit` across all packages and fix any type errors.

### Tests / verification
- `npm test` exits 0.
- `npm run build` exits 0 and `app/dist/index.html` exists.
- `tsc --noEmit` exits 0 across all packages.
- Manual smoke test: drop `fixtures/build/simple.xlsm` into the browser UI, click Run, verify expected cell values appear in the trace.
