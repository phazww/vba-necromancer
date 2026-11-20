# Design: Sheet buttons and a fast Range.End

Implements BTN-01..BTN-08 and END-01..END-03 (see `requirements.md`). Changes are in `packages/workbook` (button reader, `end` bounds), `fixtures/build`, and `app`. `packages/vba` and `packages/ovba` are not touched. No network access anywhere. `fixtures/expected/*.json` are not edited.

## 1. Where it plugs in

| Concern | Today | Change |
|---|---|---|
| Macro list | `app/src/model/macros.ts` `listMacros`, ids are `Module.Name` | unchanged; buttons resolve to these ids |
| Reading the file | `exhumeParts` in `app/src/model/exhume.ts` opens the workbook with `openWorkbook` and reads VBA with `extractModules` | one more call, `readButtons(bytes)`, from `packages/workbook`; result stored as `Exhumed.buttons` |
| Running | `actions.runMacro(macroId)` | unchanged; a button calls it with the resolved id (BTN-05) |
| Fixture builder | `fixtures/build/build.ts` ignores `buttons` in `cells.json` | writes VML, sheet rels, `legacyDrawing` (BTN-07) |
| `Range.End` | `SheetRange.end` steps one cell at a time | jumps over empty runs using sheet bounds (END-02) |

The `buttons` array in `cells.json` already exists in `demo_acts` and `demo_invoice` (`sheet`, `text`, `macro`, `anchor`). Its shape does not change.

## 2. Reading buttons (`packages/workbook`)

The package does not read drawings today: SheetJS drops them. A new module reads them straight from the ZIP.

New files in `packages/workbook/src/`:

| File | Content |
|---|---|
| `xml.ts` | a small tolerant tag scanner |
| `macroRef.ts` | `parseMacroRef` (BTN-03, the string part) |
| `drawings.ts` | `locateDrawings` (BTN-04) |
| `vml.ts` | `parseVmlButtons` (BTN-01) |
| `shapes.ts` | `parseDrawingShapes` (BTN-02) |
| `buttons.ts` | `readButtons(bytes)`: unzip, locate, parse, merge |

`index.ts` exports `readButtons`, `parseMacroRef` and the types. `fflate` becomes a direct dependency of `packages/workbook` (same version as `packages/ovba`, already in the lockfile). It is used with `unzipSync(bytes, { filter })` so only the needed parts are inflated, which keeps the UI-12.1 budget.

### 2.1 Why not `DOMParser`

`DOMParser` does not exist in the Node test environment of `packages/*`, and VML is not well-formed XML: Excel writes `<br>` and attribute values with stray quotes. `xml.ts` is a scanner, not a parser:

```ts
export type XmlToken =
  | { kind: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string };
export function scanXml(xml: string): XmlToken[];
export function decodeEntities(s: string): string;   // &amp; &lt; &gt; &quot; &apos; &#N; &#xH;
```

Names are lower-cased local names (`x:ClientData` becomes `clientdata`), so a file that uses other prefixes for the same namespace still reads. Attribute names are also local and lower-cased. The scanner never throws. Comments, `<?...?>` and CDATA are skipped or returned as text. An unterminated tag ends the scan; what was read stays.

### 2.2 Types

```ts
export interface RawButton {
  /** Sheet name from xl/workbook.xml. */
  sheet: string;
  /** Visible text. For a shape without text: its name. */
  caption: string;
  /** "H2", top-left cell; null when the drawing has no cell anchor (absoluteAnchor). */
  anchor: string | null;
  /** The macro exactly as stored, e.g. "[0]!Module1.BuildActs". */
  macroRef: string;
  source: "form-control" | "shape";
}
export interface ButtonReadResult {
  buttons: RawButton[];
  /** One readable line per drawing part that could not be read. */
  problems: string[];
}
```

### 2.3 Finding the drawings of a sheet (BTN-04)

