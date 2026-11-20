# Tasks: sheet-buttons

Ordered so each task builds on the previous one. After every task `npm test`, `npm run lint`, `npm run typecheck` and `npm run build -w app` are green. IDs use the `STASK-` prefix to avoid clashing with `TASK-` (core), `DTASK-` (dictionary) and `UTASK-` (UI). Design references are to `design.md`.

Rules for every task:
- Do not edit `fixtures/expected/*.json` (hand-written oracles, guarded by a hook). Do not edit `packages/vba` or `packages/ovba`.
- No `any` in `packages/*` or `app/src`. No `dangerouslySetInnerHTML`. No network calls.
- Each task adds its own tests in the same change. All user-visible strings are in English.
- Commit messages in English, imperative mood.

Status of every task is given under its heading.

---

## STASK-01: Sheet bounds and a fast `Range.End`

**Status:** Done  
**Requires:** END-01, END-02  
**Design:** sections 6.1 to 6.3

### What to do
1. `packages/workbook/src/range.ts`: add the optional `lastRowBound?()` and `lastColBound?()` to `RangeSheet`.
2. `end`: in the scan over empty cells only, apply the four jumps of 6.3. Leave the filled-block branch and the out-of-sheet check as they are. Without the bound methods the old walk runs.
3. `packages/workbook/src/adapter.ts`: implement both methods on `SheetJSSheet` from the cells present (one pass over the keys that do not start with `!`, cached), grow them in `setCellValue`, mark the cache stale when a delete touches the bound. Do not read `!ref`.

### Tests (`packages/workbook/tests/end.test.ts`)
- Four directions on small hand-made sheets: filled block, gap, empty column, start in the last cell, start at the sheet edge.
- Stale dimension: a sheet with `!ref` `A1:A2` and a value in `A4`; `Cells(1048576, 1).End(xlUp)` returns row 4. Same after `setCellValue` far outside the old `!ref`, and after a delete at the bound.
- Empty sheet; cells at row 1 048 576 and column 16 384; `xlToLeft` from column 16 384.
- Call count: a `RangeSheet` stub that counts `getCellValue` calls; data to row 40, `End(xlUp)` from row 1 048 576 makes fewer than 100 reads.
- Property (fast-check), END-01: random sparse sheets, start cell, direction and interleaved set/delete. A verbatim copy of the old `end` loop is the reference. Runs against a Map-backed stub with exact bounds and with bounds that are too high. About 200 runs.
- Property on `SheetJSSheet` with stale `!ref` cases (about 30 runs).
- All existing workbook and vba tests still pass.

---

## STASK-02: Un-skip the UI-12.1 budget test

**Status:** Done  
**Requires:** END-03  
**Depends on:** STASK-01  
**Design:** section 6.4 (last item)

### What to do
1. `app/tests/perf.test.ts`: change `it.skip` to `it` for "exhume + resurrect takes under 100 ms (median of 5 after a warm-up)" and remove the comment that explains the skip. Keep the 400 ms regression guard.
2. Run the test five times in a row on a quiet machine and record the medians in the commit message. If it does not pass, do not raise the budget: report the numbers and stop.
3. `BACKLOG.md`: strike item 8 and note "Done, see sheet-buttons".
4. `docs/ui-checklist.md`: replace the "skipped" note on the performance row with the measured numbers.

### Tests
- The un-skipped test is the test.
- `npm test` is green with no skipped perf test.

---

## STASK-03: Tolerant XML scanner

**Status:** Done  
**Requires:** BTN-01, BTN-02 (foundation)  
**Design:** section 2.1

### What to do
1. `packages/workbook/src/xml.ts`: `scanXml`, `decodeEntities`, `XmlToken` as in 2.1. Local lower-cased names, attributes with single or double quotes or none, never throws.

### Tests (`packages/workbook/tests/xml.test.ts`)
- Open, close, self-closing, text; prefixed names become local names; attribute quoting styles.
- `<br>` without a close followed by more tags; comments, `<?xml ?>`, CDATA.
- Entities: the five named ones, `&#1044;` and `&#x414;`; an unknown entity stays as written.
- Unterminated tag at the end: earlier tokens are returned, no throw.
- Property (fast-check): `scanXml` never throws on arbitrary strings.

---

## STASK-04: Macro reference parser

**Status:** Done  
**Requires:** BTN-03 (string part)  
**Design:** section 2.7 (first table)

