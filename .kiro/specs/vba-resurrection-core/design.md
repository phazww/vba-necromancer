# Design — vba-resurrection-core

## 1. Package map

```
packages/
  ovba/      CFB parser · MS-OVBA decompressor · dir-stream parser · module extractor
  vba/       Lexer · Parser · AST · Interpreter · Runtime built-ins · Errors
  workbook/  Workbook interface · SheetJS adapter · Range/Cells model
app/         Vite + Preact UI  (not in this spec's implementation scope, but wired up at the end)
```

Each package is an ES module compiled with TypeScript strict mode; no package imports from `app/`.

---

## 2. Package `ovba`

### 2.1 Public API

```ts
// Entry point
export function extractModules(xlsmBytes: Uint8Array): VBAModule[];

// Low-level (also exported for tests)
export function parseCFB(bytes: Uint8Array): CFBFile;
export function decompress(input: Uint8Array): Uint8Array;
export function parseDirStream(decompressed: Uint8Array): DirStream;
```

### 2.2 Data types

```ts
export type ModuleType = "procedural" | "class" | "document" | "designer";

export interface VBAModule {
  name: string;         // MODULENAME record value
  type: ModuleType;
  source: string;       // decoded UTF-16 or Windows-1252 source text
}

export interface CFBFile {
  streams: Map<string, Uint8Array>;   // path → raw bytes, e.g. "VBA/dir", "VBA/Module1"
}

export interface DirStream {
  codePage: number;
  projectName: string;
  modules: DirModule[];
}

export interface DirModule {
  name: string;
  streamName: string;
  textOffset: number;
  type: ModuleType;
}
```

### 2.3 Error types

```ts
export class CFBFormatError extends Error { byteOffset: number; }
export class OVBADecompressError extends Error { byteOffset: number; }
export class NoVBAProjectError extends Error {}
```

### 2.4 Internal structure

```
src/
  cfb.ts          parseCFB — header validation, FAT/MINIFAT reconstruction, directory walk
  decompress.ts   decompress — MS-OVBA §2.4.1 state machine
  dir.ts          parseDirStream — record-by-record parser (WORD-prefixed length fields)
  extract.ts      extractModules — orchestrates the three above
  errors.ts       CFBFormatError, OVBADecompressError, NoVBAProjectError
  index.ts        re-exports public API
```

**CFB parser** reads the 512-byte header, validates the magic bytes `D0 CF 11 E0 A1 B1 1A E1`, reads sector size (512 or 4096), builds the FAT chain, then walks the directory entries to collect stream paths and their data.

**Decompressor** implements the two-pass loop: outer loop over CompressedChunks (2-byte header + up to 4096 decompressed bytes), inner loop over FlagByte groups of 8 tokens (literal or CopyToken). CopyToken length/offset fields use the sliding-window formula from MS-OVBA §2.4.1.3.6.

**Dir parser** reads sequential RECORD(id: WORD, size: DWORD, data: bytes) structures from the decompressed dir stream bytes; extracts PROJECTSYSKIND, PROJECTCODEPAGE, PROJECTNAME, then iterates PROJECTMODULES / MODULE records.

---

## 3. Package `vba`

### 3.1 Public API

```ts
export function tokenize(source: string, moduleName: string): Token[];
export function parse(tokens: Token[], moduleName: string): ModuleAST;
export function runMacro(
  macroName: string,
  modules: ModuleAST[],
  workbook: WorkbookHandle,
  options?: RunOptions
): RunResult;
```

```ts
export interface RunOptions {
  maxIterations?: number;   // guard against infinite loops (default 1_000_000)
  trace?: boolean;          // default true
}

export interface RunResult {
  status: "fully resurrected" | "partly resurrected" | "failed";
  trace: TraceEvent[];
  error?: Error;            // set when status === "failed"
}
```

### 3.2 Token types

