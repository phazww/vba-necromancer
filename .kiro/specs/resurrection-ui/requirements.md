# Spec: resurrection-ui

## Why

The file layer (`packages/ovba`), the interpreter (`packages/vba`) and the workbook adapter (`packages/workbook`) are done and verified against hand-written oracles. `app/` is still a placeholder (`main.ts`, an empty `<div id="app">`). This spec describes the browser app that makes the product usable: drop a macro workbook, see what is inside, run a macro, see what it did, see what could not run, and download the result.

The UI is a thin layer. It calls `extractModules`, `tokenize`, `parse`, `scanUnsupported`, `openWorkbook`, `runMacro` and `SaveableWorkbook.save`, and shows their results. It never decides on its own whether a macro is "fully resurrected" (product principle: never fake support).

## Scope

In scope: everything in `app/`, plus the build and deploy configuration needed to publish it as a static site on GitHub Pages under a sub-path.

Out of scope for this spec (stated so that nobody assumes otherwise):

- Reading shapes and form-control buttons bound to macros (`BACKLOG.md` item 2). The UI lists macros and runs them from a list; it does not draw the sheet's original buttons. The demo script line "the button found on the sheet" is not met until that backlog item lands.
- Extracting VBA from legacy `.xls` files. `extractModules` finds `VBA/dir` at the root of the compound file, which is where `vbaProject.bin` keeps it, but a BIFF `.xls` keeps it under `_VBA_PROJECT_CUR`. The UI opens `.xls` sheets and says that its VBA cannot be read yet.
- Formula recalculation. The workbook adapter keeps the cached value of a formula cell. A macro that changes a precedent does not change the formula's displayed value. The UI says so (UI-3.6).
- Number-format emulation (dates, currency, percent). The grid shows stored values.
- `MsgBox` and `InputBox` dialogs, export to TypeScript, editing VBA, saving back to `.xlsm`.
- Server-side anything. There is no backend.

## Assumptions

- Preact is used (steering allows "Vite + vanilla TypeScript or a small framework (Preact)"). Reason: components, keyed lists and a testing library with the same API as the one for React, at about 4 KB.
- One workbook is open at a time. Loading another file replaces it (after the new file loaded successfully).
- Each run starts from the workbook as loaded from the file, not from the result of a previous run. Runs are therefore reproducible and the trace of a run explains the whole difference between "as loaded" and "result".
- The theme follows the operating system setting (`prefers-color-scheme`). There is no in-app toggle.
- The file name pattern for the download is `<original base name>-resurrected.xlsx`.
- Requirement groups UI-1 to UI-11 follow the numbering of the request. UI-12 (performance) and UI-13 (honest reporting) are added because the request asks for performance numbers in the design and the product principles require honest reporting.

## Requirements (EARS)

### UI-1 Loading a file, locally

**UI-1.1** When the user drops a file on the drop zone, the app shall read the file in the page and exhume it.

**UI-1.2** When the user activates the "Choose a file" button (a real `<input type="file">`, reachable and operable by keyboard), the app shall read the chosen file and exhume it in the same way as a dropped file.

**UI-1.3** The app shall decide how to read a file from its content, not from its extension. A file that starts with the ZIP signature (`.xlsm`, `.xltm`, `.xlsx`) or the compound-file signature (`.xls`) is accepted. For any other file the app shall show an error that names the file and says it is not an Excel workbook.

**UI-1.4** If the user drops more than one file, then the app shall exhume the first file and show a message that the others were ignored.

**UI-1.5** If a file is larger than 50 MB, then the app shall refuse it with a message stating the size and the limit, before reading it into memory.

**UI-1.6** While a file is being read and exhumed, the app shall show "Exhuming" in a polite live region, and shall disable the drop zone and the demo buttons.

**UI-1.7** If exhuming fails (corrupt archive, `CFBFormatError`, `OVBADecompressError`, a thrown error from the workbook adapter), then the app shall show the error text and keep the previously loaded workbook, if any, unchanged.