`locateDrawings(workbookXml, workbookRels, sheetRels)` returns `{ sheet: string; part: string; kind: "vml" | "drawingml" }[]`:

1. `xl/workbook.xml`: each `<sheet name r:id>` (attribute `r:id`, local name `id`) gives sheet name and relationship id.
2. `xl/_rels/workbook.xml.rels`: the id gives `Target`, resolved against `xl/` (a target starting with `/` is relative to the package root). That is the sheet part, for example `xl/worksheets/sheet3.xml`.
3. `<dir>/_rels/<file>.rels` of that part: every relationship whose `Type` ends in `/vmlDrawing` is a VML drawing, one that ends in `/drawing` is DrawingML. Targets are resolved against the part's directory (`../drawings/vmlDrawing2.vml` becomes `xl/drawings/vmlDrawing2.vml`).

File numbers are never compared. The tests use a workbook whose `sheet1.xml` points at `vmlDrawing2.vml` and `sheet2.xml` at `vmlDrawing1.vml`, and a sheet order that differs from the part order.

A missing rels file or a missing target part means "no drawing"; a part named by a relationship but absent from the ZIP is a `problems` line.

### 2.4 Form Control buttons, VML (BTN-01)

`parseVmlButtons(xml): { caption; anchor; macroRef }[]`. A `<v:shape>` is a button when its `<x:ClientData ObjectType="Button">` has a non-empty `<x:FmlaMacro>`. Buttons without a macro are skipped (BTN-08).

| Field | Source |
|---|---|
| macroRef | text of `FmlaMacro` |
| anchor | first and third numbers of `<x:Anchor>` (`leftCol, dx, topRow, dy, rightCol, ...`), both 0-based. When `Anchor` is missing, `<x:Column>` and `<x:Row>` (0-based). Neither: `null`. |
| caption | all text inside `<v:textbox>`, tags removed, entities decoded, `<br>` as a space, whitespace collapsed and trimmed. Empty: the shape's `o:spid`/`id`, which is the closest thing to a name; the UI then shows it as is. |

The scanner works on tokens, so a stray `<br>` without a close does not shift the rest.

### 2.5 Shapes with a macro, DrawingML (BTN-02)

`parseDrawingShapes(xml)`. An `xdr:sp` or `xdr:pic` with a non-empty `macro` attribute is listed. Shapes inside `xdr:grpSp` and inside `mc:AlternateContent` are found because the scan is flat: the anchor is the nearest enclosing `twoCellAnchor`, `oneCellAnchor` or `absoluteAnchor`, tracked with a stack while scanning.

| Field | Source |
|---|---|
| macroRef | `macro` attribute |
| anchor | `xdr:from` `xdr:col` and `xdr:row` (0-based) of the enclosing anchor; `absoluteAnchor`: `null` |
| caption | `a:t` texts of the shape, one space between paragraphs; when empty, the `name` of `xdr:cNvPr` |

A `sp` that is a connector or a textbox without a macro is skipped. `graphicFrame` (charts) is not read: out of scope of BTN-02.

### 2.6 `readButtons`

1. `kind` is not ZIP (a `.xls`, or bytes that do not unzip): `{ buttons: [], problems: [] }`. `.xls` buttons live in the BIFF stream; this is not covered and is said so in the docs (see 6).
2. Unzip only `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/_rels/*.rels`, `xl/drawings/*.vml`, `xl/drawings/drawing*.xml`.
3. `locateDrawings`, then parse each part in its own `try`; an exception becomes a `problems` entry with the part name and the message, the other parts still count.
4. Sort by sheet order in the workbook, then anchor row, anchor column (no anchor last), then form controls before shapes.

### 2.7 Macro references (BTN-03)

`parseMacroRef(ref): { book: string | null; qualified: string }`:

| Stored | `book` | `qualified` |
|---|---|---|
| `[0]!Module1.BuildActs` | `null` (index 0 is this workbook) | `Module1.BuildActs` |
| `'Book.xlsm'!BuildActs` | `Book.xlsm` | `BuildActs` |
| `Book.xlsm!BuildActs` | `Book.xlsm` | `BuildActs` |
| `Module1.BuildActs` | `null` | `Module1.BuildActs` |
| `BuildActs` | `null` | `BuildActs` |
| `[2]!Foo` (index other than 0) | `[2]` | `Foo` |

A quoted name can contain `!` and `'` (doubled `''`); the parser reads the quotes first. A `!` that is not preceded by a quoted name or a bracket index splits at the first `!`.

Resolution against the macro list lives in the app (`app/src/model/buttons.ts`), because it needs `Exhumed.macros`:

```ts
export interface ButtonInfo extends RawButton {
  macroId: string | null;          // "Module1.BuildActs" when resolved
  note: string | null;             // why it has no Run action
  prediction: MacroInfo["prediction"] | null;   // the same object as the macro's
}
export function resolveButtons(raw: RawButton[], macros: MacroInfo[], fileName: string): ButtonInfo[];
```

Rules, in this order:

1. `book` is a name and it differs from `fileName` (case-insensitive) or is `[n]` with n other than 0: `macroId: null`, note `Macro not found: it belongs to another workbook (Book.xlsm).`
2. `qualified` contains a dot: match `macro.id` case-insensitively. No match: not found.
3. No dot: match `macro.name` case-insensitively. One match: resolved. More than one (same name in two modules): not resolved, note `Macro not found: BuildActs exists in Module1 and Module2, so the button is ambiguous.` Excel would pick one by its own rules; we do not guess.
4. Not found: note `Macro not found: BuildActs.`

A resolved button copies `prediction` from the macro, so the button and the list always agree. The macro list is limited by `listMacros` (Subs without parameters, not Private). A button that names a Private Sub or a Function is therefore "not found" with the same text; this is the same set Excel's Macros dialog shows, and a Private Sub assigned to a button fails in Excel too.

Assumption on rule 1: Excel writes the author's file name. A copy of the file under another name (`Book (2).xlsm`) would make every prefixed button dead. This only affects references with a book prefix; Excel itself writes the bare or `Module1.` form for the same workbook. If that assumption proves wrong on real files, rule 1 becomes "ignore the book name" in one line, and the test list says which test to change.

## 3. Exhume state (`app`)

`Exhumed` gets two fields: `buttons: ButtonInfo[]` and `buttonProblems: string[]`. `exhumeParts` computes them after `listMacros` and `predictMacro`. A workbook with no drawings gives `[]` and `[]`, and nothing in the UI changes (BTN-08). `exhumeParts` must not throw on a bad drawing: `readButtons` already turns it into a problem line.

The demo bytes are bundled (`app/src/model/demo.ts` with `?inline`) from `fixtures/build/*.xlsm`, so rebuilding the fixtures changes the demos with no other step. `demo.test.ts` compares both byte for byte and stays green.

## 4. UI (BTN-05, BTN-06)

### 4.1 "Buttons on sheets" in the Exhume panel

A new `ButtonList` in `app/src/ui/ExhumePanel.tsx`, rendered above `MacroList`. Not rendered when `buttons` is empty.

```
<h3>Buttons on sheets</h3>
<ul class="plain-list macro-list">
  <li class="macro">
    <div class="macro-head">
      <span class="name">Build invoice</span>
      <button class="button button--primary" aria-label="Run button Build invoice">Run</button>
    </div>
    <p class="muted">Log, H2. Calls Module1.BuildInvoice.</p>
    <p class="muted">{predictionText}</p>
    <p class="actual">Result: ...</p>          // same rule as MacroList: run.macroId === button.macroId
  </li>
</ul>
```