```ts
export const enum TokenType {
  // Literals
  IntegerLiteral, LongLiteral, DoubleLiteral, StringLiteral, DateLiteral,
  BooleanLiteral,
  // Keywords (one variant per keyword; full list in lexer.ts)
  Sub, Function, End, Dim, Const, If, ElseIf, Else, Select, Case, For, Each,
  Next, Do, Loop, While, Wend, Exit, With, Set, Let, New, Nothing, True, False,
  And, Or, Not, Mod, Is, Like, ByVal, ByRef, As, Option, Base, Explicit,
  Compare, Text, ReDim, Preserve, Public, Private, Static, On, Error, Resume,
  GoTo, Return,
  // Type names
  TInteger, TLong, TDouble, TString, TBoolean, TDate, TVariant, TObject,
  TCurrency, TSingle,
  // Identifiers and operators
  Identifier, Comment,
  Assign,          // =
  NamedAssign,     // :=
  Concat,          // &
  Plus, Minus, Star, Slash, Backslash, Caret,
  Lt, Lte, Gt, Gte, Eq, Neq,
  Dot, Bang,       // . and !
  LParen, RParen, Comma, Colon, Hash,
  Newline, Continuation,  // _ at EOL
  Unknown, EOF
}

export interface Token {
  type: TokenType;
  value: string;    // raw source text of the token
  line: number;     // 1-based
  col: number;      // 1-based
}
```

### 3.3 AST node hierarchy

All nodes carry `{ module: string; line: number }`.

```
ModuleAST
  options: ModuleOptions          // Option Explicit, Option Base, Option Compare
  declarations: Declaration[]     // module-level Dim/Const
  procedures: ProcedureDecl[]     // Sub / Function

ProcedureDecl  (SubDecl | FunctionDecl)
  name: string
  params: Parameter[]
  body: Statement[]

Statement
  = DimStatement | ConstStatement
  | AssignStatement | SetStatement
  | CallStatement
  | IfStatement | SelectStatement
  | ForStatement | ForEachStatement
  | DoStatement | WhileStatement
  | WithStatement
  | ExitStatement
  | ReDimStatement
  | OnErrorStatement
  | UnsupportedStatement          // parses but cannot interpret

Expression
  = Literal | Identifier | BinaryExpr | UnaryExpr
  | MemberExpr | IndexExpr | CallExpr | NothingExpr
```

### 3.4 Interpreter data model

```ts
// Runtime value
export type VBAValue =
  | number      // Double, Long, Integer, Date (all stored as JS number)
  | string
  | boolean
  | null        // Empty / Nothing
  | VBAValue[][]  // 2-D array (1-based)

// Variable slot
interface VarSlot {
  declaredType: VBAType;
  value: VBAValue;
}

// Call frame
interface CallFrame {
  procedure: ProcedureDecl;
  locals: Map<string, VarSlot>;
  withStack: VBAValue[];        // pushed by With, popped by End With
  onErrorMode: "propagate" | "resume_next";
}
```

**Scope resolution order:** local frame → enclosing With targets → module-level variables → built-in names.

### 3.5 Built-in functions (runtime library)

Implemented in `src/builtins/`:

| Group | Functions |
|---|---|
| Math | `Abs`, `Int`, `Fix`, `Sgn`, `Sqr`, `Exp`, `Log`, `Sin`, `Cos`, `Tan`, `Atn`, `Round`, `Rnd`, `Randomize` |
| String | `Len`, `Left`, `Right`, `Mid`, `InStr`, `InStrRev`, `UCase`, `LCase`, `Trim`, `LTrim`, `RTrim`, `Replace`, `Split`, `Join`, `String`, `Space`, `Chr`, `Asc`, `StrConv`, `Val`, `Str`, `Format` |
| Conversion | `CInt`, `CLng`, `CDbl`, `CStr`, `CBool`, `CDate`, `CSng`, `CCur` |
| Date/Time | `Now`, `Date`, `Time`, `DateSerial`, `DateValue`, `TimeSerial`, `TimeValue`, `Year`, `Month`, `Day`, `Hour`, `Minute`, `Second`, `DateAdd`, `DateDiff`, `DatePart`, `WeekDay` |
| Info | `IsEmpty`, `IsNull`, `IsNumeric`, `IsDate`, `IsArray`, `IsObject`, `IsError`, `TypeName`, `VarType` |
| Array | `Array`, `LBound`, `UBound` |
| Interaction | `MsgBox`, `InputBox` (browser `alert`/`prompt` wrappers) |
| WorksheetFunction | `Sum`, `Count`, `CountA`, `Average`, `Max`, `Min`, `SumIf`, `CountIf`, `VLookup`, `Index`, `Match` (delegates to workbook range reads) |

