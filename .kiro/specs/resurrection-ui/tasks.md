# Tasks: resurrection-ui

Ordered so each task builds on the previous one and leaves `npm test`, `npm run typecheck` and `npm run lint` green. IDs use the `UTASK-` prefix to avoid clashing with `TASK-` (core) and `DTASK-` (dictionary). Design references are to `design.md`.

Rules for every task:

- Do not edit `packages/*` or `fixtures/expected/*.json` (hand-written oracles, guarded by a hook). If a task seems to need a change in `packages/*`, stop and record it in `BACKLOG.md`.
- No `any` in `app/src`. No `dangerouslySetInnerHTML`.
- No network calls from the app. Model code in `app/src/model/` imports neither Preact nor DOM types.
- Each task adds its own tests in the same change. All user-visible strings are in English.
- Commit messages in English, imperative mood.

Status of every task is given under its heading.

---

## UTASK-01: Tooling, Preact skeleton, test environment

**Status: Done**

**Requires:** UI-11.1 (base), foundation for all tests
**Design:** sections 1, 2, 8

### What to do
1. Add dependencies: `preact` to `app/package.json`; dev dependencies `@preact/preset-vite`, `jsdom`, `@testing-library/preact`, `@testing-library/dom`, `axe-core` at the root.
2. `app/vite.config.ts`: `base: "./"`, Preact preset, `server.fs.allow` with the repository root.
3. `app/tsconfig.json`: `jsx: "react-jsx"`, `jsxImportSource: "preact"`, `lib: ["ES2022", "DOM", "DOM.Iterable"]`, include `src/**/*.ts`, `src/**/*.tsx`, `tests/**/*`. Keep `npm run typecheck` working (it uses `tsc -b`; adjust `rootDir` so tests are included).
4. Root test config: replace `vitest.config.ts` with a `vitest.workspace.ts` that has the existing packages project unchanged and a second project `app` (`environment: "jsdom"`, include `app/tests/**/*.test.{ts,tsx}`). Keep `npm test` as one command. Check that the existing hooks (`npm test --workspace=packages/<pkg>`) still work.
5. ESLint: make sure `.tsx` files are linted; update the `lint` script if needed.
6. Replace `app/src/main.ts` by `main.tsx` that renders a placeholder `<App/>` with an `h1`. Update `index.html` to load `main.tsx`, set `<title>VBA Necromancer</title>` (remove the emoji).
7. Smoke test for the risks in design.md section 11: importing `../../fixtures/build/demo_acts.xlsm?inline` under Vitest yields a `data:` URL whose decoded bytes start with `PK`; `new File([bytes], "a.xlsm").arrayBuffer()` works in the test environment (if not, add a `readFile` helper using `FileReader` and test that instead).

### Tests (`app/tests/smoke.test.tsx`)
- Rendering `<App/>` shows one `h1` with the text "VBA Necromancer".
- The inline demo import decodes to a ZIP.
- The existing package tests still run and pass (`npm test`).
- `npm run build -w app` exits 0 and `npm run typecheck` includes `app`.

---

## UTASK-02: File sniffing and `exhume`

**Status: Done**

**Requires:** UI-1.3, UI-1.5 (size check function), UI-1.7, UI-2.1, UI-2.5, UI-2.6, UI-6.5
**Design:** sections 4, 5.1

### What to do
1. `model/sniff.ts`: `sniffKind(bytes)` returns `"zip"` for `PK\x03\x04`, `"cfb"` for `D0 CF 11 E0 A1 B1 1A E1`, else `"unknown"`. `MAX_FILE_BYTES = 50 * 1024 * 1024` and `checkSize(size)`.
2. `model/exhume.ts`: `exhume(name, bytes): Exhumed` as in design 5.1. Split it into `extractModules` plus `exhumeParts(name, bytes, sources)`, where `sources` is `{ name, type, source }[]`; `exhumeParts` is the seam that tests and UTASK-21 use. `extractModules`, then `tokenize` and `parse` per module, `scanUnsupported` over the parsed modules, `openWorkbook` for `initial` and the sheet list, `vba` state for no project and for `.xls`. Typed errors (`NotAWorkbookError`, `FileTooLargeError`) with readable messages.
3. `Exhumed.modules` keeps the source text and the split lines. A module that throws `ParseError` keeps `ast: null` and `parseError`.