**UI-1.8** After the page has loaded, the app shall make no network request. This covers `fetch`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon`, web fonts, remote scripts, remote images and analytics. The page shall carry a Content-Security-Policy `<meta>` with `default-src 'self'` and `connect-src 'none'` so that the browser enforces this.

**UI-1.9** The app shall work with the network disabled after the first load of the page.

### UI-2 Exhume view

**UI-2.1** When a workbook has been exhumed, the app shall show: the file name and size; the sheets (name, used rows and columns); the VBA modules (name, kind, number of lines); and the macros.

**UI-2.2** The app shall list as a macro every `Sub` that has no parameters and is not `Private`, as `Module.Name`, in module order and then source order. `Function`s, `Private` Subs and Subs with parameters are not listed as macros. The view shall state how many other procedures exist, so that the list does not look complete when it is not.

**UI-2.3** For each macro the app shall show a prediction from the static scan, computed without running anything: "Predicted: fully resurrected" when no unsupported construct is reachable from the macro, otherwise "Predicted: partly resurrected" with the number of constructs and their lines. The prediction shall be labelled as a prediction.

**UI-2.4** When the macro has been run, the app shall show the actual status next to the prediction. If the two differ, the app shall show both and shall not hide the prediction.

**UI-2.5** If the workbook contains no VBA project (`NoVBAProjectError`, or a `.xls`), then the app shall say so in words ("No VBA project found", "VBA in .xls files cannot be read yet"), still show the sheets, and offer no macros.

**UI-2.6** If a module cannot be parsed (`ParseError`), then the app shall list the module with the error message and line, shall not offer macros from that module, and shall still offer macros from the other modules.

### UI-3 Running a macro and the result grid

**UI-3.1** When the user activates "Run" for a macro, the app shall run it with `runMacro` against a fresh copy of the loaded workbook (opened again from the original bytes).

**UI-3.2** While a macro runs, the app shall disable all Run buttons, show "Running" in the live region, and let the browser paint that state before the interpreter starts.

**UI-3.3** When a run ends, the app shall show: the status exactly as returned by `runMacro` ("fully resurrected", "partly resurrected" or "failed"); the number of cells changed; the numbers of reads and writes; and the duration in milliseconds. If `RunResult.error` is set, the app shall show its message, and its module and line when it has them.

**UI-3.4** The app shall show the result sheet as a grid with column letters, row numbers and the cell values, with one tab per sheet. After a run, the first selected tab shall be the first sheet that has a changed cell, otherwise the active sheet.

**UI-3.5** A cell is changed when its value at the end of the run differs from its value in the loaded file (a cell that is written and then restored is not changed; a cell that is cleared is changed). The app shall mark changed cells with a visual treatment that does not rely on colour alone (a bar on the cell's leading edge and a bold value) and shall expose the previous value to assistive technology ("changed, was 12").

**UI-3.6** The grid shall mark every cell that holds a formula, and, on a sheet that has formulas, shall show the note "Formulas are not recalculated. Cached values from the file are shown."

**UI-3.7** The grid shall show numbers with up to 15 significant digits and no locale rounding, booleans as `TRUE` and `FALSE`, empty cells as empty, and strings as stored. Long strings are truncated visually, with the full value available on focus.

**UI-3.8** The grid shall render only the cells in and near the visible area, so that the number of DOM nodes does not depend on the size of the sheet.

**UI-3.9** Before any run, the grid shall show the sheets as loaded, with no highlighting.

### UI-4 Trace panel

**UI-4.1** After a run, the trace panel shall list every `TraceEvent` in the order they happened. Each row shows the event kind, the cell address with its sheet, the value (for a read) or the before and after values (for a write), and `Module:line`. Events of kind `unsupported` are shown as "skipped" with the construct name.

**UI-4.2** The trace panel shall offer filters by kind (read, write, skipped) and by sheet. The panel header shall show the number of events shown and the total.

**UI-4.3** When the user selects a trace row (click, or Enter or Space on the focused row), the app shall: switch the grid to the event's sheet, scroll to the cell and mark it as selected; switch the source view to the event's module, scroll to the line and mark it as selected. For a "skipped" row only the line is marked.

**UI-4.4** The trace list shall render only the rows near the visible area. The row selection shall survive filtering when the selected row is still shown, and shall be cleared when a new run starts.

**UI-4.5** When the user is on a screen narrower than the two-column layout, each trace row shall also provide "Go to cell" and "Go to line" controls that switch to the grid and to the source view.

**UI-4.6** Before any run, the trace panel shall say that no macro has run yet.

### UI-5 Graveyard panel

**UI-5.1** As soon as a workbook has been exhumed, the graveyard panel shall list every unsupported construct found by `scanUnsupported`, with module, line and construct name, grouped by module. The count shall be visible in the panel's tab label.

**UI-5.2** After a run, the panel shall mark each entry as "skipped during this run" (a runtime hit under `On Error Resume Next`), "stopped the run" (equal to `stoppedAt`) or "not reached". An unsupported hit that the run reports but the static scan did not list shall be added to the list and not dropped.

**UI-5.3** When `RunResult.stoppedAt` is set, the app shall show it in a banner at the top of the panel and in the result bar: "Run stopped at `Module:line` (`construct`)".

**UI-5.4** When the user selects a graveyard entry, the source view shall show its module and mark its line.

**UI-5.5** If the workbook has no unsupported construct, the panel shall say "Nothing in the graveyard".

### UI-6 VBA source view

**UI-6.1** The source view shall show one module at a time, with a module picker, as read-only monospace text with a line-number gutter. Line numbers are 1-based and are the same numbers that `UnsupportedHit`, `TraceEvent.statement` and `stoppedAt` use.

**UI-6.2** Lines that appear in the graveyard shall carry a gutter marker with a text alternative ("unsupported: Open"). The selected line shall be marked and scrolled into view.

**UI-6.3** Selecting and copying source text shall not include line numbers.

**UI-6.4** The source view shall be focusable by keyboard and scrollable in both directions without wrapping lines.

**UI-6.5** The app shall show the module text exactly as `extractModules` returns it, decoded with the project's code page (Cyrillic comments and strings from a CP1251 project are readable).

### UI-7 Download

**UI-7.1** When a run has finished (any status), the app shall enable "Download .xlsx". Until then, it shall be disabled and shall say why ("Run a macro first").

**UI-7.2** When the user activates it, the app shall call `save()` on the workbook of the last run and offer the bytes as a Blob with type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, named `<base name>-resurrected.xlsx`, through a temporary object URL that is revoked afterwards.

**UI-7.3** If the last run's status is not "fully resurrected", the button's description shall say that the file contains partial results.

**UI-7.4** The downloaded file shall be macro-free and shall contain the values written by the macro. Formulas stay as formulas with their cached values.

### UI-8 Built-in demo

**UI-8.1** The landing view shall show a "Try the demo" button that exhumes the bundled `demo_acts.xlsm`, and a second button, "Try the graveyard sample", that exhumes the bundled `graveyard.xlsm`. Neither needs a file or a network.

**UI-8.2** The bundled files shall be embedded in the JavaScript at build time and decoded in the page. Exhuming them shall call the same function as exhuming a dropped file.

**UI-8.3** The bundled bytes shall be identical to `fixtures/build/demo_acts.xlsm` and `fixtures/build/graveyard.xlsm` at the time of the build. A test shall fail if they are not.

**UI-8.4** The demo buttons shall say that the sample workbooks contain made-up data.

### UI-9 Accessibility

**UI-9.1** Every function of the app shall be operable with the keyboard alone. The tab order follows the visual order. A "Skip to workbook" link is the first focusable element.

**UI-9.2** Tab lists (sheets, modules, panels) shall follow the WAI-ARIA tabs pattern: arrow keys move between tabs, Home and End go to the first and last tab. The grid shall follow the grid pattern: one tab stop, arrow keys, Home, End, Page Up, Page Down and Ctrl+Home move the focused cell. The trace list shall have one tab stop, with arrow keys moving between rows.

**UI-9.3** Focus indicators shall be at least 2 px thick and have a contrast ratio of at least 3:1 against adjacent colours, in both colour schemes.

**UI-9.4** All text shall have a contrast ratio of at least 4.5:1 and all interface component boundaries and state indicators at least 3:1, in the light and in the dark scheme.

**UI-9.5** The app shall use landmarks (`header`, `main`) and a single `h1`. Status changes (exhuming, running, result, download ready, errors) shall be announced through a polite live region (`role="status"`), errors through `role="alert"`.

**UI-9.6** At a viewport width of 375 CSS pixels the page shall have no horizontal scroll, all functions shall remain available, and interactive controls shall be at least 44 by 44 CSS pixels. The grid and the source view scroll inside their own containers.

**UI-9.7** The app shall not use animation. Transitions, if any, shall be removed under `prefers-reduced-motion: reduce`.

### UI-10 Visual identity

**UI-10.1** The necromancy theme shall live in naming and a few small touches: the view and action names Exhume, Resurrect and Graveyard; a one-colour inline SVG tombstone mark in the header; status words "Fully resurrected" and "Partly resurrected"; the empty-state line "Nothing buried here yet". Labels shall stay plain enough that the function is clear without knowing the theme (a button that runs a macro is labelled "Run").

**UI-10.2** The palette shall be restrained: parchment and ink in the light scheme, charcoal and bone in the dark scheme, one oxidised-green accent, one ochre for changed cells, one brick red for the graveyard and errors.

**UI-10.3** The app shall not use gradients, glows, blurred shadows or text shadows, emoji or pictographs in any label, title or source file, or purple as a theme colour.

**UI-10.4** The app shall use system font stacks and a monospace stack for source and grid, and no web fonts.

**UI-10.5** A test shall check UI-10.3 and UI-10.4 mechanically on `app/index.html`, `app/src/**` and the built CSS.

### UI-11 Static production build

**UI-11.1** `npm run build -w app` shall produce a static site in `app/dist` that works when served from any sub-path (for example `https://<user>.github.io/vba-necromancer/`) and from the root. All asset URLs in `index.html` and the CSS shall be relative.

**UI-11.2** The app shall not use client-side routes, so that a reload at the sub-path always works and GitHub Pages needs no 404 fallback.

**UI-11.3** The built `index.html` and CSS shall not reference any `http://` or `https://` URL.

**UI-11.4** The repository shall contain a GitHub Actions workflow that installs, tests, builds and deploys `app/dist` to GitHub Pages.

**UI-11.5** The build shall print the size of the JavaScript and CSS (raw and gzip). The total gzip size shall stay under 600 KB; the build fails above it.

### UI-12 Performance

**UI-12.1** For the 40-row demo workbook, exhuming, running and deriving the view model shall take under 100 ms excluding rendering, and the result shall appear without a visible wait.

**UI-12.2** For a workbook with 5 000 data rows and the `BuildActs` macro, exhuming, running and deriving the view model shall take under 2 000 ms, and rendering the grid, the trace panel and the source view shall create a number of DOM nodes that is bounded by the visible area (at most 400 cell nodes, at most 100 trace row nodes).

**UI-12.3** Selecting a trace row shall update the grid and the source view in one render, without scanning all events.

### UI-13 Honest reporting

**UI-13.1** The UI shall display the `status` of `RunResult` as it is, and shall not compute, upgrade or soften it.

**UI-13.2** Every entry of `staticUnsupported` and of the run's `unsupported` shall be reachable in the UI. No count shown in the UI shall be lower than the number of entries behind it.

**UI-13.3** The limits in the Scope section (no recalculation, no buttons, no `.xls` VBA, no number formats) shall be written in the app, in a "What this does not do yet" section reachable from the footer, so that a user is not misled by an empty or stale-looking result.

## Acceptance

- `app/` builds with `npm run build -w app`; `npm run typecheck` and `npm run lint` pass with the app included; `npm test` runs the app tests.
- Component tests cover each UI group. A component test of the whole `App` loads `demo_acts.xlsm` through the same function as the UI, runs `BuildActs`, and compares the grid cells with `fixtures/expected/demo_acts.json` (UI-3, UI-4, UI-6, UI-7, UI-8).
- A second end-to-end test loads `graveyard.xlsm` through the file input and compares the graveyard panel with `fixtures/expected/graveyard.json`, including `stoppedAt` for `ExportStrict` (UI-5).
- The prediction from the static scan is checked against every macro in `fixtures/expected/*.json`: it is never "fully" when the run is "partly" for a construct that the static scan lists (UI-2.3).
- Automated checks: contrast ratios from the design tokens (UI-9.4), banned CSS and emoji (UI-10.5), relative URLs in `dist` (UI-11), network calls after load (UI-1.8), performance budgets (UI-12).
- A manual checklist in `docs/ui-checklist.md` covers what jsdom cannot check: real keyboard walk-through, 375 px layout, light and dark rendering, and a download opened in LibreOffice or Excel.
