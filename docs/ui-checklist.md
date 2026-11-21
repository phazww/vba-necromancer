# UI checklist (manual)

What `jsdom` cannot check. Each item has a result line that a person fills in: `pass` or `fail`, the date, the browser and version, and a note. Nothing below has been filled in by the tools that built the UI.

Use the built demo files (`Try the demo`, `Try the graveyard sample`). Do not open a real client workbook.

## Keyboard-only walk through the demo

1. Load the page. Press Tab once: the skip link "Skip to workbook" appears. Press Enter: focus moves to the main area.
2. Tab to "Try the demo" and press Enter. The page says "Exhuming", then shows the Exhume panel.
3. Tab to "Run Module1.BuildActs" and press Enter. The result bar says "Fully resurrected".
4. Tab to the grid. Move with the arrow keys, Home, End, Page Down, Ctrl+Home. Only one cell is a tab stop.
5. Tab to the trace list. Move with the arrow keys, press Enter on a write row: the grid cell and the source line are marked.
6. Tab to "Download .xlsx" and press Enter.
7. At no point is focus lost, trapped, or invisible.

Result: (pass or fail, date, browser, note)

## 375 px layout

Chrome device mode at 375 px wide, and one real phone.

- No horizontal page scroll. The grid, source and trace scroll inside their own boxes.
- One tab list "Grid, Source, Trace, Graveyard". Buttons and tabs are at least 44 px high.
- Selecting a trace row does not switch tabs; "Go to cell" and "Go to line" do.
- Selecting a graveyard entry switches to Source.
- Sheet and module lists fold away after a run.

Result: (pass or fail, date, device, browser, note)

## Browser zoom 200 percent

At 200 percent on a 1280 px wide window (the layout is the narrow one). Nothing is cut off or overlaps; text is readable; every control is still reachable.

Result: (pass or fail, date, browser, note)

## Light and dark

Switch the system setting. Check each view in both: empty page, exhumed workbook, after a run (changed cells, selected cell, selected source line), trace, graveyard with a stopped run, error messages. The changed-cell bar and the focus ring are visible in both. The ratios in `app/tests/tokens.test.ts` are checked by the tests; this item checks that the page really uses the tokens.

Result: (pass or fail, date, browser, note)

## High-contrast mode

Windows high contrast, or forced colours in a browser. Buttons, tabs, the grid and the status badge keep their borders and shapes. A changed cell is still told apart from an unchanged one (the bar and the bold text are not colour only).

Result: (pass or fail, date, browser, note)

## Screen reader smoke test

VoiceOver on macOS (Safari or Chrome). Load the demo, run `BuildActs`, listen to the result ("Fully resurrected. 22 cells changed."), move into the trace list and select a row, then move to the grid and read the selected cell.

- The status is announced once per run.
- A changed cell is read with "changed, was" and the old value.
- A formula cell is read with "formula, value not recalculated".
- Tab lists, grid and listbox are announced with their names.

Result: (pass or fail, date, browser and reader version, note)

## Offline reload

Load the page from a local build (`npm run build -w app`, `npm run preview -w app`) or from the deployed site, then disconnect the network and reload. Run the demo. Nothing needs the network. In the developer tools the Network tab shows no request after the page has loaded, and the console shows no Content-Security-Policy violation.

Result: (pass or fail, date, browser, note)

## Download opened in LibreOffice or Excel

Run `BuildActs`, download, open the `.xlsx`. The sheet "Акты" has the 20 categories and the total in row 22, as in `fixtures/expected/demo_acts.json`. The file has no macros. Cyrillic text is intact. Formulas, if the source file had any, are still formulas.

Result: (pass or fail, date, application and version, note)

## Buttons on sheets

Load `Try the demo`. In the Exhume panel the heading "Buttons on sheets" comes before "Macros", with the button "Build invoice", "Log, H2. Calls Module1.BuildInvoice." and the prediction. Tab to "Run button Build invoice" and press Enter: the same result as "Run Module1.BuildInvoice". Load the Russian sample: "Сформировать акты" on Журнал, H2.

Result: (pass or fail, date, browser, note)

## Button mark in the grid

In the grid, cell H2 of the sheet Log shows the caption "Build invoice" as a small label after the cell value. It does not cover the value, it is not a tab stop, and a screen reader reads the cell without it. Switch to another sheet: no label.

Result: (pass or fail, date, browser, note)

## Keyboard across a button mark

Click the cell G2, then press Right, Right, Left, Home, End, Page Down, Page Up. Focus moves cell by cell exactly as in a row without a label, and passes over H2 without stopping on the label.

Result: (pass or fail, date, browser, note)

## Built button in desktop Excel

Open `fixtures/build/demo_invoice.xlsm` in desktop Excel and click the button. The macro `Module1.BuildInvoice` should run (macros enabled). The builder writes the button as VML with the same elements Excel writes, but this has not been checked in Excel: not verified in Excel yet.

Result: not verified in Excel yet (pass or fail, date, Excel version, note)

## Number formats in the grid

Open `fixtures/build/number_formats.xlsm`. Cell A1 shows `2026-10-01`, A9 shows `1,234,567.89`, A18 shows `(1,500.00)`. With a screen reader on A1 the name is "2026-10-01, stored 46296"; hovering A1 shows "stored 46296". Run `Module1.CopyFirst`: B1 shows `46296` (no format) and A1 is unchanged.

Result: (pass or fail, date, browser, note)

## Measured numbers

Measured on the machine that built the UI (an Apple silicon Mac, Node, jsdom, the tests in `app/tests/perf.test.ts` and `app/tests/ui/perf-render.test.tsx`). Run them again on the machine you care about and write the numbers here.

| Case | Budget | Measured |
|---|---|---|
| 40 rows (`demo_acts.xlsm`): exhume | part of 100 ms | about 1 ms with the file already read, 3 ms with the ZIP and VBA read |
| 40 rows: exhume + run `BuildActs` | 100 ms (median of 5) | medians of five runs of the test: 2.4, 2.3, 2.4, 2.5, 2.3 ms. `Range.End` now jumps to the last row from tracked bounds (sheet-buttons STASK-01). Budget met. |
| 5 000 rows: exhume, run, derive changes | 2 000 ms | about 280 ms (exhume 43, run 232, derive 1); 30 106 trace events |
| 5 000 rows: draw the page | at most 400 cell nodes, 100 trace rows | 216 cell nodes, 14 trace rows |
| Select the 10 000th trace event | one reducer call | 0.04 ms, 1 indexed read of the trace |
| Filter 30 000 trace events | 50 ms | about 1 ms |
| 5 000 line source module | 200 ms in the first design (all lines drawn) | 3 ms; modules over 1 000 lines draw only the lines near the viewport |
| Production build, gzip | 600 KB | 215 KB (JS 212 KB, CSS 2.5 KB, HTML 0.4 KB) |

Result: (pass or fail, date, machine, note)
