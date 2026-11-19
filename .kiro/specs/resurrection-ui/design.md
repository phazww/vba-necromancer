# Design: resurrection-ui

Implements UI-1 to UI-13 (see `requirements.md`). All new code lives in `app/`, plus root test configuration and one CI workflow. `packages/*` are not changed (see section 9 for the one optional improvement). No network access anywhere in the app.

## 1. Decisions

| Question | Choice | Why |
|---|---|---|
| Framework | Preact 10, `preact/hooks`, JSX (`jsxImportSource: "preact"`) | Steering allows it. Components, keyed lists, small. |
| State | One reducer (`useReducer`) in `app/src/state/`, passed down through one context. Pure `reduce(state, action)`. | State is one workbook, one run, one selection. A reducer is testable without the DOM. Signals add a dependency for no gain at this size. |
| Pure logic vs. UI | Everything that touches `packages/*` lives in `app/src/model/` and has no DOM and no Preact import. Components only render model objects. | The end-to-end test and the performance test call the same model functions as the UI. |
| Where a run executes | Main thread, after yielding one frame. | `runMacro` is synchronous and bounded by `maxIterations` (1 000 000). Measured budget in UI-12 is 2 s. A Worker would need the workbook, modules and trace to cross `postMessage`, which costs more than it gains at this size. Revisit only if the 5 000-row test fails the budget. |
| Grid and lists | Hand-written windowing with fixed row height. No grid library. | Fixed heights make the visible range one division. Control over ARIA. |
| Bundled demo files | `import url from "../../fixtures/build/demo_acts.xlsm?inline"` (base64 data URL), decoded with `atob`. | `fetch` of a static file is a network request and would break UI-1.8 (`connect-src 'none'`). The files are 5 KB and 3 KB. |
| Routing | None. | UI-11.2. |
| Vite base | `base: "./"` | Works under any sub-path without knowing the repository name. |
| Tests | Vitest, `jsdom`, `@testing-library/preact`, `@testing-library/dom`, `axe-core` for structural a11y checks. | Same runner as the packages. |
| Colour scheme | CSS custom properties, `color-scheme: light dark`, values switched by `@media (prefers-color-scheme: dark)`. | UI-9.4, no JS needed. |

New dev dependencies (root `package.json`): `preact` (app dependency), `@preact/preset-vite`, `jsdom`, `@testing-library/preact`, `@testing-library/dom`, `axe-core`. Nothing is added to `packages/*`.

## 2. Files

```
app/
  index.html                      CSP meta, lang="en", title without emoji
  vite.config.ts                  base "./", preact preset, server.fs.allow ["..", "../fixtures"], size report plugin
  tsconfig.json                   adds "jsx": "react-jsx", "jsxImportSource": "preact", "lib": ["ES2022","DOM"], include .ts and .tsx
  vitest.config.ts                environment jsdom, include tests/**
  src/
    main.tsx                      mounts <App/>
    App.tsx
    model/                        no DOM, no Preact
      sniff.ts                    sniffKind(bytes): "zip" | "cfb" | "unknown"
      exhume.ts                   exhume(name, bytes): Exhumed = extractModules + exhumeParts(name, bytes, sources)
      macros.ts                   listMacros(asts): MacroInfo[]; procedure spans
      predict.ts                  predictMacro(...)
      resurrect.ts                resurrect(exhumed, macroId): RunView
      changes.ts                  deriveChanges(trace, initial, result)
      graveyard.ts                buildGraveyard(staticHits, run?)
      format.ts                   formatValue, address(row, col), colLetters re-export
      demo.ts                     DEMOS: { id, title, fileName, bytes() }[]
    state/
      types.ts                    AppState, Action, Selection
      reducer.ts
      context.tsx                 StoreProvider, useStore()
      actions.ts                  loadFile(file | demo), runMacro(macroId), download()  (async thunks over dispatch)
    ui/
      Header.tsx  DropZone.tsx  DemoButtons.tsx  LiveRegion.tsx
      ExhumePanel.tsx  SheetList.tsx  ModuleList.tsx  MacroList.tsx
      ResultBar.tsx
      GridView.tsx  SheetTabs.tsx  Grid.tsx
      SourceView.tsx  ModuleTabs.tsx
      TracePanel.tsx  TraceFilters.tsx  TraceList.tsx
      GraveyardPanel.tsx
      DownloadButton.tsx
      LimitsNote.tsx
      useWindow.ts                windowing hook (visible range from scroll offset)
      useRovingFocus.ts           arrow-key focus for tabs and lists
      Tabs.tsx                    shared ARIA tabs
    styles/
      tokens.css                  colour, spacing, type tokens, light and dark
      base.css  layout.css  components.css
  tests/
    model/*.test.ts
    ui/*.test.tsx
    e2e/demo.test.tsx  e2e/graveyard.test.tsx
    tokens.test.ts  theme-lint.test.ts  build.test.ts  perf.test.ts
```

