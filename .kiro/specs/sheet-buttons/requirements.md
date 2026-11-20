# Spec: Sheet buttons and a fast Range.End

## Why
Business users run macros from buttons drawn on a sheet ("Build invoice"), not from a list of procedure names. The UI lists macros only, so the demo cannot show "the button found on the sheet" (BACKLOG item 2 and 10). Separately, `Cells(Rows.Count, 1).End(xlUp)`, the usual last-row idiom, walks a million empty cells and costs about 90 ms per call (BACKLOG item 8), which keeps the UI-12.1 performance budget skipped.

## Requirements (EARS)

**BTN-01** When a workbook contains Form Control buttons (VML in `xl/drawings/vmlDrawing*.vml`, `<x:ClientData ObjectType="Button">` with `<x:FmlaMacro>`), the system shall list each button with its sheet, caption text, anchor cell (top-left) and the macro it calls.

**BTN-02** When a workbook contains shapes with an assigned macro (DrawingML `xdr:sp` or `xdr:pic` with a `macro` attribute in `xl/drawings/drawing*.xml`), the system shall list them the same way, with the shape's text as caption (or its name when it has no text).

**BTN-03** The macro reference shall be normalised the way Excel stores it: `[0]!Module1.BuildActs`, `'Book.xlsm'!BuildActs`, `Module1.BuildActs` and `BuildActs` all resolve to a macro of this workbook when one with that name exists. A reference that resolves to nothing, or to another workbook, is listed with a clear "macro not found" note and no Run action.

**BTN-04** The sheet a drawing belongs to shall be found through the relationships (`xl/worksheets/_rels/sheetN.xml.rels` and `xl/workbook.xml`), never by file name order.

**BTN-05** The UI shall show the buttons above the macro list in the Exhume panel ("Buttons on sheets"), each with its caption, sheet and anchor, the macro name, the existing prediction, and a Run button whose accessible name includes the caption (e.g. "Run button Build invoice"). Running from a button is the same run as running the macro from the list.

**BTN-06** The grid shall mark the anchor cell of each button on the visible sheet with a small, non-interactive label showing the caption, so the button is visible where the author put it. It must not hide cell values or break keyboard navigation of the grid.

**BTN-07** The fixture builder shall write the `buttons` entries of `cells.json` (sheet, text, macro, anchor) as real Form Control buttons (VML drawing, legacy drawing relationship, ctrlProps if needed) so that the built `.xlsm` opens in Excel with a working button, and so that BTN-01 can be tested on the built fixtures. `demo_acts` and `demo_invoice` already have one button each.

**BTN-08** A workbook with no drawings, or with drawings that have no macros, shall behave exactly as today.

**END-01** `Range.End` in all four directions shall return exactly the same cell as today for every input, including cells outside a stale `!ref` (SheetJS keeps `<dimension>` as written).

**END-02** `Range.End(xlUp)` from row 1 048 576 (and `xlToLeft` from column 16 384) shall jump directly to the last row (column) that holds a cell, from bounds tracked from the cells actually present (updated in `setCellValue`), not from `!ref`.

**END-03** With END-02 in place, the skipped UI-12.1 budget test in `app/tests/perf.test.ts` (exhume + run of the 40-row demo under 100 ms, median of 5) shall be un-skipped and pass on a quiet machine; keep the 400 ms regression guard.

## Acceptance
- Unit tests for BTN-01..04 with small hand-written XML inputs (both VML and DrawingML, all reference forms of BTN-03, a drawing whose rels point to a different sheet than its file number suggests).
- Built `demo_invoice.xlsm` and `demo_acts.xlsm` list one button each: "Build invoice" on Log, anchor H2, macro Module1.BuildInvoice; "Сформировать акты" on Журнал, anchor H2, macro Module1.BuildActs.
- Property test for END-01: on random sparse sheets, the new `end` equals a reference implementation that walks cell by cell.
- `fixtures/expected/*.json` are not edited. All existing tests keep passing. `npm test`, `npm run lint`, `npm run typecheck` and `npm run build -w app` are green after every task.
- olevba still reads every rebuilt fixture identically (`tools/crosscheck_olevba.py`).