### 3.6 Numeric coercion rules

```
Integer  → stored as JS number, overflow check on write: [-32768, 32767]
Long     → stored as JS number, overflow check on write: [-2147483648, 2147483647]
Double   → JS number (IEEE 754)
Currency → stored as JS BigInt * 10000 (exact decimal), or JS number scaled; TBD at implementation
Date     → JS number (days since 1899-12-30)
```

The `\` and `Mod` operators: round each operand with `roundHalfEven`, then apply integer division / modulo.

### 3.7 Error types

```ts
export class UnsupportedError extends Error {
  module: string;
  line: number;
  construct: string;
}
export class ParseError extends Error {
  module: string; line: number; col: number;
}
export class RuntimeError extends Error {
  code: number;   // VBA error number, e.g. 6 = Overflow, 9 = Subscript out of range
  module: string; line: number;
}
```

### 3.8 Internal structure

```
src/
  lexer.ts
  parser.ts
  ast.ts           TypeScript types for all AST nodes
  interpreter.ts   Interpreter class, executes statements
  scope.ts         CallFrame, ScopeChain
  coerce.ts        VBA coercion and overflow helpers
  builtins/
    math.ts
    string.ts
    conversion.ts
    datetime.ts
    info.ts
    array.ts
    interaction.ts
    worksheet.ts   WorksheetFunction delegates
  errors.ts
  index.ts
```

---

## 4. Package `workbook`

### 4.1 Public API

```ts
export interface WorkbookHandle {
  sheets: SheetInfo[];
  activeSheet: SheetHandle;
  getSheet(nameOrIndex: string | number): SheetHandle;
  save(): Uint8Array;
}

export interface SheetHandle {
  name: string;
  index: number;                                  // 1-based
  getCellValue(row: number, col: number): VBAValue;
  setCellValue(row: number, col: number, value: VBAValue): void;
  getCellFormula(row: number, col: number): string | null;
  getRange(ref: string): RangeHandle;
  usedRowCount(): number;
  usedColCount(): number;
}

export interface RangeHandle {
  sheet: SheetHandle;
  topRow: number; leftCol: number;
  bottomRow: number; rightCol: number;
  getValue(): VBAValue;             // scalar if 1×1, 2-D array otherwise
  setValue(v: VBAValue): void;      // broadcasts scalar, sets per-cell for 2-D
  rows(): RangeHandle[];            // iterate rows
  columns(): RangeHandle[];
  cells(): Array<{ row: number; col: number; sheet: SheetHandle }>;
  end(direction: XlDirection): RangeHandle;  // xlUp/xlDown/xlLeft/xlRight
}

export interface SheetInfo { name: string; index: number; }

export type XlDirection = "xlUp" | "xlDown" | "xlLeft" | "xlRight";
```

`VBAValue` is re-exported from `packages/vba` (via a shared `types` package, or directly — TBD at implementation; keep the import direction vba → workbook unidirectional, with workbook importing the type only).

### 4.2 SheetJS adapter

`src/adapter.ts` is the only file that imports `xlsx` from SheetJS. It implements `WorkbookHandle` and `SheetHandle` on top of SheetJS's `WorkBook` and `WorkSheet` types. No code outside this file calls SheetJS APIs.

```
src/
  adapter.ts     SheetJS-backed implementation of WorkbookHandle/SheetHandle/RangeHandle
  range.ts       RangeHandle implementation, range reference parser (A1 ↔ row/col)
  types.ts       SheetInfo, XlDirection, re-export of VBAValue
  index.ts       export { openWorkbook } from "./adapter"