### What to do
1. `packages/workbook/src/macroRef.ts`: `parseMacroRef(ref)` returning `{ book, qualified }`.
2. Export it from `index.ts`.

### Tests (`packages/workbook/tests/macroRef.test.ts`)
- Every row of the table in 2.7: `[0]!Module1.BuildActs`, `'Book.xlsm'!BuildActs`, `Book.xlsm!BuildActs`, `Module1.BuildActs`, `BuildActs`, `[2]!Foo`.
- Quoted name that contains `!` and a doubled `''`.
- Cyrillic names (`[0]!Модуль1.Акты`).
- Empty string and surrounding spaces give `{ book: null, qualified: "" }` and trimmed text.
- Property: never throws on arbitrary strings.

---

## STASK-05: Find the drawings of each sheet through the relationships

**Status:** Done  
**Requires:** BTN-04  
**Depends on:** STASK-03  
**Design:** section 2.3

### What to do
1. `packages/workbook/src/drawings.ts`: `locateDrawings(workbookXml, workbookRels, sheetRels)`; `sheetRels` is a map from sheet part path to its rels XML. Relative and absolute targets, `..` segments, both drawing kinds.

### Tests (`packages/workbook/tests/drawings.test.ts`, hand-written XML strings)
- One sheet, one VML drawing; one sheet with a VML and a DrawingML drawing.
- BTN-04: `sheet1.xml` points at `vmlDrawing2.vml` and `sheet2.xml` at `vmlDrawing1.vml`; a sheet order in `workbook.xml` that differs from the part numbers; the result names the right sheet for each part.
- Absolute target `/xl/drawings/drawing1.xml`; target with `../`.
- Sheet without a rels file; a relationship of another type (hyperlink, comments) is ignored.
- Sheet name with `&amp;` and Cyrillic characters.

---

## STASK-06: Form Control buttons from VML

**Status:** Done  
**Requires:** BTN-01  
**Depends on:** STASK-03  
**Design:** section 2.4

### What to do
1. `packages/workbook/src/vml.ts`: `parseVmlButtons(xml)` with the fields, anchor fallbacks and caption rules of 2.4.

### Tests (`packages/workbook/tests/vml.test.ts`)
- A button as Excel writes it, with `<x:Anchor>` `7, 15, 1, 4, 9, 15, 3, 4` gives anchor `H2`, macro and caption.
- Anchor from `<x:Row>` and `<x:Column>` when `x:Anchor` is missing; neither gives `null`.
- Caption with nested `<font>`, an unclosed `<br>`, entities, and extra whitespace; Cyrillic caption.
- A `ClientData` with another `ObjectType` (`Drop`, `Checkbox`) is ignored; a button with empty or missing `FmlaMacro` is ignored (BTN-08).
- Two buttons in one drawing keep document order.
- Macro text is returned untouched (`[0]!Module1.BuildActs`).

---

## STASK-07: Shapes with a macro from DrawingML

**Status:** Done  
**Requires:** BTN-02  
**Depends on:** STASK-03  
**Design:** section 2.5

### What to do
1. `packages/workbook/src/shapes.ts`: `parseDrawingShapes(xml)`; stack of the enclosing anchor; caption from `a:t`, else `cNvPr` name.

### Tests (`packages/workbook/tests/shapes.test.ts`)
- `xdr:sp` in a `twoCellAnchor` with `macro="Module1.BuildActs"` and text in two paragraphs gives the joined caption and anchor from `xdr:from`.
- `xdr:pic` with a macro and no text: caption is the name.
- `oneCellAnchor`; `absoluteAnchor` gives `anchor: null`.
- Shape inside `xdr:grpSp`; shape inside `mc:AlternateContent`.
- `macro=""` or no `macro` attribute: not listed (BTN-08). A `graphicFrame` with a macro is not listed.
- XML entities and Cyrillic text in `a:t`.

---

## STASK-08: `readButtons`

**Status:** Done  
**Requires:** BTN-01, BTN-02, BTN-04, BTN-08  
**Depends on:** STASK-04, STASK-05, STASK-06, STASK-07  
**Design:** section 2.2 and 2.6

### What to do
1. `packages/workbook/package.json`: add `fflate` (same version as `packages/ovba`).
2. `packages/workbook/src/buttons.ts`: `readButtons(bytes): ButtonReadResult` with `RawButton` and `ButtonReadResult`; selective `unzipSync` filter; per-part `try`; ordering of 2.6.
3. Export `readButtons` and the types from `index.ts`.