## 3. Component tree

```
<App>
  <StoreProvider>
    <SkipLink "Skip to workbook">
    <Header>                         tombstone SVG, h1 "VBA Necromancer", tagline
    <LiveRegion role="status">       announcements; separate <AlertRegion role="alert"> for errors
    <main id="workbook">
      phase "empty" | "loading":
        <DropZone>                   drop target + <input type=file> + "Choose a file"
        <DemoButtons>                "Try the demo", "Try the graveyard sample", "made-up data" note
        <LoadError>                  when state.loadError
      phase "ready":
        <ExhumePanel>                section "Exhume"
          <FileSummary>              name, size, "Open another file"
          <SheetList>                name, rows x cols
          <ModuleList>               name, kind, lines, parse error if any
          <MacroList>                Module.Name, prediction badge, actual badge, [Run]
          <NoVbaNotice>              UI-2.5
        <ResultBar>                  section "Resurrect": status badge, stoppedAt text, error, counts, duration, <DownloadButton>
        <Workspace>                  two columns >= 960 px, one tab list below
          <GridView>                 <SheetTabs> <Grid>  (+ formulas note)
          <SourceView>               <ModuleTabs> numbered lines
          <SidePanels>               <Tabs: "Trace (n)" | "Graveyard (n)">
            <TracePanel>             <TraceFilters> <TraceList>
            <GraveyardPanel>         banner, entries by module
    <Footer>                         <LimitsNote> "What this does not do yet", privacy sentence
```

Layout:

- 960 px and wider: left column holds `ExhumePanel`. The main column has `ResultBar` on top, `GridView` and `SourceView` side by side, and `SidePanels` below them. Selecting a trace row updates both the grid and the source view and both are visible.
- Below 960 px: one column. `ExhumePanel`, `ResultBar`, then a single tab list "Grid | Source | Trace | Graveyard". Selecting a trace row does not switch tabs on its own; the row shows "Go to cell" and "Go to line" buttons (UI-4.5). Selecting a graveyard entry switches to "Source" because its only target is the source.
- At 375 px: tab labels may wrap to two rows, buttons are 44 px high, `ExhumePanel` collapses its sheet and module lists into `<details>` that are closed after the first run.

## 4. State

```ts
type Phase = "empty" | "loading" | "ready";

interface AppState {
  phase: Phase;                    // "ready" means exhumed is set
  loadError: string | null;        // shown in the empty and in the ready phase
  notice: string | null;           // e.g. "2 other files were ignored"
  exhumed: Exhumed | null;
  run: { status: "idle" } | { status: "running"; macroId: string } | { status: "done"; macroId: string; view: RunView };
  view: {
    sheet: string | null;          // grid tab
    module: string | null;         // source tab
    panel: "trace" | "graveyard";  // side panel tab
    narrowTab: "grid" | "source" | "trace" | "graveyard";
    traceFilter: { kinds: Set<"read" | "write" | "skipped">; sheet: string | null };
  };
  selection: Selection | null;
}

type Selection =
  | { origin: "trace"; eventIndex: number; sheet?: string; row?: number; col?: number; module: string; line: number }
  | { origin: "graveyard"; module: string; line: number }
  | { origin: "grid"; sheet: string; row: number; col: number };
```

