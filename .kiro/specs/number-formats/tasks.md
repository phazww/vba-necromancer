# Tasks: number-formats

Ordered so each task builds on the previous one. After every task `npm test`, `npm run lint`, `npm run typecheck` and `npm run build -w app` are green. IDs use the `NTASK-` prefix to avoid clashing with `TASK-` (core), `DTASK-` (dictionary), `UTASK-` (UI) and `STASK-` (sheet buttons). Design references are to `design.md`.

Rules for every task:
- Do not edit existing `fixtures/expected/*.json` or `.gitignore` (hand-written oracles). The only new oracle file is `fixtures/expected/number_formats.json`. Do not edit `packages/vba` or `packages/ovba`.
- The table in `requirements.md` is the oracle. Never change an expected value to make a test pass. If a row looks wrong, stop and write why under that task in a "Blocked" note.
- No `any` in `packages/*` or `app/src`. No `dangerouslySetInnerHTML`. No network calls.
- Each task adds its own tests in the same change. Every requirement id appears in at least one test name or describe title.
- Do not commit. Commit messages, when the developer commits, are in English, imperative mood.

Status of every task is given under its heading.

---

## NTASK-01: Number sections, rounding, sections by sign

**Status:** Done  
**Requires:** FMT-02 (General, digit placeholders, `%`, literals, sections, unreadable formats), FMT-03  
**Design:** sections 2.1 to 2.3, 2.5

### What to do
1. `packages/workbook/src/numfmt.ts`: `formatNumber(value, format)` with the parser of 2.2 and the number formatting of 2.3. Date tokens are recognised by the tokeniser but a section that has them returns the plain text until NTASK-02.
2. Export `formatNumber` from `packages/workbook/src/index.ts`.

### Tests
- `packages/workbook/tests/numfmt.test.ts`: one test per table row that is not a date (FMT-02, FMT-03): `0%`, `0.0%`, `#,##0.00`, `#,##0`, `0` with 2.5 and -2.5, `0.00` with 1.005 and 0.5, `#.##`, `000`, the rouble format, `#,##0.00;(#,##0.00)`, `0.00;-0.00;"-"`, `General`, `[Red]0.00`, `# ?/?`. Expected strings are copied from the table.
- Further cases: empty format and `General` in other case; one section with a negative value gets `-`; two sections with zero use the first; `\` escapes; `$` and `€` literals; more than three sections, empty section, `0.00E+00`, `@`, `*`, `_)`, `[>100]0`, `0,` (scaling) and `000-0000` return the plain text; non-finite values; `0.5` with `0` gives `1` and `-0.5` with `0` gives `-1`; large values (`1e20` with `#,##0`).
- Property (app/tests/model/numfmt-property.test.ts, about 200 runs each): `formatNumber(n, "General") === formatValue(n)` for random finite doubles; `formatNumber` never throws on arbitrary format strings and arbitrary doubles including `NaN` and infinities.
- Property: for `0.00` the text, parsed back, is within 0.005 of the input and has exactly two decimals, on random doubles in a safe range.

### Notes
- Found by the property test: the app's `formatValue` throws a `TypeError` for numbers within rounding distance of `Number.MAX_VALUE` (`toPrecision(15)` rounds up to `Infinity`, then `toExponential().split("e")` has no exponent). Not fixed here (out of scope, `formatValue` stays untouched). The formatter's own copy keeps the value in that case, and the General property is limited to magnitudes up to 1e300. Deferred: add to BACKLOG in NTASK-07.

---

## NTASK-02: Date and time formats

**Status:** Done  
**Requires:** FMT-02 (date and time parts), FMT-03 (no binary artefacts in time)  
**Depends on:** NTASK-01  
**Design:** section 2.4

### What to do
1. `packages/workbook/src/numfmt.ts`: date sections as in 2.4, including the month versus minutes rule, English month names, serial range 61..2958465, second-level rounding.