### Tests (`app/tests/model/exhume.test.ts`)
- Table test over every `fixtures/build/*.xlsm`: module names equal the names of `fixtures/src/<name>/*.bas`; the sheet names equal those in `cells.json`; the Cyrillic text of `demo_acts` module source contains "Журнал" (code page 1251).
- `staticUnsupported` of `graveyard.xlsm` equals the list in `fixtures/expected/graveyard.json` (the first run's `unsupported`).
- A text file, an empty array and a 3-byte array give `NotAWorkbookError` with the file name in the message.
- `checkSize` rejects 50 MB + 1 with a message that has both numbers.
- An `.xlsx` (build one in the test with `xlsx`, no VBA) gives `vba: "none"`, sheets listed, no macros.
- A module with a syntax error, passed to `exhumeParts` as source text, gives `parseError` and does not stop other modules.

---

## UTASK-03: Macro list and procedure spans

**Status: Done**

**Requires:** UI-2.2
**Design:** 5.5 (steps 1)

### What to do
1. `model/macros.ts`: `listMacros(modules)` returns `MacroInfo[]` (without prediction yet): `SubDecl` with `params.length === 0` and `scope !== "Private"`, id `Module.Name`, ordered by module then line. `countProcedures(modules)` for the "N other procedures" text.
2. `procedureSpans(ast, lineCount)`: `{ proc, from, to }` per procedure.

### Tests (`app/tests/model/macros.test.ts`)
- `labour_statement`: `CalcPay` is a macro, `RateFor` (a Function with a parameter) is not; the count of other procedures is 1.
- A source with `Private Sub A()`, `Sub B(x As Long)`, `Public Sub C()`, `Sub D()`: macros are `C` and `D`.
- Duplicate sub names in two modules give two macros with distinct ids.
- Spans: for `graveyard` the spans are lines 5 to 19 and 20 to the last line.

---

## UTASK-04: Prediction from the static scan

**Status: Done**

**Requires:** UI-2.3, UI-2.4 (data), UI-13.2
**Design:** 5.5

### What to do
1. `model/predict.ts`: `predictMacro(macro, modules, staticHits)` implements steps 2 to 4 of design 5.5 (closure by identifier, `Declare` by name, other declaration-level hits apply to the module's macros).
2. Wire into `exhume` so every `MacroInfo` has `prediction`.

### Tests (`app/tests/model/predict.test.ts`)
- `graveyard.ExportReport`: partly, hits include line 11 (`CreateObject`), 13, 14, 15; `ExportStrict`: partly, hits include line 22; neither lists the line 3 `Declare` (nobody calls `GetTickCount`).
- `demo_acts.BuildActs`: fully, no hits.
- Closure: macro A calls Sub B in another module, B contains `Shell`: A is partly, with B's hit.
- A `Declare` that a macro calls by name is attached; a module-level `Dim x As New Foo` is attached to every macro in that module.
- Recursion (A calls B, B calls A) terminates.
- Consistency over all fixtures: for every run in `fixtures/expected/*.json`, if the prediction is "fully", the expected status is "fully resurrected" (soundness on the corpus); and for every run whose expected status is "partly resurrected", the prediction is "partly". Fixtures that disagree in the other direction are listed explicitly in the test with the reason.

---

## UTASK-05: `resurrect`, changed cells, graveyard model

**Status: Done**

**Requires:** UI-3.1, UI-3.3, UI-3.5, UI-5.2, UI-5.3 (data), UI-13.1, UI-13.2
**Design:** 4, 5.2, 5.3, 5.6

### What to do
1. `model/changes.ts`: `deriveChanges(trace)` as in 5.6.
2. `model/graveyard.ts`: `buildGraveyard(staticHits, result)` with marks `skipped`, `stopped`, `not-reached`, plus appended runtime-only hits.
3. `model/resurrect.ts`: `resurrect(exhumed, macroId): RunView` opens a fresh workbook from `exhumed.bytes`, calls `runMacro`, measures duration, derives counts, changes and graveyard. `RunResult` is stored untouched.

### Tests (`app/tests/model/resurrect.test.ts`)
- For every run in `fixtures/expected/*.json` (macros run in file order on a fresh load each, as the UI does): `view.result.status` equals the expected status; every expected cell is in `view.workbook`; every expected cell that differs from the initial workbook is in `changes`.
- `demo_acts.BuildActs`: `changes` for sheet "Акты" has the 22 cells that the oracle lists, and none for "Журнал".
- Writing the original value back (unit test on `deriveChanges` with a hand-built trace) is not a change; clearing a cell is.
- `graveyard.ExportReport`: an entry is `skipped` exactly when `result.unsupported` contains the same module, line and construct, and `not-reached` otherwise (line 3 `Declare` and line 22 `Open` are outside this macro's path and must be `not-reached`); `ExportStrict`: line 22 is `stopped` and equals `stoppedAt`; the others are `not-reached`.
- Two runs of the same macro give equal results (fresh copy each time) and `exhumed.initial` is unchanged after a run.
- `status` of the view is the object identity-equal field of `RunResult` (no recomputation).

---

## UTASK-06: Formatting and windowing helpers

**Status: Done**

**Requires:** UI-3.7, UI-3.8, UI-12.2 (pure part)
**Design:** 6.1, 6.2, 11

### What to do
1. `model/format.ts`: `formatValue(v)` (15 significant digits without exponent for ordinary magnitudes, `TRUE`/`FALSE`, empty string for `null`, 2-D arrays are never passed), `address(row, col)` (`B7`), `qualified(sheet, row, col)` (`'My Sheet'!B7` when quoting is needed).
2. `ui/useWindow.ts` exports the pure `visibleRange(offset, viewport, itemSize, count, overscan)`.
3. Property tests with `fast-check` where it fits.

### Tests
- `formatValue(0.1 + 0.2)` is `0.3`; `formatValue(1e21)` and `formatValue(1.5e-7)` are stable, documented outputs; `formatValue(true)` is `TRUE`; `formatValue(null)` is `""`.
- `address(1, 1)` is `A1`, `address(1, 27)` is `AA1`, `address(5000, 16384)` is `XFD5000`.
- `visibleRange`: never negative, never above `count`, contains at least the visible items, size bounded by `viewport / itemSize + 2 * overscan + 1` (property test).

---

## UTASK-07: Store: state, reducer, actions

**Status: Done**

**Requires:** UI-1.2, UI-1.4, UI-1.6, UI-1.7, UI-3.2, UI-3.4, UI-4.3 (state), UI-4.4
**Design:** 4, 5.2, 5.4

### What to do
1. `state/types.ts`, `state/reducer.ts` with the actions: `load-start`, `load-ok`, `load-fail`, `run-start`, `run-done`, `run-fail`, `select-sheet`, `select-module`, `select-trace`, `select-graveyard`, `select-cell`, `set-trace-filter`, `set-panel`, `set-narrow-tab`.
2. `state/actions.ts`: `loadFile(source)` where `source` is a `File` or `{ name, bytes }`; reads bytes (with `FileReader` fallback if UTASK-01 needed it), checks size before reading, calls `exhume`. Picks the first file and sets `notice` when more were given. `runMacro(id)` yields one frame before calling `resurrect`. `download()` builds the Blob and triggers the download through an injectable `saveBlob(blob, name)` (default creates an anchor, clicks it, revokes the URL).
3. `state/context.tsx`: provider and `useStore()`.

### Tests (`app/tests/state/reducer.test.ts`, `actions.test.ts`)
- `load-fail` keeps the previous `exhumed`; `load-ok` replaces it and clears `run`, `selection`, `view` fields that refer to the old workbook.
- `run-start` then `run-done` selects the first changed sheet (UI-3.4); with no changed sheet it selects the active sheet.
- `select-trace(i)` sets sheet, module and selection from `trace[i]` in one action; `select-trace` on a "skipped" event sets only module and line; a new run clears the selection.
- `loadFile` with three files loads the first and sets the notice; a 51 MB `File` stub is refused without calling `arrayBuffer`.
- `download()` calls `saveBlob` with type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and the name `demo_acts-resurrected.xlsx` for `demo_acts.xlsm`; the file name sanitiser replaces `/`, `\`, `:` and control characters.
- `runMacro` dispatches `run-start` before the interpreter is called (spy on `resurrect`).

---

## UTASK-08: Design tokens and theme guard tests

**Status: Done**

**Requires:** UI-9.3, UI-9.4, UI-10.2, UI-10.3, UI-10.4, UI-10.5
**Design:** 7.1

### What to do
1. `styles/tokens.css` with the table from design 7.1 for light and, under `@media (prefers-color-scheme: dark)`, dark. `color-scheme: light dark`. Spacing scale, type scale (system stacks), `--focus-width: 2px`.
2. `styles/base.css`: reset, body, focus ring through `outline` using `--focus`, `prefers-reduced-motion` rule, `.visually-hidden`, skip-link style.
3. Import both from `main.tsx`.

### Tests
- `app/tests/tokens.test.ts`: parse `tokens.css`; for the pairs in design 7.1 (text/bg, text/surface, muted/surface, on-accent/accent, accent/surface, text/changed-bg, changed-bar/surface, danger/surface, focus/surface, focus/bg, border/surface) compute the WCAG ratio in both schemes and assert at least 4.5 for text pairs and 3.0 for border, focus and changed-bar pairs.
- `app/tests/theme-lint.test.ts`: over `app/index.html`, `app/src/**/*.{ts,tsx,css}`: no `gradient(`, no `text-shadow`, no `filter:`, no `box-shadow` with a non-zero blur, no `@font-face`, no `fonts.googleapis`; no emoji or pictograph (`\p{Extended_Pictographic}` and `\u{1F000}-\u{1FAFF}`) in any of them; none of the colour tokens falls in the purple hue range (hue 260 to 320 degrees with saturation above 15 percent).

---

## UTASK-09: App shell, landmarks, live region, limits note

**Status: Done**

**Requires:** UI-9.1, UI-9.5, UI-10.1, UI-13.3
**Design:** 3, 7.2

### What to do
1. `App.tsx` with `StoreProvider`, `SkipLink`, `Header` (inline tombstone SVG with `aria-hidden`, `h1`, tagline), `LiveRegion` (`role="status"`) and `AlertRegion` (`role="alert"`), `main#workbook`, `Footer` with `LimitsNote` (a `<details>` "What this does not do yet" with the four limits from requirements, Scope section) and the sentence "Your file never leaves this browser."
2. `styles/layout.css` with the two layouts (960 px breakpoint) as empty containers for now.

### Tests (`app/tests/ui/shell.test.tsx`)
- One `h1`, one `main`, one `header`, one `footer`; the skip link is the first focusable element and its target exists.
- The live region exists and is empty on load; the alert region exists.
- `LimitsNote` mentions recalculation, buttons, `.xls` and number formats.
- `axe-core` run on the rendered shell reports no violations (rules except `color-contrast`).

---

## UTASK-10: Drop zone, file input, demo buttons, CSP

**Status: Done**

**Requires:** UI-1.1, UI-1.2, UI-1.4, UI-1.6, UI-1.7, UI-1.8, UI-1.9, UI-8.1 to UI-8.4
**Design:** 6.5, 8

### What to do
1. `model/demo.ts`: `DEMOS` with `demo_acts` and `graveyard`, imported with `?inline`, decoded by a local base64 function (no `fetch`).
2. `ui/DropZone.tsx`: drop handling on the zone and on `window` (prevent the browser from opening a dropped file), a visible `<button>` that opens the hidden `<input type="file" accept=".xlsm,.xlsx,.xltm,.xls">`, "Your file stays in this browser".
3. `ui/DemoButtons.tsx`: "Try the demo" and "Try the graveyard sample", with the made-up-data sentence.
4. `ui/LoadError.tsx` (`role="alert"`) and the notice line.
5. `index.html`: the CSP meta from design 8.

### Tests (`app/tests/ui/dropzone.test.tsx`, `demo.test.ts`, `network.test.tsx`)
- Dropping a `File` calls `loadFile` with it; `dragover` is default-prevented; dropping three files loads the first and shows the notice.
- Choosing a file through the input does the same. The button is a real `button`, reachable by Tab, and Enter on it opens the input (spy on `input.click`).
- Buttons and zone are disabled while `phase === "loading"`; the live region says "Exhuming".
- A text file shows the error with the file name; a previously loaded workbook stays visible.
- `DEMOS[i].bytes()` equals `readFileSync("fixtures/build/<name>.xlsm")` byte for byte (UI-8.3).
- Network guard: with `fetch`, `XMLHttpRequest`, `WebSocket` and `navigator.sendBeacon` replaced by spies that throw, loading both demos and running every macro makes zero calls.
- `index.html` contains the CSP meta with `connect-src 'none'`.

---

## UTASK-11: Exhume panel (sheets, modules, macros, predictions)

**Status: Done**

**Requires:** UI-2.1 to UI-2.6, UI-3.1, UI-3.2 (button state), UI-13.2
**Design:** 3, 5.3, 5.5

### What to do
1. `SheetList`, `ModuleList`, `MacroList`, `FileSummary`, `NoVbaNotice`, "Open another file" (reuses `DropZone` in a compact form).
2. `MacroList`: one row per macro with name, prediction text ("Predicted: partly resurrected, 4 unsupported constructs (lines 11, 13, 14, 15)"), after a run the actual status next to it, and the "Run" button (`aria-label="Run Module1.BuildActs"`). While running, all Run buttons are `disabled` and `aria-busy` is set on the list.
3. Text "N other procedures are not listed because they are Functions, Private or take parameters."

### Tests (`app/tests/ui/exhume.test.tsx`)
- After loading `demo_acts`: sheets "Журнал" and "Акты" with sizes, module `Module1`, macro `Module1.BuildActs` with "Predicted: fully resurrected".
- After loading `graveyard`: both macros are "Predicted: partly resurrected" and show their line numbers.
- After a run of `ExportStrict` the row shows the actual "Partly resurrected" next to the prediction; for a forced mismatch (state with prediction fully and actual partly) both texts are present.
- No VBA project: notice text, no Run buttons. `.xls` stub: the "cannot be read yet" text.
- A module with `parseError` shows the message and has no macros.
- The Run button's accessible name includes the macro id; the buttons are disabled during `run.status === "running"`.

---

## UTASK-12: Shared tabs and roving focus

**Status: Done**

**Requires:** UI-9.1, UI-9.2
**Design:** 3

### What to do
1. `ui/Tabs.tsx`: WAI-ARIA tabs (`tablist`, `tab`, `tabpanel`, `aria-selected`, `aria-controls`, automatic activation), used by `SheetTabs`, `ModuleTabs`, `SidePanels`, and the narrow-screen tab list.
2. `ui/useRovingFocus.ts` for tabs and for the trace list.

### Tests (`app/tests/ui/tabs.test.tsx`)
- Only the selected tab has `tabindex="0"`; ArrowRight and ArrowLeft move and wrap; Home and End go to the ends; the panel is linked by `aria-controls` and `aria-labelledby`.
- Tab moves from the tab list into the panel, not to the next tab.
- axe: no violations for a rendered tab set.

---

## UTASK-13: Grid and sheet tabs

**Status: Done**

**Requires:** UI-3.4 to UI-3.9, UI-9.2 (grid), UI-12.2 (cell nodes)
**Design:** 6.1

### What to do
1. `ui/Grid.tsx` with windowing, sticky headers, roving focus, keyboard map from UI-9.2, changed styling, formula marker, selected-cell outline, truncation with the full value in the accessible name.
2. `ui/GridView.tsx`: `SheetTabs` plus `Grid` plus the formulas note (only when the sheet has at least one formula; check by scanning the used range once per sheet and caching the answer).
3. `ui/GridView` reads from `exhumed.initial` before a run and from `view.workbook` after.

### Tests (`app/tests/ui/grid.test.tsx`)
- `role="grid"` with `aria-rowcount` and `aria-colcount` equal to the sheet size; headers show `A`, `B`, `1`, `2`.
- With a 5 000 x 12 sheet and a container whose `clientHeight` is set to 480 and `scrollTop` to 2400: the number of rendered cell nodes is at most 400 and includes row 101; row 1 is not rendered.
- A changed cell has `aria-label` containing "changed, was" and the old value; an unchanged cell does not; the changed style class is present.
- ArrowDown, ArrowRight, Home, End, Ctrl+Home, PageDown move the focused cell; exactly one cell has `tabindex="0"`.
- A cell with a formula shows the `fx` marker and its accessible description; the note appears only on sheets with a formula (build the workbook in the test with `xlsx` so it holds one formula).
- Booleans show `TRUE`/`FALSE`; a 300-character string is truncated visually and its full text is in the accessible name.
- Before a run no cell has the changed class.

---

## UTASK-14: Source view

**Status: Done**

**Requires:** UI-6.1 to UI-6.5, UI-12.2 (source)
**Design:** 6.4

### What to do
1. `ui/SourceView.tsx` and `ModuleTabs`: gutter with line numbers and unsupported markers (text alternative "unsupported: Open"), `user-select: none` on the gutter, region with `tabindex="0"` and an accessible name, scroll-to-line from `selection`, selected line style plus `aria-current`.
2. Marker for the stopping line ("stopped here").

### Tests (`app/tests/ui/source.test.tsx`)
- Every line of `demo_acts` Module1 is rendered with its 1-based number, and the text in the code column equals the source line (Cyrillic preserved).
- For `graveyard`: lines 3, 11, 13, 14, 15 and 22 have the marker with the construct in its accessible text; line 22 of `ExportStrict` also shows "stopped here" after a run.
- Selecting `{ module: "Module1", line: 22 }` sets `aria-current` on that line and sets the container's `scrollTop` so the line is within the visible window (with a defined `clientHeight`).
- The gutter has `user-select: none` in the stylesheet (CSS test), and the copy text of the code column has no digits from the gutter (DOM `textContent` of the code column only).
- A 5 000-line module renders under 200 ms in jsdom.

---

## UTASK-15: Result bar and download

**Status: Done**

**Requires:** UI-3.3, UI-5.3 (sentence), UI-7.1 to UI-7.4, UI-9.5
**Design:** 3, 5.3

### What to do
1. `ui/ResultBar.tsx`: status badge (text and a shape, never colour only), counts, duration, error text with a link to `module:line` for `RuntimeError`, and "Run stopped at `Module1:22` (`Open`)" when `stoppedAt` exists. The live region announces the result.
2. `ui/DownloadButton.tsx`: disabled with the reason text before a run, enabled after; the description for non-fully statuses says "contains partial results". Errors from `save()` go to the alert region.

### Tests (`app/tests/ui/result.test.tsx`)
- Before a run: no badge, button disabled, text "Run a macro first".
- After the `demo_acts` run: "Fully resurrected", "22 cells changed", counts equal the model's, the live region contains the same status.
- After `ExportStrict`: "Partly resurrected" and "Run stopped at Module1:22 (Open)".
- A forced `failed` result shows "Run failed", the message, and `module:line` when present; the link selects that line.
- Download: clicking calls `saveBlob` once with the expected name and type; the bytes parse with `openWorkbook` and contain the oracle's cells; the button description for `ExportReport` mentions partial results; a `save()` that throws shows the alert and does not call `saveBlob`.

---

## UTASK-16: Trace panel

**Status: Done**

**Requires:** UI-4.1, UI-4.2, UI-4.3, UI-4.4, UI-4.5, UI-4.6, UI-12.2 (trace rows), UI-12.3
**Design:** 5.4, 6.2

### What to do
1. `ui/TracePanel.tsx`, `TraceFilters` (kind checkboxes, sheet select), `TraceList` (windowed `role="listbox"`, `Enter` and `Space` select, arrows move).
2. Row text per design 6.2. "Go to cell" and "Go to line" buttons shown in the narrow layout.
3. Header "Trace" with "n of total events".

### Tests (`app/tests/ui/trace.test.tsx`)
- Before a run: "No macro has run yet".
- After the `demo_acts` run, the first write row shows `Акты!A1`, an empty before and `Категория` as after, and `Module1:<line>` equal to the line of that statement in the source.
- Kind filter "write" hides reads and the header count updates; sheet filter works; the total stays visible.
- Clicking a row dispatches one `select-trace`; the row is `aria-selected`; after a filter that hides it, selection stays in the state but no row is selected; a new run clears it.
- With a synthetic trace of 30 000 events at most 100 rows are in the DOM, and filtering finishes in under 50 ms.
- A "skipped" row (from `ExportReport`) shows the construct and has no cell address.
- The listbox has one tab stop and arrow keys move the active row.

---

## UTASK-17: Graveyard panel

**Status: Done**

**Requires:** UI-5.1 to UI-5.5, UI-13.2
**Design:** 6.3

### What to do
`ui/GraveyardPanel.tsx`: banner for `stoppedAt`, entries grouped by module as buttons, marks as text, tab label with the count, empty state. Selecting an entry dispatches `select-graveyard`.

### Tests (`app/tests/ui/graveyard.test.tsx`)
- Right after loading `graveyard.xlsm`, before any run: the panel lists the six entries of `fixtures/expected/graveyard.json` (module, line, construct) and no run marks; the tab label says 6.
- After `ExportReport`: entries that `result.unsupported` lists are "skipped during this run" and line 22 is "not reached"; after `ExportStrict`: line 22 is "stopped the run", the banner says "Run stopped at Module1:22 (Open)", the others are "not reached".
- A runtime hit missing from the static list is shown (hand-built `RunView`).
- `demo_acts`: "Nothing in the graveyard" and tab label 0.
- Clicking an entry sets the source view's selected line.
- The number shown equals the length of the list behind it in every case above.

---

## UTASK-18: Layout, cross-panel selection, narrow screens

**Status: Done**

**Requires:** UI-4.3, UI-4.5, UI-9.6, UI-10.2
**Design:** 3 (layout), 5.4

### What to do
1. `styles/layout.css` and `components.css`: two-column layout from 960 px; single column with the tab list below; controls at least 44 px high under 960 px; panels scroll inside themselves; no horizontal page scroll at 375 px (no fixed widths wider than the viewport; `min-width: 0` on grid children; long text wraps in the exhume lists, not in source or grid).
2. Wire `SidePanels` and the narrow tab list through `Tabs`. "Go to cell" sets `narrowTab: "grid"`, "Go to line" sets `"source"`. Graveyard selection sets `"source"` on narrow screens.
3. Use a small `useMediaQuery("(min-width: 960px)")` hook, with a test stub for `matchMedia`.

### Tests (`app/tests/ui/layout.test.tsx`)
- With `matchMedia` reporting narrow: exactly one tab list with four tabs (Grid, Source, Trace, Graveyard); selecting a trace row does not change the active tab; "Go to cell" activates Grid and the cell is selected; "Go to line" activates Source.
- With wide: Grid and Source are both in the DOM at once; selecting a trace row marks both.
- CSS test: `layout.css` contains the 960 px breakpoint, and a 44 px minimum size rule for buttons in the narrow block; there is no `width:` larger than 375 px outside a media query for containers (a simple static check on the stylesheet).
- Manual check recorded in UTASK-21.

---

## UTASK-19: End to end: demo_acts through the UI path

**Status: Done**

**Requires:** UI-3, UI-4, UI-6, UI-7, UI-8 (acceptance)
**Design:** 11

### What to do
`app/tests/e2e/demo.test.tsx`: render `<App/>` and drive it only through the DOM, with `saveBlob` replaced by a spy, `matchMedia` set to wide, and `fetch` guarded.

### Test steps
1. Click "Try the demo". Wait for the live region "Exhuming" to be replaced by the exhume view. Assert sheets "Журнал" and "Акты", module `Module1`, macro `Module1.BuildActs`, "Predicted: fully resurrected".
2. Before running, assert that no grid cell has the changed class.
3. Click "Run Module1.BuildActs". Assert "Fully resurrected" and the sheet tab "Акты" selected.
4. For every cell of the first run in `fixtures/expected/demo_acts.json`, assert the grid shows `formatValue(expected value)` (numbers within `numericTolerance` when parsed back) and the cell is marked changed. Scroll the grid in the test if a cell is outside the initial window.
5. Click the first write row in the trace. Assert the grid cell is `aria-selected` and the source line with that number is `aria-current`, and that the source line text contains the statement (`dst.Range("A1").Value = "Категория"`).
6. Graveyard tab: "Nothing in the graveyard".
7. Click "Download .xlsx". Assert `saveBlob` got a name `demo_acts-resurrected.xlsx`; parse the bytes with `openWorkbook` and compare every expected cell and every `empty` entry with the oracle.
8. Assert the network guard spies were never called.

---

## UTASK-20: End to end: graveyard.xlsm through the file input

**Status: Done**

**Requires:** UI-1.2, UI-5, UI-13 (acceptance)
**Design:** 11

### What to do
`app/tests/e2e/graveyard.test.tsx`: read `fixtures/build/graveyard.xlsm` from disk, wrap it in a `File`, set it on the real `<input type="file">` with a change event (the path a judge's file takes), then drive the UI.

### Test steps
1. After loading: the graveyard tab label is 6 and the list equals the oracle's `unsupported` list. Both macros are predicted "partly resurrected".
2. Run `ExportReport`: status "Partly resurrected", no stop banner, cells A1 to A3 of "Отчёт" have the oracle values, and the entries listed in `result.unsupported` are marked "skipped" while line 22 is "not reached".
3. Run `ExportStrict`: status "Partly resurrected", the banner and result bar say "Run stopped at Module1:22 (Open)", `B1` has "до" and `B2` is empty, line 22 in the source view is marked "stopped here". The grid shows the result of this run only (not `A1` to `A3` from the previous run).
4. Click the stopped entry: the source view selects line 22 of `Module1`.
5. Drop a text file: the error appears and the loaded workbook, with its last run, is still shown.
6. Download after `ExportStrict`: the button description mentions partial results.

---

## UTASK-21: Performance tests

**Status: Done, except the 100 ms budget of the 40-row test, which is not met and is skipped.** The cost is a million-cell `Range.End(xlUp)` scan in `packages/workbook`; recorded as `BACKLOG.md` item 8. The test prints the measurement and a 400 ms regression guard on the fastest of five runs runs in its place. The budget was not raised.

**Requires:** UI-12.1, UI-12.2, UI-12.3
**Design:** 9

### What to do
`app/tests/perf.test.ts` and `app/tests/ui/perf-render.test.tsx`. Build the large input in the test: take `fixtures/build/demo_acts.xlsm`, generate 5 000 journal rows with a fixed seed (same shape as `fixtures/src/demo_acts/cells.json`), and pass the VBA source of `demo_acts` and the cells to the same model entry that `exhume` uses internally (`exhumeParts(name, bytes, modulesSource)` is the testable seam; `exhume` is `extractModules` plus `exhumeParts`). The workbook bytes come from `xlsx` in the test.

### Tests
- 40 rows (the real `demo_acts.xlsm`): `exhume` plus `resurrect` takes under 100 ms (median of 5 runs after one warm-up).
- 5 000 rows: `exhume` plus `resurrect` plus `deriveChanges` takes under 2 000 ms (single run, warm-up first); the trace has more than 20 000 events; the result for the 20 categories equals a direct computation in the test.
- Rendering `<App/>` state for that run in jsdom creates at most 400 cell nodes and at most 100 trace row nodes.
- Selecting the 10 000th trace event changes selection with one reducer call and does not iterate over the trace (assert with a Proxy on the array that counts `get` of numeric indices: at most a small constant number).
- The times are printed in the test output so the real numbers can be copied into `docs/ui-checklist.md`. If a budget fails, record the measurement in `BACKLOG.md` and follow design section 9, not by raising the budget.

---

## UTASK-22: Production build, sub-path deploy, workflow

**Status: Done**

**Requires:** UI-11.1 to UI-11.5, UI-1.9
**Design:** 8

### What to do
1. Size report plugin in `vite.config.ts` (raw and gzip per asset, total; fail above 600 KB gzip).
2. `.github/workflows/pages.yml` per design 8.
3. README section "Run and deploy": `npm run dev -w app`, `npm run build -w app`, how to enable Pages (Settings, Pages, Source: GitHub Actions), the resulting URL form.

### Tests (`app/tests/build.test.ts`)
- Runs `vite build` programmatically (`build()` from `vite`) into a temp directory with `base` left at `./`: `index.html` contains no `src="/"`, `href="/"` or `http` URL; every asset it references exists in the output and is referenced relatively.
- The built CSS contains no `http://` or `https://` and passes the same banned-pattern checks as `theme-lint`.
- Serving the output under a sub-path: a tiny static file server in the test serves the directory at `/vba-necromancer/` and the test fetches `index.html` and each referenced asset by resolving the relative URLs against `http://localhost:<port>/vba-necromancer/`; all return 200. (This is test-time server code, not part of the app.)
- Total gzip size is under 600 KB; the test prints the number.
- The workflow file parses as YAML and contains `upload-pages-artifact` with path `app/dist`.

---

## UTASK-23: Accessibility sweep and manual checklist

**Status: Done**

**Requires:** UI-9.1 to UI-9.7, UI-10.1, UI-13.3
**Design:** 11

### What to do
1. Run `axe-core` (without `color-contrast`) on the ready state after loading each demo and after a run, with a trace row selected: fix any violation.
2. Keyboard-only test in `app/tests/ui/keyboard.test.tsx`: from the skip link, Tab through the ready state and assert the order (skip link, file actions, macro Run buttons, result bar, download, grid, source, side tabs), and that no element with `tabindex` greater than 0 exists.
3. Write `docs/ui-checklist.md` with the manual checks: keyboard-only walk through the demo; 375 px in Chrome device mode and one real phone; browser zoom 200 percent; light and dark (system setting) for each view; high-contrast mode; screen reader smoke test (VoiceOver: load demo, run, read the result, select a trace row); offline reload (disconnect, reload from cache or a local build, run the demo); download opened in LibreOffice or Excel; the real gzip size and the measured times from UTASK-21. Each item has a result field (pass, fail, date, browser) that is filled in by a person.

### Tests
- `axe` has no violations in four states (empty, ready before a run, after a run, with a selection).
- The tab-order test passes.
- `docs/ui-checklist.md` exists and has all items listed above (a test that reads the file and checks for the headings).

---

## UTASK-24: Docs and status update

**Status: Done**

**Requires:** UI-13.3, project principles
**Design:** 8, section 1 of requirements (scope)

### What to do
1. README: change "Browser UI | in progress" to the true state (what works, and the limits listed in the Scope section: no button reading, no `.xls` VBA, no recalculation, no number formats), add the live demo link placeholder (to be filled after the first deploy), screenshots only if made from the demo workbook.
2. `docs/demo-script.md`: add a note that the 0:30 to 0:50 row ("the button found on the sheet") is not met by this spec and what the app shows instead (the macro list); do not change the voice-over silently.
3. `BACKLOG.md`: add items that came out of this spec: `endLine` on `ProcedureDecl` for exact prediction spans; button reading (existing item 2) as the prerequisite for the demo-script line; formula recalculation; number formats.
4. `docs/kiro-usage.md`: add a short factual entry for this spec (what Kiro produced and which tasks it implemented), written after the tasks are done, from `git log`.

### Tests
- None new. `npm test`, `npm run typecheck`, `npm run lint` and `npm run build -w app` pass.