- Unresolved: no Run button, the `note` in its place, styled as muted text (not colour alone; the text says "Macro not found").
- No anchor: the line reads `Log. Calls ...`.
- Two buttons with the same caption get ` on Log H2` appended to the accessible name only, so each Run button has a unique name; with unique captions the name is exactly `Run button <caption>`.
- `disabled={running}` and `aria-busy` as in `MacroList`.
- Click calls `actions.runMacro(button.macroId)`. There is no second run path, so the trace, graveyard, download and result bar behave exactly as for the list (BTN-05).
- `buttonProblems` render as one muted line each below the list, and also when `buttons` is empty but a problem exists, under the same heading.
- Folding on narrow screens follows `SheetList` and `ModuleList`: this list is not folded, because it holds the primary actions.

### 4.2 Marks in the grid (BTN-06)

`GridView` builds a `Map<cellKey, string>` of `row*16385+col` to caption for the visible sheet (the same key as `changes.ts`) and passes it as an optional prop `marks` to `Grid`. The anchor `H2` is converted with the existing `colLetters` inverse in `model/format.ts` (add `parseCellRef` there if it does not exist).

In a cell with a mark, `Grid` renders the value and then
`<span class="grid-mark" aria-hidden="true">{caption}</span>`.

- The cell becomes `display: flex`; the value text takes `flex: 1 1 auto; min-width: 0` and the mark is `flex: 0 1 auto; max-width: 50%`, ellipsis, small font, `pointer-events: none`. The mark takes layout space beside the value, so it never overlays text. The value stays in the DOM unchanged.
- `aria-hidden` keeps the accessible name of the `gridcell` equal to its value, so screen-reader output and the tests that read cell names do not change. The same information is available in the Exhume panel.
- It is not focusable and has no handler. The roving tabindex, arrow keys, Home/End and PageUp/PageDown in `useRovingFocus` are untouched; the key handler stays on the cell element.
- Colours come from tokens in `styles/tokens.css`; the existing contrast and theme-lint tests apply.
- Windowing: marks are looked up per rendered cell, so only visible cells pay.

## 5. Fixture builder (BTN-07)

`build.ts` already parses `cells.json`; `CellsJson` gets `buttons?: { sheet; text; macro; anchor }[]`.

For every sheet that has buttons (matched by `sheet` name; an unknown name throws, so a typo in `cells.json` fails the build):

| Part | Content |
|---|---|
| `xl/drawings/vmlDrawing<N>.vml` | the standard `o:shapelayout`, `v:shapetype id="_x0000_t201"` (`o:spt="201"`), and one `v:shape` per button with `<x:ClientData ObjectType="Button">`, `<x:Anchor>`, `<x:FmlaMacro>`, `<x:TextHAlign>`, `<x:TextVAlign>`, `<x:Row>`, `<x:Column>`, and `<v:textbox><div style='text-align:center'><font ...>caption</font></div></v:textbox>` |
| `xl/worksheets/_rels/sheet<K>.xml.rels` | one relationship of type `.../relationships/vmlDrawing` to `../drawings/vmlDrawing<N>.vml` |
| `xl/worksheets/sheet<K>.xml` | `<legacyDrawing r:id="rId1"/>` after `sheetData`; the root gets `xmlns:r` |
| `[Content_Types].xml` | `<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>` |

`N` counts buttons-bearing sheets from 1; `K` is the sheet number. The two numbers differ in a fixture with a button on the second sheet only; no test relies on them being equal (BTN-04).

Details:

