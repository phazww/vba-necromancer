# Product: VBA Necromancer

Kiroween 2026 entry, category **Resurrection**.

## Problem
Millions of business workbooks still depend on VBA macros: monthly acts, labour statements, payroll sheets, report generators. VBA does not run in Excel for the web, Google Sheets, LibreOffice by default, on phones, or anywhere without desktop Excel on Windows. Office keeps tightening macro security. The people who wrote these macros are often gone. The macros are effectively dead, but the business still needs what they did.

## What the product does
1. **Exhume**: the user drops an `.xlsm` (or `.xls`) into the browser. Everything stays local; no upload to a server.
2. **Read**: cells, formulas, sheets, the VBA project (modules and procedures) and which shapes/buttons call which macro.
3. **Resurrect**: a VBA interpreter written in TypeScript runs the macros against an in-browser workbook model.
4. **Trace**: every run records which cells were read and written, before and after values, so the user can see what the macro did.
5. **Be honest**: every statement the interpreter cannot run is listed with its module and line. A macro is marked "fully resurrected" only if it ran without unsupported statements.
6. **Download** the resulting workbook as `.xlsx`.

## Users
Accountants, engineers in production and construction offices (ПТО), small-business owners who inherited macro workbooks and moved to a Mac, a browser or Google Sheets.

## Principles
- Correctness over coverage: a smaller VBA subset that gives exactly the same results as Excel beats a large subset that is subtly wrong.
- Never fake support. Unsupported is reported, not silently skipped.
- Privacy: files never leave the browser.
- The spooky theme lives in naming and small touches (exhume, resurrect, graveyard of unsupported statements), never at the cost of clarity.