### Tests
- `packages/workbook/tests/numfmt.test.ts`: one test per date row of the table (`yyyy-mm-dd`, `dd.mm.yyyy`, `d mmm yyyy`, `mmmm yy`, `dd.mm.yyyy hh:mm`, `h:mm`). Expected strings from the table.
- Further: serial 61 (1900-03-01) and 60 and 0 (plain), a negative serial (plain), 2958465 (9999-12-31) and 2958466 (plain); `mm:ss` reads minutes then seconds; `hh:mm:ss` with 0.999988426 (`23:59:59`); 46000.99999999 with `hh:mm` carries into the next day (the carry is our assumption, written in design 2.4); `m/d/yyyy` month then day; `yyy`, `ddd`, `dddd`, `s`, `AM/PM` give the plain text; `yyyy-mm-dd;@` is plain (unreadable section); a date section mixed with `0` is plain; a negative value with a date format is plain.
- Cross-check without `XLSX.SSF`: a table of 12 serial and date pairs computed independently with Python `datetime` (the script is not committed; the pairs are written into the test with a comment on how they were obtained).
- Property: every serial from 61 to 2958465 (sampled, about 200 runs) with `yyyy-mm-dd` matches `Date` arithmetic in the test itself.

### Notes
- The oracle row `0.5` with `h:mm` shows `12:00`, so the 61..2958465 range applies only to formats with a year, month or day part. A time-only format works on any non-negative value. Design 2.4 updated. No oracle value was changed.

---

## NTASK-03: Read the format and keep it on write

**Status:** Done  
**Requires:** FMT-01 (reading `z`), FMT-05  
**Depends on:** NTASK-01  
**Design:** sections 1 and 3

### What to do
1. `packages/workbook/src/adapter.ts`: `SheetJSSheet.getCellFormat`; `setCellValue` copies `z` from the replaced cell.
2. `packages/workbook/src/types.ts` or `index.ts`: export `FormattedSheet` and `hasCellFormats`.

### Tests (`packages/workbook/tests/adapter.test.ts`)
- FMT-01: a workbook built with SheetJS with `z: "yyyy-mm-dd"` on a numeric cell reports it through `getCellFormat` after `openWorkbook`; a string cell with `z`, an empty cell and a cell without `z` report `null`; `getCellValue` still returns the stored number.
- FMT-05: `setCellValue` on a cell with a format keeps it for a new number, a string and a boolean; a cell without a format stays without one; after `setCellValue(…, null)` and a new write the format is gone.
- FMT-01: `save()` then `openWorkbook` keeps `z` and the stored number.
- `hasCellFormats` is true for `SheetJSSheet` and false for an object without the method.

---

## NTASK-04: Fixture builder `z` and the `number_formats` fixture

**Status:** Done  
**Requires:** FMT-06  
**Design:** section 5

### What to do
1. Before any change record the hashes of the eight existing `fixtures/build/*.xlsm` (for example `shasum -a 256`).
2. `fixtures/build/build.ts`: optional `z` on a cell; `styles.xml`, content-type override, workbook relationship and `s` attributes only when some cell has `z`. XML-escape the format.
3. `fixtures/src/number_formats/cells.json` (sheet `Formats`, 22 rows from the table, column A) and `Module1.bas` with `CopyFirst`.
4. `fixtures/expected/number_formats.json`, by hand, written before the first run: macro `Module1.CopyFirst` in the same shape as the other expected files, `Formats!B1 = 46296`, no unsupported statements.
5. `npm run fixtures:build`. Compare the hashes of the eight old files: identical. Run `tools/crosscheck_olevba.py` (set up `.venv-tools` as the script header says; the folder is already ignored by git) and check all nine fixtures print `OK`.