- Anchor: from `H2` the top-left is column 7, row 1 (0-based). `x:Anchor` is `7, 15, 1, 4, 9, 15, 3, 4`: two columns wide, two rows high, with the usual offsets. `x:Row` is 1, `x:Column` is 7.
- `x:FmlaMacro` is `Module1.<macro>`: the builder prefixes the module name it writes into `dir` when `macro` has no dot. The acceptance text "macro Module1.BuildInvoice" is read from this. `cells.json` stays as is.
- Caption and macro text go through `escapeXml`. The Cyrillic caption is written in UTF-8, and the VML part carries an XML declaration with `encoding="UTF-8"`.
- A `ctrlProps` part is not written. Excel 2007 and later read a button from the VML alone (the `x14` `controls` block is a second copy that Excel adds when it saves). This could not be verified on a desktop Excel in this environment; see Risks.
- Output is deterministic: same input, same bytes (no timestamps). The `fixture-rebuild` hook runs on edits to `fixtures/src/`; `fixtures:build` regenerates every `.xlsm`. Fixtures without `buttons` must come out with identical `xl/` parts to today, so only `demo_acts.xlsm` and `demo_invoice.xlsm` change in content.
- `tools/crosscheck_olevba.py` reads only `xl/vbaProject.bin`, which is untouched; the task still runs it.

## 6. `Range.End` (END-01..END-03)

### 6.1 Current behaviour (the oracle)

`SheetRange.end(direction)` in `range.ts`, for `d = (dr, dc)`:

- if the next cell is outside the sheet: stay;
- else if the start and the next cell are both filled: walk while the next cell is filled;
- else: step once, then keep stepping until a filled cell, or until the next step would leave the sheet.

"Filled" is `getCellValue(r, c) !== null`. The cost is in the last branch: from row 1 048 576 going up through empty rows is a million `getCellValue` calls.

### 6.2 Bounds in the sheet

`RangeSheet` (in `range.ts`) gets two optional members:

```ts
/** Upper bound of the row (column) of any cell that exists; 0 when the sheet has no cell. */
lastRowBound?(): number;
lastColBound?(): number;
```

Optional, so another `RangeSheet` (tests, other adapters) keeps working with the old walk.

`SheetJSSheet` implements them from the cells actually present, never from `!ref`:

- First call: one pass over `Object.keys(ws)` skipping keys that start with `!`, decoding each with `XLSX.utils.decode_cell`, keeping the maximum row and column. This is O(cells), once per sheet object, not per call.
- `setCellValue` with a value: `maxRow = max(maxRow, row)`, same for columns.
- `setCellValue` with `null` (delete): bounds stay as they are. They are upper bounds, so a larger-than-needed value is still correct; the walk below handles the empty rows between the bound and the real last cell. When the deleted cell was at the bound, the cache is marked stale and the next call recomputes it with the one pass.
- Cells that exist but read as empty (`cellToValue` gives `null`) count towards the bound for the same reason: the bound may be too high, never too low.

`growRef` and `usedRowCount` are unchanged. `!ref` is never read for this.

### 6.3 Jumps in `end`

Only the scan over empty cells (the third branch) changes. With `bound` the bound for the axis of `d` (`lastRowBound` for up/down, `lastColBound` for left/right):

| Direction | Condition inside the scan loop | Jump |
|---|---|---|
| `xlUp` | current row `> max(bound, 1)` | set row to `max(bound, 1)` |
| `xlLeft` | current col `> max(bound, 1)` | set col to `max(bound, 1)` |
| `xlDown` | current row `>= bound` | set row to `MAX_ROWS` (nothing below can be filled) |
| `xlRight` | current col `>= bound` | set col to `MAX_COLS` |

After the jump the loop continues as before from the new position: for up and left it examines that cell, for down and right it ends at the sheet edge. Every skipped cell lies beyond all existing cells, so each would have read as empty and the old loop would have stepped over it. The result is the same cell. The first branch (both cells filled) needs no change: it walks inside a block of existing cells.

Cost after the change: `end(xlUp)` from row 1 048 576 does one `getCellValue` per step from the real last row up, one read per row between the last filled row and the start of the block. A sheet with 5 000 rows costs at most 5 000 reads, only when the column is empty near the bottom.

### 6.4 Tests

