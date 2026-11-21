# Design: Number formats in the grid

Implements FMT-01..FMT-06 (see `requirements.md`). Changes are in `packages/workbook` (formatter, format accessor, keeping the format on write), `fixtures/build`, and `app` (grid text and accessible name). `packages/vba` and `packages/ovba` are not touched. No network access. `fixtures/expected/*.json` of existing fixtures and `.gitignore` are not edited; only `fixtures/expected/number_formats.json` is added.

## 1. Where it plugs in

| Concern | Today | Change |
|---|---|---|
| Reading the file | `openWorkbook` already passes `cellNF: true`, so SheetJS puts the format string in `cell.z` | unchanged |
| Cell text in the grid | `Grid.tsx` calls `formatValue(value)` | a helper `displayText(sheet, row, col, value)` picks `formatNumber` when the sheet reports a format, else `formatValue` |
| Interpreter, trace, "changed, was", download | use the stored value | unchanged (FMT-01) |
| Writing a cell | `SheetJSSheet.setCellValue` replaces the cell object, which drops `z` | copy `z` from the old cell (FMT-05) |
| Fixture builder | writes cells without styles | writes `xl/styles.xml` only when a cell has `"z"` (FMT-06) |

`SheetHandle` lives in `packages/vba` and is not extended. The format is exposed through a second, optional interface in `packages/workbook`:

```ts
export interface FormattedSheet {
  /** The number format string of a numeric cell, or null (no cell, not a number, no format). */
  getCellFormat(row: number, col: number): string | null;
}
export function hasCellFormats(sheet: SheetHandle): sheet is SheetHandle & FormattedSheet;
```

`SheetJSSheet` implements it. Any other `SheetHandle` (for example the in-memory test workbook) has no `getCellFormat`, and the grid shows plain values for it.

## 2. The formatter (`packages/workbook/src/numfmt.ts`)

```ts
export function formatNumber(value: number, format: string): string;
```

Pure, total, no `any`, no import of `xlsx`. It returns the plain text (section 2.1) whenever it cannot read the format. It never throws.

### 2.1 Plain text

A private `plainNumber(n)` that is a copy of `formatValue` for numbers in `app/src/model/format.ts` (15 significant digits, plain decimal from 1e-6 up to 1e21, otherwise `1E+21`, `1.5E-07`; non-finite via `String`). `formatValue` stays untouched. The copy is deliberate: the property test in `app/tests/model` compares the two, so a change in only one of them fails a test.

`format.trim() === ""` or `format.toLowerCase() === "general"` returns `plainNumber(value)`.

### 2.2 Parsing

1. Split the format on `;` outside double quotes and outside backslash escapes. More than 3 sections, or an empty section, means unreadable.
2. Tokenise each section left to right. Allowed tokens:
   - `"text"` (no escape inside), `\x` (one character), and the bare characters `-` `(` `)` space `:` `/` `.` `$` `€` `₽` (literals; in a number section `.` is the decimal point, see 2.3);
   - `0`, `#`, `,`, `.` (digit tokens); `%`;
   - `yyyy yy mm m dd d hh h ss mmm mmmm` (date tokens, matched case-insensitively, longest run of the same letter; a run of any other length, such as `ddd`, `yyy`, `mmmmm`, `s`, is unreadable).
   - Anything else is unreadable: `[`, `@`, `*`, `_`, `?`, `E`/`e` (scientific), `A`/`P` (AM/PM), `ddd`, any other bare letter or character.
3. A section with digit tokens and date tokens is unreadable. A section with `%` and date tokens is unreadable.
4. Every section is parsed before any is used. One unreadable section makes the whole format unreadable and `formatNumber` returns the plain text.

### 2.3 Number sections

A number section is `prefix? digits suffix?` where `prefix` and `suffix` are literals (and `%`), and `digits` is one contiguous run of `0 # , .`:

- at most one `.`; integer part before it, fraction part after it;
- integer part matches `#* 0*` with commas allowed between two placeholders (grouping); a comma at the start of the run, before the `.`, or at the end (thousands scaling) is unreadable;
- fraction part matches `0* #*`;
- literals between digit tokens (as in `000-0000`) are unreadable.