### Tests (`packages/workbook/tests/buttons.test.ts`, ZIPs built with `zipSync` in the test)
- A workbook with one VML button and one DrawingML shape on different sheets: both listed, in sheet order, with the right sheet names.
- No drawings, or drawings without macros: `{ buttons: [], problems: [] }` (BTN-08).
- Bytes that are not a ZIP (a CFB header, random bytes, empty): `{ buttons: [], problems: [] }`, no throw.
- A broken VML part: a `problems` line with the part name; the other drawing still read.
- A relationship that names a part missing from the ZIP: a `problems` line.
- Ordering: same sheet, form control and shape, anchors out of order.
- Only the listed parts are inflated (a test that passes a ZIP with a corrupt unrelated entry, such as `xl/worksheets/sheet1.xml`, and still gets the buttons).

---

## STASK-09: Fixture builder writes real Form Control buttons

**Status:** Done  
**Requires:** BTN-07  
**Design:** section 5

### What to do
1. `fixtures/build/build.ts`: add `buttons?` to `CellsJson`; write the VML part, the sheet rels, `<legacyDrawing r:id="rId1"/>` and the `vml` default content type for each sheet with buttons; qualify the macro with the module name; unknown sheet name throws. Fixtures without buttons must produce the same `xl/` parts as before.
2. Run `npm run fixtures:build`. Only `demo_acts.xlsm` and `demo_invoice.xlsm` change.
3. Run `.venv-tools/bin/python tools/crosscheck_olevba.py` (see the header of the script for setup); every fixture still reads identically.
4. Do not edit `fixtures/src/*/cells.json` or `fixtures/expected/*.json`.

### Tests
- `app/tests/build.test.ts` (or a new `fixtures-buttons.test.ts` next to it): unzip the built `demo_invoice.xlsm` and check the VML part, the sheet rels target, the `legacyDrawing` element and the content type; check the escaped Cyrillic caption in `demo_acts.xlsm`.
- `readButtons` over both built files returns exactly: `Log`, `Build invoice`, `H2`, macro `Module1.BuildInvoice`; `Журнал`, `Сформировать акты`, `H2`, macro `Module1.BuildActs`.
- Every other built fixture has no drawing parts and `readButtons` returns no buttons.
- Building twice gives identical bytes.
- `app/tests/model/demo.test.ts` (bundled demos equal the built files) stays green.

---

## STASK-10: Resolve buttons to macros and add them to `Exhumed`

**Status:** Done  
**Requires:** BTN-03, BTN-08  
**Depends on:** STASK-08, STASK-09  
**Design:** sections 2.7 (second part) and 3

### What to do
1. `app/src/model/types.ts`: add `ButtonInfo`, and `buttons: ButtonInfo[]` and `buttonProblems: string[]` to `Exhumed`.
2. `app/src/model/buttons.ts`: `resolveButtons(raw, macros, fileName)` with the four rules and the note texts of 2.7. No Preact or DOM imports.
3. `app/src/model/exhume.ts`: in `exhumeParts` call `readButtons(bytes)` and `resolveButtons`. Update any test helper that builds an `Exhumed` by hand so it compiles.

### Tests
- `app/tests/model/buttons.test.ts`: `[0]!Module1.BuildActs`, `'Book.xlsm'!BuildActs` (file named `Book.xlsm`), `Module1.BuildActs`, `BuildActs`, mixed case; a reference to a missing macro; a reference to another workbook (`'Other.xlsm'!X`, `[2]!X`); a name that exists in two modules (ambiguous, no Run action, note says so); a Private Sub and a Function; prediction copied from the macro (same object).
- `app/tests/model/exhume.test.ts`: the built `demo_invoice.xlsm` and `demo_acts.xlsm` give exactly one resolved button each, with sheet, caption, anchor and macro id from the acceptance list; `labour_statement.xlsm` and the other fixtures give `[]`; a plain `.xlsx` gives `[]` and `[]`; a `.xls` (CFB) gives `[]` and no throw.
- Existing exhume tests unchanged and green (BTN-08).

---

## STASK-11: "Buttons on sheets" in the Exhume panel

**Status:** Done  
**Requires:** BTN-05  
**Depends on:** STASK-10  
**Design:** section 4.1