```

`openWorkbook(bytes: Uint8Array): WorkbookHandle` is the single entry point consumed by the app and by fixtures.

### 4.3 Range reference parser

`parseRef(ref: string): { topRow, leftCol, bottomRow, rightCol }` handles A1 (`"B3"`), A1:A1 (`"B3:D7"`), and R1C1 notation. Column letters are converted to 1-based numbers with the standard Excel formula.

---

## 5. Trace event model

Defined in `packages/vba/src/trace.ts`, re-exported from both `packages/vba` and consumed by the app.

```ts
export type TraceEvent =
  | { kind: "read";        sheet: string; row: number; col: number; value: VBAValue;         statement: SourceRef }
  | { kind: "write";       sheet: string; row: number; col: number; before: VBAValue; after: VBAValue; statement: SourceRef }
  | { kind: "unsupported"; module: string; line: number; construct: string;                  statement: SourceRef }

export interface SourceRef { module: string; line: number; }
```

The `WorkbookHandle` passed to `runMacro` is wrapped internally in a `TracingWorkbook` decorator that intercepts `getCellValue` and `setCellValue` calls and appends events to the trace array.

---

## 6. Data flow

```
User drops .xlsm
  └─ app reads ArrayBuffer
       └─ ovba.extractModules(bytes)
            ├─ parseCFB → CFBFile
            ├─ decompress("VBA/dir") → parseDirStream → DirStream
            └─ for each DirModule:
                 decompress(stream)[textOffset:] → decode → VBAModule.source

  └─ workbook.openWorkbook(bytes) → WorkbookHandle

  └─ vba.tokenize + vba.parse → ModuleAST[]

User clicks "Run <MacroName>"
  └─ vba.runMacro(macroName, asts, workbook)
       ├─ TracingWorkbook wraps workbook
       ├─ Interpreter walks AST, calls TracingWorkbook for cell I/O
       └─ RunResult { status, trace }

User clicks "Download"
  └─ workbook.save() → Uint8Array → browser download
```

---

## 7. Dependency graph

```
packages/ovba      ──(no deps on other packages)
packages/workbook  ──(imports SheetJS only)
packages/vba       ──(imports from packages/workbook for WorkbookHandle type only)
app                ──(imports all three packages)
```

No circular dependencies. `packages/ovba` and `packages/workbook` are completely independent of each other; `packages/vba` knows the `WorkbookHandle` interface but does not import SheetJS.

---

## 8. Testing strategy

| Layer | Test type | Tool |
|---|---|---|
| CFB parser | Unit — known fixture bytes | Vitest |
| Decompressor | Property — round-trip compress/decompress | fast-check |
| Dir parser | Unit — known fixture dir stream | Vitest |
| Lexer | Property — no crash on arbitrary string | fast-check |
| Lexer | Unit — exact token stream for small inputs | Vitest |
| Parser | Unit — AST shape for well-formed snippets | Vitest |
| Numeric semantics | Unit + property — overflow, banker's rounding | fast-check |
| String built-ins | Property — `Len`/`Left`/`Mid` identity | fast-check |
| Interpreter control flow | Unit — each loop/branch construct | Vitest |
| Workbook adapter | Unit — get/set round-trip | Vitest |
| Range reference parser | Unit — A1, A1:B2, edge columns | Vitest |
| Trace | Unit — events match cell accesses | Vitest |
| End-to-end (fixture) | Integration — run macro, compare expected/ | Vitest |

Fixture workbooks live in `fixtures/src/` as `.bas` + initial-cell `.json`; `fixtures/build/` script synthesises `.xlsm` files.  
Expected outputs live in `fixtures/expected/*.json`.