Model objects (immutable once created):

```ts
interface Exhumed {
  fileName: string; size: number;
  bytes: Uint8Array;                         // original file, kept to reopen a fresh workbook per run
  kind: "zip" | "cfb";
  initial: SaveableWorkbook;                 // read-only preview before any run
  sheets: { name: string; rows: number; cols: number }[];
  modules: ExhumedModule[];                  // { name, type, source, lines: string[], ast: ModuleAST | null, parseError: {message, line} | null }
  procedureCount: number;                    // all Subs and Functions, for UI-2.2
  macros: MacroInfo[];
  staticUnsupported: UnsupportedHit[];       // scanUnsupported(parsed modules)
  vba: "present" | "none" | "unreadable-xls";
}

interface MacroInfo {
  id: string;                                // "Module1.BuildActs"
  module: string; name: string; line: number;
  prediction: { status: "fully" | "partly"; hits: UnsupportedHit[] };
}

interface RunView {
  macroId: string;
  result: RunResult;                         // as returned by runMacro, untouched
  workbook: SaveableWorkbook;                // the fresh copy the macro ran on
  changes: Changes;                          // derived once
  graveyard: GraveyardEntry[];               // static + runtime, marked
  counts: { reads: number; writes: number; skipped: number; changed: number };
  durationMs: number;
}

interface Changes {
  bySheet: Map<string, Map<number, { before: VBAValue }>>;  // key = row * 16385 + col
  firstChangedSheet: string | null;
}

interface GraveyardEntry extends UnsupportedHit { mark: "skipped" | "stopped" | "not-reached" | "static" }
```

`Exhumed` and `RunView` hold no Preact types, so the model can be tested and reused outside the UI.

## 5. Data flow

### 5.1 Exhume (`model/exhume.ts`, used by drop, file input and demo)

```
bytes ──sniffKind──► "zip" | "cfb" | "unknown" (error UI-1.3)
  │
  ├─ extractModules(bytes)         → VBAModule[]       NoVBAProjectError → vba "none" (zip) or "unreadable-xls" (cfb)
  │      for each: tokenize(source) → parse(tokens, name) → ModuleAST       ParseError → module.parseError, ast null
  ├─ scanUnsupported(asts of parsed modules) → staticUnsupported
  ├─ listMacros(asts)              → MacroInfo[]   (SubDecl, params.length 0, scope !== "Private")
  ├─ predictMacro(...)             → prediction per macro
  └─ openWorkbook(bytes)           → initial workbook → sheets list
```

The three entry points (drop, input, demo) all produce `(name, bytes)` and call `loadFile` in `state/actions.ts`, which calls `exhume`. This is the single code path that the end-to-end test uses.

For a `cfb` file (`.xls`): `openWorkbook` reads the sheets, `extractModules` is still attempted (a raw `vbaProject.bin` works), and a `NoVBAProjectError` becomes `vba: "unreadable-xls"`. The app never claims "no macros" for an `.xls`.

### 5.2 Run (`model/resurrect.ts`)

```
macroId ──► workbook = openWorkbook(exhumed.bytes)                      fresh copy
          t0 = performance.now()
          result = runMacro(macroId, parsedAsts, workbook)               parsedAsts = exhumed.modules.filter(ast).map(ast)
          changes = deriveChanges(result.trace, exhumed.initial, workbook)
          graveyard = buildGraveyard(exhumed.staticUnsupported, result)
          view = { result, workbook, changes, graveyard, counts, durationMs }
```

`actions.runMacro` dispatches `run-start` (state becomes `running`, live region says "Running"), awaits `requestAnimationFrame` plus a `setTimeout(0)` so the browser paints, then calls `resurrect` and dispatches `run-done`. An exception from `resurrect` itself (not from the macro, which `runMacro` turns into `status: "failed"`) is shown as an error and the state returns to `idle`.

### 5.3 How `runMacro`, trace and `staticUnsupported` map to panels

