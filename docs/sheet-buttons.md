# Sheet buttons

The Exhume panel lists the buttons drawn on the sheets ("Buttons on sheets"), and the grid marks the cell each one is anchored to. Running a button runs the macro it calls, the same run as "Run Module1.Name" in the macro list.

## What is read

`readButtons` in `packages/workbook` opens the `.xlsx`/`.xlsm` as a ZIP and reads, without a DOM parser:

- **Form Control buttons, VML** (`xl/drawings/vmlDrawing*.vml`): a shape with `<x:ClientData ObjectType="Button">` and a non-empty `<x:FmlaMacro>`. Caption from the text box, anchor from `<x:Anchor>` (or `<x:Row>` and `<x:Column>`).
- **Shapes and pictures with a macro, DrawingML** (`xl/drawings/drawing*.xml`): an `xdr:sp` or `xdr:pic` with a `macro` attribute. Caption from the `a:t` text, else the shape name. Shapes inside groups and `mc:AlternateContent` are found; the `mc:Fallback` copy is skipped.

The sheet of each drawing comes from the relationships (`xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/_rels/*.rels`), never from file numbers. A drawing part that cannot be read becomes a line in the panel and does not hide the others. A workbook without drawings, or with drawings that have no macros, behaves as before.

## Macro references

`[0]!Module1.BuildActs`, `'Book.xlsm'!BuildActs`, `Book.xlsm!BuildActs`, `Module1.BuildActs` and `BuildActs` all resolve to a macro of this workbook when one with that name is in the macro list. Otherwise the button is listed with "Macro not found" and no Run button: another workbook, a name that does not exist, a Private Sub, a Function, a Sub with parameters, or a bare name that exists in two modules (ambiguous; the note says so).

## Limits

- **`.xls`**: buttons are BIFF `OBJ` records and are not read (`BACKLOG.md` item 14).
- **Charts** (`graphicFrame`) with a macro are not listed.
- **Absolute anchors** (`xdr:absoluteAnchor`) have no cell, so the button is listed with its sheet only and has no mark in the grid.
- **Book prefix assumption**: a reference with a book name (`'Book.xlsm'!X`) resolves only when the name equals the file name that was opened (case-insensitive). A copy of the file under another name makes such references "not found". Excel writes the bare or `Module1.` form for macros of the same workbook, so this should be rare; if it is wrong on real files, rule 1 of `resolveButtons` becomes "ignore the book name".
- **Not verified in Excel**: the fixture builder writes real Form Control VML for `demo_invoice.xlsm` and `demo_acts.xlsm`, but they have not been opened in desktop Excel.
- The scanner is tolerant, so a damaged drawing can give a wrong caption instead of an error. Macro names and anchors come from single elements and attributes.

## Why `Range.End` uses bounds

`Cells(Rows.Count, 1).End(xlUp)` starts at row 1 048 576. The old walk read every empty cell on the way up (about 90 ms per call). `SheetJSSheet` now tracks the largest row and column of the cells actually present (one pass over the keys, then updated in `setCellValue`) and `end` jumps over the empty part beyond them. The bounds are upper bounds, so the result is the same cell as before in every case. They are not taken from `!ref`, because SheetJS keeps a stale `<dimension>` as written in the file. A property test compares the new `end` with a copy of the old walk on random sparse sheets.
