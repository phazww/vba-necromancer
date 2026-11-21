# Number formats in the grid

The grid shows a number through the number format stored in the file, so a date looks like a date. Only the text in the grid changes. The macro, the trace, the "changed, was ..." text, the cell's hover text and the downloaded `.xlsx` use the stored number. A cell written by a macro keeps the format it had.

The formatter is `formatNumber` in `packages/workbook/src/numfmt.ts`. It is our own code and does not call `XLSX.SSF`, so the hand-written table in `.kiro/specs/number-formats/requirements.md` is checked against independent code.

## What it reads

| Part | Examples |
|---|---|
| General or empty | `General`, `` (same text as before) |
| Digits | `0`, `#`, `0.00`, `#.##`, `000` |
| Thousands separator between digits | `#,##0`, `#,##0.00` |
| Percent | `0%`, `0.0%` |
| Text | `"₽"`, `\k\g`, `$`, `€`, `-`, `(`, `)`, space, `:`, `/` |
| Date and time | `yyyy`, `yy`, `mm`, `m`, `dd`, `d`, `hh`, `h`, `ss`, `mmm`, `mmmm` (English names) |
| Sections | `positive;negative;zero`. The negative section shows the absolute value. |

`m` and `mm` mean minutes right after `h`/`hh` or right before `ss`, otherwise the month. Dates use the 1900 system, epoch 1899-12-30, for serials 61 to 2958465. A time-only format works on any non-negative value.

## Rounding

Half away from zero on the decimal digits, as Excel shows them: `2.5` with `0` is `3`, `-2.5` is `-3`, `1.005` with `0.00` is `1.01`. The formatter takes the 15 significant digits Excel keeps and rounds that digit string, with no floating point arithmetic. Banker's rounding is for VBA `Round`, not for display.

Times are rounded to the nearest second when the format has an hour or second part. That rule is our assumption, not checked against Excel. A date-only format drops the time of day.

## What it does not guess

Anything outside the table above shows the stored number as before: `[Red]`, conditions `[>100]`, fractions `# ?/?`, `0.00E+00`, `@`, `*`, `_)`, `[h]`, AM/PM, `ddd`, `0,` scaling, literals between digits (`000-0000`), more than three sections, empty sections, dates before serial 61 (Excel's 1900-02-29 error) and negative dates. One unreadable section makes the whole format unreadable.

## Tests

`packages/workbook/tests/numfmt.test.ts` has one test per row of the table, edge cases and 12 date pairs computed with Python. `app/tests/model/numfmt-property.test.ts` checks that `General` equals `formatValue`, that the formatter never throws, and dates against `Date` arithmetic. `app/tests/e2e/number-formats.test.tsx` opens the built `number_formats.xlsm` in the app.
