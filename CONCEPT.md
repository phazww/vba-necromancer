# VBA Necromancer — Kiroween 2026, category Resurrection

Deadline: Fri 4 Dec 2026, 2:00 pm PST = Sat 5 Dec 06:00 Shenzhen. Must be built with Kiro (IDE/CLI); keep `/.kiro` (specs, steering, hooks) in the repo root, never in .gitignore.

## One line
Drop an old Excel file with VBA macros into the browser, and the macros run again: no Excel, no Windows, no macro security warnings. Excel for the web, Excel for Mac (partly), Google Sheets and LibreOffice users cannot run VBA; millions of business workbooks still depend on it.

## What it does
1. **Exhume.** Load `.xlsm` / `.xls` in the browser. Read cells, formulas and the VBA project (modules, procedures, buttons/shapes bound to macros).
2. **Resurrect.** A VBA interpreter written in TypeScript runs the macros against an in-browser workbook model. Supported subset grows with tests: Sub/Function, Dim/Const, If/ElseIf/Select Case, For/For Each/Do/While, Range/Cells/Value/Formula, Worksheets/Sheets, Rows.Count/End(xlUp), WorksheetFunction subset, string/date/math functions, MsgBox/InputBox (as modal), Application.ScreenUpdating (no-op), On Error Resume Next.
3. **Show the ghost.** Each macro step can be traced: which cells it touched, before/after values.
4. **Bury it properly (stretch).** Export a macro to modern TypeScript with the same behaviour, plus tests that compare outputs.
5. **Download** the resulting `.xlsx` (macro-free).

## Honest scope
Unsupported VBA features are reported, not faked: the app lists every statement it cannot run (UserForms, Windows API Declare, COM objects, file system) and marks the macro as "partly resurrected".

## Proof
- Test corpus of real-shaped macros (acts by categories, labour statements, monthly summaries, data cleanup, report generation) with expected workbook states written by hand before running.
- Where possible, cross-check expected results against LibreOffice with VBA compatibility mode.

## Demo (under 3 min)
Old acts workbook with a "Сформировать акты" button → open in browser → click → acts sheets appear, sums match → download. Then the trace view and the list of unsupported statements.

## Stack
Vite + TypeScript, SheetJS (or ExcelJS) for workbook I/O, an OLE/CFB reader for `vbaProject.bin` + MS-OVBA decompression (implemented in TS), hand-written VBA lexer/parser/interpreter. Static site, free hosting for the test link.

## People
Ilya: Kiro login, Devpost registration and credits, GitHub repo (public only after his yes), demo video voice/recording, submission.
Claude: specs, code (through Kiro CLI), tests, docs, video script.