A section with no digit tokens (for example `"-"`) is allowed and prints its literals.

Formatting a value `v` (finite):

1. Choose the section: one section, always it; two sections, the second for `v < 0`, else the first; three sections, first for `v > 0`, second for `v < 0`, third for zero. With one section, a negative value gets a leading `-`; with the second section of two or three the absolute value is formatted and no minus is added. `-0` counts as zero.
2. Build the decimal digits of `abs(v)` as strings without floating arithmetic (FMT-03): `abs.toExponential(14)` gives 15 significant digits (the same 15 digits Excel keeps), which are split into `intDigits` and `fracDigits` around the decimal point. Each `%` in the section shifts the point two places right by moving two characters of `fracDigits` (padded with zeros) to `intDigits`.
3. Round half away from zero at the number of fraction placeholders by looking at the next digit (`>= "5"` increments the kept digit string with decimal carry). 1.005 has the digits `1.00500000000000`, so it rounds to 1.01. 2.5 with `0` gives 3.
4. Fraction text: keep at least the number of `0` placeholders, strip trailing zeros beyond that. The `.` is printed whenever the format has one (`#.##` with 3 gives `3.`, as Excel does).
5. Integer text: strip leading zeros, pad on the left to the number of `0` placeholders. Placeholders only set the minimum; more digits than placeholders all print. If the format has no integer placeholder and the integer part is zero, nothing is printed (`#.##` with 0.5 gives `.5`).
6. Grouping: when the integer part has a comma, insert `,` every three digits from the right.
7. Concatenate prefix, number, suffix.

### 2.4 Date sections