### Tests
- `app/tests/fixtures-numfmt.test.ts` (FMT-06): the built `number_formats.xlsm` has `xl/styles.xml` with one `numFmt` entry per distinct format of the table (`General` included, written as a custom code); the old fixtures have no `xl/styles.xml`; rebuilding all fixtures into a temporary directory gives the same part contents for the eight old ones (the ZIP timestamps of some committed files are older than the builder's fixed 2026-01-01, so whole-file bytes differ from the committed files even for the old builder; the builder output itself was compared old against new and is identical); `openWorkbook` on the new file reports the format strings of the table through `getCellFormat`, each next to its stored value.
- `packages/vba/tests/fixtures.test.ts` has a hard-coded fixture list; `number_formats` is added to it (one-line edit, no oracle touched) so `CopyFirst` is checked against `fixtures/expected/number_formats.json`. The ovba end-to-end and app fixture tests pick up the ninth fixture without edits.

---

## NTASK-05: Show formatted text in the grid

**Status:** Done  
**Requires:** FMT-01 (grid shows formatted text, everything else the stored number), FMT-04, FMT-05  
**Depends on:** NTASK-02, NTASK-03  
**Design:** section 4

### What to do
1. `app/src/model/display.ts`: `displayText`.
2. `app/src/ui/Grid.tsx`: use `displayText`; accessible name and `title` as in design section 4. No change to `TracePanel`, `GridView`, `format.ts`.

### Tests (`app/tests/ui/grid.test.tsx`, `app/tests/model/display.test.ts`)
- FMT-01: a sheet with 46296 and `yyyy-mm-dd` shows `2026-10-01` as the cell text; a number without format shows what it showed before; a string cell is unchanged; the same sheet through a `SheetHandle` without `getCellFormat` shows the plain number.
- FMT-04: the formatted cell has `aria-label` `2026-10-01, stored 46296` and `title` `stored 46296`; a cell whose formatted text equals the plain text (`General`, `0` on 7) gets no stored suffix; a truncated long text keeps its rule.
- FMT-01, FMT-05: after a macro writes a number into a formatted cell, the grid shows it formatted, and "changed, was" shows the stored previous number (`2026-10-02, stored 46297, changed, was 46296`). A cell with no format shows the plain value after the write.
- The trace keeps stored values (FMT-01): the write event of that macro run has `before` 46296 and `after` 46297. The trace panel itself is untouched and still calls `formatValue`.
- axe has no violations on a grid with formatted cells; theme-lint and tokens tests still pass.
- Existing grid, keyboard and perf-render tests pass unchanged (the 5000-row render still renders at most 400 cells).

---

## NTASK-06: End to end with the built fixture

**Status:** Done  
**Requires:** FMT-01, FMT-04, FMT-05, FMT-06  
**Depends on:** NTASK-04, NTASK-05

### What to do
1. `app/tests/e2e/number-formats.test.tsx`: read `fixtures/build/number_formats.xlsm`, drop it into the app, run `Module1.CopyFirst`.

### Tests
- Before the run: the grid cell whose stored value is 46296 shows `2026-10-01` and its accessible name contains both `2026-10-01` and `46296` (acceptance item).
- Spot checks on four more cells of the table in the DOM: `1,234,567.89`, `(1,500.00)`, `12.5%`, `1234.5` under `[Red]0.00`.
- After the run, B1 holds the stored 46296 (against `fixtures/expected/number_formats.json` through `expectedFor`), is shown without a format (`46296`), and is listed as changed; the trace shows stored values.
- The downloaded `.xlsx` (saved blob) opened with `openWorkbook` keeps the stored numbers and the formats of column A.
- No network call is made (same stubs as `demo.test.tsx`).

---

## NTASK-07: Docs and backlog

**Status:** Done  
**Requires:** all FMT items (documentation); acceptance "Update BACKLOG.md item 12 and README"  
**Depends on:** NTASK-06

### What to do
1. `BACKLOG.md`: strike item 12 ("Done, see number-formats"). Add new items for what is deferred: AM/PM and weekday names, `[Red]` colours and conditions, fractions, scientific notation, `[h]`, locale prefixes such as `[$-419]`, dates before serial 61, and formats on `.xls` files if they differ.
2. `README.md`: fixtures count (eight to nine) and the status row; mention number formats in the grid. Also `app/src/ui/Footer.tsx`: the "What this does not do yet" line about number formats now says which formats are shown (the old line was no longer true).
3. `docs/number-formats.md`: one page on what the formatter reads, the rounding rule, what falls back to plain text and why (never guess), the second-level rounding assumption.
4. `docs/kiro-usage.md`: one paragraph on how this spec was run and what it caught.
5. `docs/ui-checklist.md`: a row for formatted cells and the accessible name.

### Tests
- None new. Run the four commands and `tools/crosscheck_olevba.py`; all green.
- `grep -rn "FMT-0" packages app/tests` shows every id FMT-01..FMT-06 in at least one test name.