### What to do
1. `app/src/ui/ExhumePanel.tsx`: add `ButtonList` above `MacroList`, rendered only when there are buttons or problems.
2. Run action calls `actions.runMacro(macroId)`; accessible name `Run button <caption>`, with ` on <sheet> <anchor>` appended for duplicate captions; result line like `MacroList`; unresolved buttons show the note and no Run button.
3. `app/src/styles/components.css`: reuse the `macro-list` classes; add only what is missing, using tokens.

### Tests (`app/tests/ui/buttons.test.tsx`)
- With `demo_invoice.xlsm` exhumed: heading "Buttons on sheets" appears before "Macros"; the item shows "Build invoice", "Log, H2", "Module1.BuildInvoice" and the prediction; `getByRole("button", { name: "Run button Build invoice" })` exists.
- Clicking it starts the same run as `Run Module1.BuildInvoice`: same state transitions and same trace (compare the reducer state after both).
- Result line after a run; both Run buttons are disabled while running.
- Unresolved button: the note text "Macro not found" is shown and there is no Run button for it.
- Duplicate captions give two different accessible names.
- No drawings: no "Buttons on sheets" heading; the panel markup equals the markup before this change (snapshot-free: assert the headings present).
- A `problems` entry is shown.
- axe has no violations on the panel with buttons.
- Existing `exhume.test.tsx`, `layout.test.tsx`, `keyboard.test.tsx` still pass.

---

## STASK-12: Button marks in the grid

**Status:** Done  
**Requires:** BTN-06  
**Depends on:** STASK-10  
**Design:** section 4.2

### What to do
1. `app/src/model/format.ts`: add `parseCellRef("H2")` returning `{ row, col }` if no equivalent exists.
2. `app/src/ui/GridView.tsx`: build the marks map for the visible sheet and pass `marks` to `Grid`.
3. `app/src/ui/Grid.tsx`: optional `marks` prop; render `<span class="grid-mark" aria-hidden="true">` after the value in marked cells; no new handlers, no `tabindex`.
4. `app/src/styles/components.css` and `tokens.css`: flex cell layout, ellipsis, small font, `pointer-events: none`, colours from tokens.

### Tests
- `app/tests/model/format.test.ts`: `parseCellRef` for `A1`, `H2`, `AA10`, `$B$3`, and an invalid reference.
- `app/tests/ui/grid.test.tsx`: the anchor cell shows the caption; a marked cell that holds a value still has the value as text content and as accessible name, and the mark is `aria-hidden` and not focusable; unmarked cells are unchanged; marks appear only for the visible sheet (switch sheets); a mark on a cell outside the rendered window does not render.
- `app/tests/ui/keyboard.test.tsx`: arrow keys, Home, End, PageUp and PageDown move across a marked cell exactly as across an unmarked one.
- `app/tests/theme-lint.test.ts` and `tokens.test.ts` still pass (no raw colours, contrast).
- axe has no violations on the grid with a mark.
- End to end with the built demos: open `demo_invoice.xlsm` in the app model and find the mark "Build invoice" in cell H2 of `Log`.

---

## STASK-13: Docs and backlog

**Status:** Done  
**Requires:** BTN-05, BTN-07  
**Depends on:** STASK-11, STASK-12

### What to do
1. `BACKLOG.md`: strike items 2 and 10 ("Done, see sheet-buttons"); item 8 was struck in STASK-02. Add a new item for buttons in `.xls` files (BIFF `OBJ` records), not read.
2. `docs/demo-script.md`: the 0:30 to 0:50 row now matches what the app shows ("Buttons on sheets", the mark in H2, Run from the button).
3. `docs/ui-checklist.md`: add rows for the button list, the grid mark and the keyboard check; add a manual row "open `fixtures/build/demo_invoice.xlsm` in desktop Excel and click the button" marked "not verified in Excel yet".
4. `docs/kiro-usage.md`: one paragraph on how this spec was written and what it caught (for the write-up).
5. `docs/sheet-buttons.md`: one page on what is read (VML and DrawingML), reference forms, limits (`.xls`, charts, absolute anchors, the book-prefix assumption), and why `Range.End` uses bounds.

### Tests
- None new. Run the four commands (`npm test`, `npm run lint`, `npm run typecheck`, `npm run build -w app`) and `tools/crosscheck_olevba.py`; all green.
- Check that every requirement id BTN-01..08 and END-01..03 appears in at least one test name or describe title (`grep -rn "BTN-0\|END-0" packages app/tests`).