Only when the chosen section has date tokens. If it has a year, month or day part, the value must be `>= 61` and `< 2958466` (31 Dec 9999); a time-only section (`h:mm`, `hh:mm:ss`, no day, month or year) accepts any non-negative value below 2958466, the day part being ignored (the oracle row 0.5 with `h:mm` needs this). Otherwise (negative, below 61, which is where Excel's 1900-02-29 error lives, or too large) the plain text is returned.

- `total = Math.round(value * 86400)` when the section has `h`, `hh` or `ss`; otherwise the day is `Math.floor(value)` and time is ignored. `days = floor(total / 86400)`, `secs = total - days * 86400`. Rounding to the nearest second carries into the day (`46000.99999999` shows the next day when a time part is present). This second-level rounding is our assumption, not in the requirements table.
- Calendar: `new Date(Date.UTC(1899, 11, 30) + days * 86_400_000)`, read with the UTC getters.
- `m` and `mm` mean minutes when the previous date token is `h` or `hh` or the next date token is `ss`, and only `:` or space characters lie between. Otherwise they are the month.
- Padding: `dd`, `hh`, `ss`, minutes `mm`, month `mm` are two digits; `d`, `h`, `m` are not padded; `yyyy` is four digits; `yy` is the year modulo 100, two digits.
- `mmm` and `mmmm` use English names, `Jan`..`Dec` and `January`..`December`.
- `h` is the 24-hour clock. AM/PM is unreadable.
- The sign rule of 2.3 step 1 applies: a negative value that selects a date section returns the plain text.

### 2.5 Edge cases that return the plain text

Non-finite values, empty sections, more than three sections, `General` inside a multi-section format, colours and conditions in `[...]`, fractions `? /?`, `E+`, `@`, `*`, `_x`, `[h]`, AM/PM, weekday names, dates outside 61..2958465, and any parse error.

## 3. Reading and keeping the format (`packages/workbook/src/adapter.ts`)

- `getCellFormat(row, col)`: the cell `z` when the cell exists, has `t === "n"`, and `z` is a non-empty string; otherwise `null`. SheetJS reads `General` for cells without a format, so `General` (any case) and an empty string also give `null`.
- `setCellValue`: when a cell exists and has a `z`, the new cell object copies it (all value types, so a later number keeps it). A cell that had no `z` gets none. Deleting a cell (`null`) removes the format with it, as today the cell is removed.
- `save()` already writes `z` as a style (SheetJS maps it to `numFmt`), so the download keeps formats. A test round-trips this through `save()` and `openWorkbook`.

## 4. App (`app/src`)

New `app/src/model/display.ts`:

```ts
export function displayText(sheet: SheetHandle, row: number, col: number, value: VBAValue): string;
```

If `typeof value === "number"` and `hasCellFormats(sheet)` and `getCellFormat` is not null, returns `formatNumber(value, fmt)`, else `formatValue(value)`.

`Grid.tsx` changes:

- `text` becomes `displayText(...)`. `stored = formatValue(value)`. `shown = text !== stored` (only for numbers).
- `aria-label`: formatted cells get `"<text>, stored <stored>"`. For a changed cell: `"<text>, stored <stored>, changed, was <formatValue(before)>"`. The "was" value is the stored number, in plain form, as the requirements ask. Cells without a different display keep their current label (including the truncated-text rule).
- `title`: for a formatted cell, `"stored <stored>"`; if the text is also truncated, `"<text>, stored <stored>"`.
- The `cell--number` class stays based on the stored type, so alignment does not change.
- `TracePanel`, `GridView` keep `formatValue`. The trace shows stored values on purpose.

## 5. Fixture builder (`fixtures/build/build.ts`)

- `CellDef` gets an optional `z?: string`.
- When any cell in any sheet has `z`, collect the distinct formats in order of first use and write `xl/styles.xml` with `<numFmts>` (ids from 164 up), a `fonts`/`fills`/`borders`/`cellStyleXfs` minimum, and `cellXfs` with xf 0 (default) followed by one xf per format with `applyNumberFormat="1"`. The cell gets `s="<xf index>"`. Add the content-type override and the workbook relationship.
- When no cell has `z`, nothing is written or changed: no `styles.xml`, no `s` attributes, no extra relationship. The eight existing `.xlsm` files must stay byte-identical (checked by hashing before and after, and by a test that rebuilds into a temporary directory and compares).
- The format string is XML-escaped (`escapeXml`), so `"` becomes `&quot;`.

New fixture `fixtures/src/number_formats/` with `cells.json` (sheet `Formats`, one row per table row, column A holds the stored value and `z`, column B empty; the macro writes B1) and `Module1.bas`:

```vb
Sub CopyFirst()
    Range("B1").Value = Range("A1").Value
End Sub
```

`fixtures/expected/number_formats.json` is written by hand with one run, `CopyFirst`, status "fully resurrected", cell `Formats!B1 = 46296` (the stored value of A1, taken from the requirements table), no unsupported statements. The display column of the table is the oracle for `formatNumber` tests, not for the fixture.

## 6. Tests and where they live

| Test | File |
|---|---|
| One test per table row, plus the edge cases of 2.5 | `packages/workbook/tests/numfmt.test.ts` |
| Property: `General` equals `formatValue` on finite doubles; formatter never throws on arbitrary format strings | `app/tests/model/numfmt-property.test.ts` |
| `getCellFormat`, format kept on write, format kept through `save()` | `packages/workbook/tests/adapter.test.ts` |
| Builder writes `styles.xml` only with `z`; old fixtures identical | `app/tests/fixtures-numfmt.test.ts` |
| Grid text, accessible name, hover, changed cell | `app/tests/ui/grid.test.tsx` |
| Built `number_formats.xlsm` through the app | `app/tests/e2e/number-formats.test.tsx` |

## 7. Risks

| Risk | Handling |
|---|---|
| The formatter claims to read a format and is subtly wrong | Anything outside the grammar of section 2.2 returns plain text. The oracle table is never edited; a row believed wrong is written up in `tasks.md` under its task and work stops there. |
| Styles added to the builder change old fixtures | Nothing is emitted without `z`; hash check in NTASK-04. |
| `General` copy drifts from `formatValue` | Property test across both packages (NTASK-01). |
| Dates before serial 61 or after 9999 | Plain text, listed as deferred in the docs. |
| Locale-specific formats (`[$-409]`, `[$₽-419]`) | Unreadable, plain text. Deferred. |