| Source | Field | Shown in |
|---|---|---|
| `RunResult` | `status` | `ResultBar` badge text, copied as is (UI-13.1). `MacroList` actual badge. Live region. |
| | `error` | `ResultBar` error text. For `RuntimeError`, also `module:line`, which becomes a clickable link to the source line. |
| | `stoppedAt` | `ResultBar` sentence and `GraveyardPanel` banner. Source gutter marker "stopped". Graveyard entry mark `stopped`. |
| | `trace` where `kind: "read"` | `TracePanel` rows. Count in `ResultBar`. Not shown in the grid. |
| | `trace` where `kind: "write"` | `TracePanel` rows with `before` and `after`. `deriveChanges` folds them into `Changes` (first `before`, last `after` per cell) for grid highlighting. |
| | `trace` where `kind: "unsupported"` | `TracePanel` row labelled "skipped" with the construct. |
| | `unsupported` | `buildGraveyard` marks matching static entries "skipped" (match on module, line, construct). An entry that is not in the static list is appended with mark `skipped`. |
| | `staticUnsupported` | `GraveyardPanel` rows (base list). The same list is available before any run, from `Exhumed.staticUnsupported`. Source gutter markers. |
| `scanUnsupported` at exhume | | `MacroList` prediction (via `predictMacro`), `GraveyardPanel` before any run, panel tab count. |
| `TraceEvent.statement` | `{ module, line }` | Selection target for the source view. |
| `TraceEvent` | `sheet`, `row`, `col` | Selection target for the grid. |
| workbook after the run | cell values | `Grid` (reads `getCellValue` for visible cells only). `DownloadButton` (`save()`). |
| `initial` workbook | cell values | `Grid` before any run, and the `before` value for changed cells that were not traced. |

`status` is computed by the interpreter from runtime hits only. A macro can have `status: "fully resurrected"` and still have static entries in the graveyard (code that was not reached). The graveyard marks those "not reached", and the ResultBar shows the status unchanged. This is what the core spec defines and the UI does not reinterpret it.

### 5.4 Selecting a trace row (UI-4.3, UI-12.3)

`select-trace(eventIndex)` is one action. The reducer reads the event from `view.result.trace[eventIndex]` (array index, O(1)) and sets `selection`, `view.sheet`, `view.module`, and `narrowTab` is left alone. Components derive from `selection`:

- `Grid` scrolls its container so that the cell is inside the visible window, sets the roving focus target to the cell and renders it with `aria-selected="true"` plus the selection outline.
- `SourceView` scrolls to the line (`scrollIntoView({ block: "center" })` is not used: it scrolls the page. The container's `scrollTop` is set from the fixed line height) and renders the line with the selection style and `aria-current="true"`.

### 5.5 Prediction (`model/predict.ts`)

The static scan lists hits per module and line, not per macro. `ProcedureDecl` carries only its start line. The prediction attaches hits to a macro this way:

1. Span of a procedure = from its `line` to the line before the next procedure in the same module, or to the last source line. A comment block between two procedures is counted with the procedure above it. This can only add hits to a procedure, never lose them.
2. Closure of a macro = the macro, plus every procedure whose name appears as an `Identifier` in the AST of a procedure already in the closure (any module, case-insensitive, same-module match preferred), repeated until nothing is added. A name that is also a parameter or local is not excluded (this can only enlarge the closure).
3. Hits of a macro = the static hits whose line lies in a span of a procedure in the closure, plus declaration-level hits (outside every span) that apply: a `Declare` hit applies when its function name appears as an identifier in the closure; any other declaration-level hit (for example `Dim x As New Foo` at module level) applies to every macro of its module.
4. Prediction is "partly" when the hit list is not empty, else "fully".

The prediction is conservative: it can say "partly" for a macro that never reaches the construct at run time, and then the actual status is "fully". It can say "fully" when the macro reaches an unsupported construct through a route the scan does not see (`Application.Run "Name"`, `CallByName`). `MacroList` shows both after a run (UI-2.4). Tests pin both directions (tasks UTASK-05).

### 5.6 Changed cells (`model/changes.ts`)

One pass over `trace`. For each write event keep `first before` and `last after` per `(sheet, row, col)`. A cell is changed when `first before !== last after` (strict equality; `null` for empty; numbers compared with `Object.is`, so `NaN` is equal to itself and `0` and `-0` differ, which does not matter for display). The lookup key is `row * 16385 + col`, a number, to avoid allocating a string per cell. `Changes.bySheet` stores the `before` value for the cell's `aria-label`.

Cells written through a multi-cell `Range.Value = array` produce one write event per cell (the tracing workbook records per cell), so this covers range writes.

## 6. Panels in detail

### 6.1 Grid (`Grid.tsx`, `useWindow.ts`)

- Dimensions: `rows = max(sheet.usedRowCount(), 20)`, `cols = max(sheet.usedColCount(), 8)`, plus one row and one column of headroom. Capped at 1 048 576 and 16 384.
- A scroll container with `role="grid"`, `aria-rowcount`, `aria-colcount`, `tabindex="-1"` on the container, one cell with `tabindex="0"` (roving). An inner spacer element has the full virtual size. Row height 24 px (32 px under 960 px), column width 96 px, header row and column sticky.
- `useWindow` converts `scrollTop`, `scrollLeft` and the viewport size into `[firstRow, lastRow]` and `[firstCol, lastCol]` plus overscan of 4. The rendered cells are positioned with `transform`-free absolute `top` and `left` in a `style` object set through the DOM API (CSP safe).
- Cell value: `formatValue(sheet.getCellValue(r, c))`. Formula marker: `sheet.getCellFormula(r, c) !== null` adds a small "fx" text marker (text, not an icon) and `aria-description="formula, value not recalculated"`.
- Changed cell: class `cell--changed` (ochre background, 4 px leading bar, font-weight 600) and `aria-label="<value>, changed, was <before>"`.
- Keyboard: arrows, Home (row start), End (last used column), Ctrl+Home (A1), Page Up and Page Down (one viewport). Focus moves by changing the roving cell and scrolling it into view.
- Which workbook is read: before any run `exhumed.initial`; after a run `view.workbook`.

### 6.2 Trace (`TracePanel.tsx`, `TraceList.tsx`)

- Filtering produces a `Uint32Array` of indices into `trace`, memoised on `(run, filter)`. Rendering uses the same window logic with row height 36 px (40 px narrow). Rows are one line: kind label, `Sheet!A1`, values truncated to 40 characters with full text in `title` and in the accessible name, `Module1:23`.
- `role="listbox"` with `role="option"` rows, one tab stop, arrows, Home, End, Enter or Space selects. `aria-selected` follows `selection`.
- Kind is a text label ("read", "write", "skipped"), not only a colour.

### 6.3 Graveyard (`GraveyardPanel.tsx`)

Entries grouped by module; each row is a button: `Module1:22  Open  [stopped the run]`. The banner for `stoppedAt` sits above the list. Marks are text. Before a run the mark column shows nothing (not "not reached", which would claim a run happened).

### 6.4 Source (`SourceView.tsx`)

A `<div role="region" aria-label="VBA source: Module1" tabindex="0">` with a two-column table-like layout: a gutter column with `user-select: none` (line number, plus marker for graveyard lines) and a code column in `<pre>`-like rows. Every line is its own element with a fixed height so that scroll-to-line is arithmetic. Modules are rendered in full; VBA modules in business workbooks are well under a few thousand lines, and the performance test includes a 5 000-line module to keep this honest.

### 6.5 Drop zone

A `<section>` with a visible "Choose a file" button and the sentence "Your file stays in this browser." The drop handlers call `preventDefault` on `dragover` and `drop`. The drop zone shows a dashed border on `dragenter` (border style, not colour only). Dropping anywhere on the empty page works, so a file dropped slightly outside the zone does not make the browser open it.

## 7. Visual identity

### 7.1 Tokens (`styles/tokens.css`)

Contrast ratios were computed with the WCAG formula. They are asserted again by `tests/tokens.test.ts`, which parses `tokens.css`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f6f3ec` | `#16181a` | page |
| `--surface` | `#fffdf8` | `#1e2124` | panels, grid cells |
| `--text` | `#1f1d1a` | `#e8e4dc` | body text (on bg 15.2 / 14.0, on surface 16.5 / 12.8) |
| `--muted` | `#5b564e` | `#aaa496` | secondary text (on surface 7.2 / 6.5) |
| `--border` | `#8d8576` | `#7b8189` | component boundaries (on surface 3.6 / 4.1) |
| `--accent` | `#2d5a4c` | `#7fb8a4` | primary button, links (on surface 7.7 / 7.2) |
| `--on-accent` | `#ffffff` | `#10201b` | text on the accent (7.8 / 7.5) |
| `--changed-bg` | `#f6e3a1` | `#4a3d12` | changed cells (text on it 13.2 / 8.8) |
| `--changed-bar` | `#8a5a00` | `#e0b04a` | changed-cell leading bar (on surface 5.8 / 8.1) |
| `--danger` | `#8f2d1f` | `#e58b7b` | graveyard, errors (on surface 8.1 / 6.4) |
| `--focus` | `#0b5cad` | `#7ab4f0` | focus ring, 2 px (on surface 6.6 / 7.4) |

No gradients, no `box-shadow` with blur (the focus ring uses `outline`), no `text-shadow`, no `filter`. One inline SVG tombstone (24 px, `currentColor`, `aria-hidden`) in the header; the header text carries the name.

### 7.2 Where the theme shows

| Place | Text |
|---|---|
| Header | "VBA Necromancer", tagline "Bring dead macros back, in your browser." |
| Drop zone | "Exhume a workbook" heading, "Drop an .xlsm here, or choose a file." |
| Panel names | Exhume, Resurrect (the result bar), Trace, Graveyard |
| Status | "Fully resurrected", "Partly resurrected", "Run failed" |
| Empty states | "Nothing buried here yet" (no workbook), "Nothing in the graveyard" |
| Run button | "Run" (accessible name "Run Module1.BuildActs") |
| Footer | "What this does not do yet" |

## 8. Build, offline and deploy

- `vite.config.ts`: `base: "./"`, `build.target "es2022"`, `build.assetsInlineLimit` untouched (`?inline` forces inlining for the demo files). `server.fs.allow` includes the repository root so `../fixtures/build/*.xlsm` can be imported in dev.
- `index.html`: `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'none'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'">`. Preact sets styles through the DOM API, which `style-src` allows. If a library needs inline styles, the failure shows in `build.test.ts` (it loads the built page in jsdom with CSP violations reported) and in the manual checklist, and the policy is relaxed only for that case with the reason written in this file.
- The size plugin prints raw and gzip sizes of `dist/assets/*` and fails the build above 600 KB gzip in total. The SheetJS bundle is the largest part; this budget is checked against the real number in UTASK-14 and the number written into `docs/ui-checklist.md`.
- `.github/workflows/pages.yml`: on push to `main`: `npm ci`, `npm run typecheck`, `npm test`, `npm run build -w app`, `actions/upload-pages-artifact` with `app/dist`, `actions/deploy-pages`. Repository settings must have Pages source set to "GitHub Actions" (a manual step, listed in the tasks).
- The fixtures are committed, so the app build does not run `fixtures:build`. A test compares the bytes embedded in the bundle with `fixtures/build/*.xlsm` (UI-8.3); if someone changes `fixtures/src` and forgets to rebuild, the existing fixture rebuild hook updates the files and the test then passes against the new bytes.

## 9. Performance

Budgets from UI-12, and how each is met.

| Case | Budget | Mechanism |
|---|---|---|
| 40-row demo: exhume + run + derive | under 100 ms, no visible wait | Nothing heavy: 22 written cells, a few hundred trace events. Rendering touches fewer than 150 cells. |
| 5 000 rows, `BuildActs`: exhume + run + derive | under 2 000 ms | `openWorkbook` runs twice (once for `initial`, once for the run). `runMacro` is O(rows x categories). `deriveChanges` is one pass over about 6 events per row (30 000 events), no per-event allocation except the map entries for written cells. Reading a cell is a property lookup on the SheetJS sheet. |
| Rendering after that | at most 400 cell nodes, at most 100 trace row nodes | Windowing in `Grid` and `TraceList`. |
| Select a trace row | one render | `trace[eventIndex]` is O(1). The grid and the source view derive scroll position arithmetically. |
| Filter the trace | under 50 ms for 30 000 events | One pass producing a `Uint32Array`. |

If the 5 000-row run is over budget, the order of attack is: (1) share the first `openWorkbook` result for the run and re-open only on the second run (`initial` is never mutated by a macro, but the run workbook must be fresh, so this saves only the first run); (2) measure `XLSX.read` separately, since SheetJS parsing is the likely cost; (3) move `resurrect` into a Worker. Any of these is a design change recorded here first.

Optional improvement outside `app/` (not part of this spec's tasks): `ProcedureDecl` has no end line, so spans are approximated in 5.5. An `endLine` in `packages/vba/src/ast.ts` would make spans exact. It would be a separate change to `packages/vba` with its own tests.

## 10. Error handling

| Situation | Behaviour |
|---|---|
| Not a workbook (UI-1.3) | `loadError`: "`name` is not an Excel workbook (it does not start with a ZIP or Excel signature)." Previous workbook kept. |
| `CFBFormatError`, `OVBADecompressError`, zip error | "Could not read the VBA project in `name`: `message`." The sheets are still shown if `openWorkbook` succeeded, with `vba: "none"`-like notice carrying the error text. If `openWorkbook` also fails, `loadError`. |
| `NoVBAProjectError` | Notice UI-2.5. |
| `ParseError` in a module | Module row shows "Could not parse: `message`". Its source is still shown in the source view. |
| `runMacro` returns `failed` | `ResultBar` shows "Run failed" and the error. Download stays enabled with the partial-results description. |
| Exception from `save()` | `role="alert"`: "Could not build the .xlsx: `message`". |
| `localStorage` or clipboard | Not used. |

All user-supplied strings (file name, cell values, VBA text, error messages) are rendered as text children by Preact. The app never uses `dangerouslySetInnerHTML`, and a lint rule forbids it. The download file name is built from the file's base name with characters outside letters, digits, `-`, `_`, `.` and non-ASCII letters replaced by `_`.

## 11. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Model | Vitest, no DOM | `sniffKind`, `listMacros`, `predictMacro`, `deriveChanges`, `buildGraveyard`, `formatValue`, `exhume` on every `fixtures/build/*.xlsm`, `resurrect` against `fixtures/expected/*.json` |
| Reducer | Vitest | action sequences: load, run, select, filter, reload keeps state on error |
| Components | Vitest + jsdom + `@testing-library/preact` | each panel with model fixtures; keyboard behaviour with `fireEvent.keyDown` |
| End to end (same code path as the UI) | Vitest + jsdom | `<App/>`: demo button or file input, run, grid vs `demo_acts.json`, trace click, graveyard, download blob parsed back with `openWorkbook` |
| Tokens and theme | Vitest, parses CSS | contrast ratios, banned CSS, emoji scan |
| Build | Vitest, runs `vite build` into a temp dir | relative URLs, no `http(s)` in html and css, size budget |
| Structure a11y | `axe-core` in jsdom | roles, names, landmarks, duplicate ids (colour contrast is excluded because jsdom has no layout; `tokens.test.ts` covers it) |
| Manual | `docs/ui-checklist.md` | real keyboard walk, 375 px, light and dark, download opened in LibreOffice, offline reload |

jsdom has no layout, so windowing is tested through the pure range function (`visibleRange(scrollTop, viewport, itemSize, count, overscan)`) and through rendered-node counts after setting the container's `clientHeight` and `scrollTop` by property definition in the test.

Risk list, to be checked in the first tasks: (a) `?inline` asset imports under Vitest (UTASK-01 has a smoke test; the fallback is a small Vite plugin that exposes the file as a `Uint8Array` module); (b) `File.arrayBuffer` in the installed jsdom (fallback: `FileReader`); (c) `TextDecoder("windows-1251")` in Node and browsers (already exercised by the ovba tests in Node; Chrome, Firefox and Safari support it).