- Unit tests in `packages/workbook/tests/end.test.ts` on `SheetJSSheet`: the four directions on small sheets, a stale `<dimension ref="A1:A2"/>` with a value in `A4` (a sheet read from a hand-built xlsx and a sheet object built with `aoa_to_sheet` whose `!ref` is then overwritten), an empty sheet, a sheet after `setCellValue` beyond the old `!ref`, after a delete at the bound, and cells at row 1 048 576 and column 16 384.
- Property test (fast-check): random sparse cell sets (positions drawn from small ranges plus a few at the extremes), random start cell, random direction, random interleaved `set`/`delete`. A reference implementation, a verbatim copy of the old `end` loop that only uses `getCellValue`, runs on a `RangeSheet` stub backed by a `Map` with no bounds methods. The new `end` runs on the same stub with bounds methods that return exact maxima, and again on a stub whose bounds are too high (random extra), because the bound is only an upper bound. Results must be equal. The stub is cheap, so the walk-everything reference stays fast enough with about 200 runs.
- A second, smaller property on `SheetJSSheet` itself (about 30 runs, since each reference walk costs a million `encode_cell` calls on that class) with the stale `!ref` cases mixed in.
- A call-count test: with the stub counting `getCellValue` calls, `Cells(1048576, 1).End(xlUp)` on a sheet with data to row 40 makes fewer than 100 reads. This guards the speed in a unit test that does not depend on the clock.
- `app/tests/perf.test.ts`: remove `it.skip` from the 100 ms budget test and drop the comment about the skipped state; the 400 ms regression guard stays. (END-03)

## 7. Test strategy

- BTN-01..04: unit tests in `packages/workbook/tests/` with small hand-written XML strings, one file per module (`xml.test.ts`, `macroRef.test.ts`, `drawings.test.ts`, `vml.test.ts`, `shapes.test.ts`), and `buttons.test.ts` for `readButtons` over ZIPs made with `zipSync` in the test. The XML samples include a VML `<br>` without close, a CP1251-free Cyrillic caption, a shape inside `grpSp`, `absoluteAnchor`, `macro=""`, and the mismatched file numbers of 2.3.
- BTN-03: `app/tests/model/buttons.test.ts` covers every row of the reference table in 2.7 and the four resolution rules, including ambiguous names, a Private Sub and another workbook.
- BTN-05, BTN-06: component tests in `app/tests/ui/buttons.test.tsx` (labels and `Run button <caption>`, click starts the same run as the list, unresolved has no Run button, no section when there are no buttons, mark is `aria-hidden`, cell name unchanged, arrow keys still move) plus an axe run on the panel, as the other UI tests do.
- BTN-07 and acceptance: `fixtures/build` is exercised by a test in `app/tests/model/exhume.test.ts` that exhumes the built `demo_invoice.xlsm` and `demo_acts.xlsm` and expects exactly one button each with the sheet, caption, anchor and macro from the acceptance list; and a builder test that unzips the output and checks the parts in section 5.
- END: section 6.4.
- Every task runs `npm test`, `npm run lint`, `npm run typecheck`, `npm run build -w app`. `fixtures/expected/*.json` are never edited; the fixture end-to-end tests in `packages/vba` keep passing because VBA and cells are unchanged.

## 8. Risks

- **Real Excel opening the built `.xlsm`.** The VML follows what Excel writes for a legacy Form Control button, but no desktop Excel is available to check. The structural test and `olevba` do not prove it opens. A manual step goes into `docs/ui-checklist.md`, and the docs state "not verified in Excel" until someone does it.
- **Book prefix rule** (2.7 rule 1): it is an assumption, with a one-line fallback.
- **Tolerant scanner.** It accepts input a strict parser rejects, so a damaged drawing may yield a wrong caption instead of an error. Anchors and macros come from attributes or from single elements, so they are not affected by text damage; the caption is.
- **`.xls` buttons** are not read (BIFF `OBJ` records). The UI says nothing about them today and keeps saying nothing; this is listed in the docs as a known gap, not hidden.
- **Sheet-wide bounds.** A sheet with one long column and an empty column 1 still walks column 1 from the long column's last row. That is a bounded walk, and per-column bounds would add state for no stated requirement.
