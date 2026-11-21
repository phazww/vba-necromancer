# Spec: Number formats in the grid

## Why
The grid shows stored values: a date is a serial number (46296 instead of 2026-10-01), a share is 0.125 instead of 12.5%, an amount has no thousands separators (BACKLOG item 12). Someone who drops their own workbook sees numbers that do not look like their sheet. The stored value must stay what the macro reads and writes; only the text shown in the grid changes.

## Requirements (EARS)

**FMT-01** When a cell holds a number and has a number format in the file (SheetJS `cell.z`, read with `cellNF: true`), the grid shall show the number formatted with that format. The value given to the interpreter, the trace, the "changed, was ..." comparison and the downloaded `.xlsx` shall keep using the stored number.

**FMT-02** The formatter shall be our own small function in `packages/workbook` (no call to `XLSX.SSF`, so the oracle below is checked against independent code), covering:
- `General` and an empty format: exactly today's `formatValue` output;
- digit placeholders `0`, `#`, the decimal point, the thousands separator `,` between digit placeholders;
- `%` (value multiplied by 100);
- literal text in double quotes, backslash-escaped characters, and the characters `-`, `(`, `)`, space, `:` `/` `.` in date formats, `₽`, `$`, `€`;
- date and time parts `yyyy`, `yy`, `mm` or `m` (month, or minutes when directly after `h`/`hh` or before `ss`), `dd`, `d`, `hh`, `h`, `ss`, `mmm`, `mmmm` (English month names), on the 1900 date system with epoch 1899-12-30 for serials of 61 and above;
- sections separated by `;` (positive; negative; zero): the second section formats the absolute value;
- a format the function cannot read (colours in `[Red]`, conditions `[>100]`, fractions `# ?/?`, scientific `0.00E+00`, `@`, `*`, `_x` padding, elapsed time `[h]`) is not guessed: the grid shows today's plain value.

**FMT-03** Rounding is half away from zero on the decimal representation of the number, as Excel displays it (not banker's rounding, and not binary floating point artefacts): 2.5 with `0` is 3, 1.005 with `0.00` is 1.01.

**FMT-04** A cell shown through a number format shall expose the stored value to assistive technology and on hover: its accessible name is the formatted text followed by the stored value when they differ (for example "2026-10-01, stored 46296").

**FMT-05** A cell written by the macro keeps the number format the cell had before; a cell that had no format shows the plain value, as today.

**FMT-06** The fixture builder shall accept an optional `"z"` (number format string) on a cell in `cells.json` and write it to the `.xlsm`. Add one new fixture `number_formats` (a sheet with the cells of the table below, plus a three-line macro that copies A1 to B1 with `Range("B1").Value = Range("A1").Value`), with a hand-written `fixtures/expected/number_formats.json`. Existing fixtures must build to the same bytes as today.

Hand-written expected display (this table is the oracle; never change an expected value to make a test pass; if you believe a row is wrong, stop and write why in tasks.md):

| Stored value | Format | Shown |
|---|---|---|
| 46296 | `yyyy-mm-dd` | 2026-10-01 |
| 46000 | `dd.mm.yyyy` | 09.12.2025 |
| 45658 | `d mmm yyyy` | 1 Jan 2025 |
| 45658 | `mmmm yy` | January 25 |
| 46000.75 | `dd.mm.yyyy hh:mm` | 09.12.2025 18:00 |
| 0.5 | `h:mm` | 12:00 |
| 0.125 | `0%` | 13% |
| 0.125 | `0.0%` | 12.5% |
| 1234567.891 | `#,##0.00` | 1,234,567.89 |
| 1286290 | `#,##0` | 1,286,290 |
| 2.5 | `0` | 3 |
| -2.5 | `0` | -3 |
| 1.005 | `0.00` | 1.01 |
| 0.5 | `0.00` | 0.50 |
| 0.5 | `#.##` | .5 |
| 7 | `000` | 007 |
| 1500 | `#,##0.00 "₽"` | 1,500.00 ₽ |
| -1500 | `#,##0.00;(#,##0.00)` | (1,500.00) |
| 0 | `0.00;-0.00;"-"` | - |
| 1234.5 | `General` | 1234.5 |
| 1234.5 | `[Red]0.00` | 1234.5 |
| 0.3333 | `# ?/?` | 0.3333 |

## Acceptance
- A unit test in `packages/workbook/tests` for every row of the table.
- A property test: for `General`, the formatter equals today's `formatValue` on random finite numbers.
- A UI test: the built `number_formats.xlsm` opened through the app shows "2026-10-01" in the grid cell whose stored value is 46296, and the cell's accessible name contains both.
- `fixtures/expected/*.json` of the existing fixtures are not edited; the eight existing built fixtures keep identical bytes. `npm test`, `npm run lint`, `npm run typecheck` and `npm run build -w app` are green after every task. `tools/crosscheck_olevba.py` still passes for all fixtures including the new one.
- Update BACKLOG.md item 12 and README (fixtures count) when done.
