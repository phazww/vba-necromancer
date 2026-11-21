# Kiro usage log — VBA Necromancer

This file records how Kiro was used during development of this repository.
Facts are drawn from `git log` and the files under `.kiro/`.

---

## Spec session — `vba-resurrection-core`

The first commit (`d4ca506`) added `.kiro/specs/vba-resurrection-core/` alongside the
steering docs and `CONCEPT.md`. Kiro CLI in spec mode (`kiro-cli chat --mode spec`) generated requirements, design and tasks
as three documents before any code was written, from `CONCEPT.md` and the steering docs.

- `requirements.md` — functional and correctness requirements (REQ-01 through REQ-13)
- `design.md` — architecture decisions: CFB reader, OVBA decompressor, lexer/parser/interpreter, workbook adapter, trace model
- `tasks.md` — 17 ordered tasks (TASK-01 through TASK-17) with explicit file lists and test criteria

---

## Tasks Kiro implemented

Each task below was implemented by Kiro CLI (`kiro-cli chat --no-interactive`), then reviewed and committed
by the developer (commit author `phazww`). Review was done by hand with Claude Code as a second reviewer;
the hand-written oracles in `fixtures/expected/` and `spec-examples.test.ts` come from that review.

| Task | Commit | What was done |
|------|--------|---------------|
| TASK-01 | `40c3a84` | npm workspaces scaffold, TypeScript strict, Vitest, ESLint, Vite app skeleton |
| TASK-02..04 | `d36580f` | CFB/OLE2 parser, MS-OVBA decompressor, `dir` stream parser, module extraction |
| TASK-05..06 | `fc00662` | VBA lexer (property-tested, never throws), recursive-descent parser, unsupported statements become AST nodes with line numbers |
| TASK-07 | `8077d07` | Numeric semantics: `coerce.ts` with banker's rounding, integer overflow (`RuntimeError(6)`), integer division, `Mod`, Date epoch |
| TASK-08 | `02ef5e3` | Tree-walking interpreter: typed Integer/Long arithmetic, `Err` object, `On Error`, built-ins |
| TASK-10..15 | `514902c` | SheetJS workbook adapter, execution trace, unsupported-construct reporting with a static scan, `WorksheetFunction`, end-to-end fixture tests |
| DTASK-01..09 | `df9bebe` | `Scripting.Dictionary` shim (spec `scripting-dictionary`: design and tasks by Kiro, requirements by the developer) |
| UTASK-01..24 | `e012744` | Browser UI (spec `resurrection-ui`), see below |

TASK-09 (fixture builder) was started by Kiro and finished by hand, see "Review findings" below.

---

## Two correctness findings fixed by Kiro

### 1 — Inverted CopyToken bit-table (TASK-02..04, commit `d36580f`)

The MS-OVBA known-answer test (`packages/ovba/tests/spec-examples.test.ts`) applies the
example from MS-OVBA §3.2.2. That vector contains CopyTokens (back-references); a pure
literal compressor cannot exercise this path. The test was added during review, after Kiro's own 18 tests were green.
Kiro's first decompressor implementation failed it because the bit table that maps decompressed-window size to CopyToken
length/offset field widths was inverted. The fix corrected the table and added a real
LZ77 compressor (`packages/ovba/src/compress.ts`) so round-trip property tests cover
back-references, not just literal-only streams.

### 2 — Epsilon rounding replaced by exact rational rounding (TASK-07, commit `8077d07`)

The initial approach to banker's rounding (`Round(2.675, 2)`) added a small epsilon before
rounding to work around IEEE 754 representation error. This produced wrong results for
values where the epsilon pushed the wrong way. The fix computes the rounding decision
using exact rational arithmetic on the integer mantissa and decimal exponent of the stored
double, so `Round(2.675, 2)` returns `2.67`, matching VBA (documented case: VBA `Round(32.675, 2)` = 32.67),
without an epsilon hack. Note that Excel's worksheet `ROUND` is a different function and is not modelled here.
This is implemented in `packages/vba/src/coerce.ts`, function `roundHalfEvenTo`.

---

## Steering documents

Three workspace-level steering files are always injected into every Kiro session:

| File | Content |
|------|---------|
| `.kiro/steering/product.md` | Product brief: problem statement, what the product does, target users, principles |
| `.kiro/steering/structure.md` | Directory layout, package responsibilities, conventions (every feature lands with tests, `UnsupportedError` for unsupported constructs, no network calls from packages) |
| `.kiro/steering/tech.md` | Technology choices (TypeScript strict/ES2022, Vite + Preact, SheetJS behind a `Workbook` interface, hand-written lexer/parser/interpreter, Vitest + fast-check), correctness rules (VBA numeric semantics, string comparison, array semantics, date epoch) |

---

## Agent hooks

Three hooks in `.kiro/hooks/` automate quality gates:

### `test-on-interpreter-change.json` — Test on interpreter change

**Trigger:** `PostFileSave`, matcher `packages/([^/]+)/src/.*\.ts$`  
**Action:** `command` — extracts the package name from the saved path, then runs
`npm test --workspace=packages/<pkg>` and streams the last 40 lines of output.  
**Purpose:** fast feedback loop; a broken package fails immediately when its source changes.

### `spec-guard.json` — Spec guard

**Trigger:** `PostFileSave`, matcher `fixtures/expected/.*\.json$|packages/ovba/tests/spec-examples\.test\.ts$`  
**Action:** `agent` — injects a prompt requiring the agent to explain why the oracle file
was changed, what the old and new values are, and how the correctness of the new value
was verified independently. Instructs the agent to stop and revert if the edit exists only
to make a test pass.  
**Purpose:** these files are hand-written oracles; the implementation must match them, not
the other way around.

### `fixture-rebuild.json` — Fixture rebuild

**Trigger:** `PostFileSave`, matcher `fixtures/src/`  
**Action:** `command` — runs `npm run fixtures:build` (defined in TASK-09) followed by
the `packages/ovba` test suite.  
**Purpose:** keeps the generated `.xlsm` fixtures in `fixtures/build/` in sync with their
VBA source whenever a `.bas` or `cells.json` changes.

---

## Review findings fixed by the developer after Kiro's free credits ran out (17 Nov)

Kiro implemented TASK-09 (fixture builder) until the monthly free-tier limit stopped it with 5 failing tests. The rest was finished by hand, and an **independent reader** was added as an oracle: `olevba` from oletools (`tools/crosscheck_olevba.py`), which had not been part of the loop before.

1. **Test bug, not a ZIP bug.** `new Uint8Array(readFileSync(p).buffer)` reads Node's whole 8 KB buffer pool for files under 4 KB, so small fixtures looked corrupt and only the 5 KB demo workbook passed. Fixed with `new Uint8Array(readFileSync(p))`.
2. **Hand-written ZIP and CFB writers replaced** by fflate (ZIP) and SheetJS `cfb` (Compound File Binary). Our own reader and writer agreed with each other, but `olevba` could not read the result.
3. **PROJECT stream location.** It must sit in the root storage next to `VBA/` (MS-OVBA 2.2.1), not inside it.
4. **Chunk size semantics.** `CompressedChunkSize` counts the whole chunk including its 2-byte header (MS-OVBA 2.4.1.1.5); both compressor and decompressor had it as data-only, which only works for a single last chunk (as in the 3.2.2 example). Raw chunks now use header 0x3FFF, and the decompressor validates the 0b011 signature.
5. **dir stream.** The parser treated PROJECTVERSION (0x0009) as a normal `Id|Size|Data` record (it is `Id|Reserved=4|Major(4)|Minor(2)`) and expected a non-standard PROJECTMODULES layout, so it would have failed on every real Excel file. Rewritten per MS-OVBA 2.3.4.2 with a single record walk; a matching `writeDirStream` builds fixtures. Module names are decoded with the project code page.

Result: all six fixture workbooks of that day (eight today) are read by `olevba` with sources identical to `fixtures/src/*/Module1.bas`, including Cyrillic text in code page 1251.

---

## Spec session — `resurrection-ui`

`.kiro/specs/resurrection-ui/` holds `requirements.md` (UI-1 to UI-13), `design.md` (Preact, one reducer, a pure model layer, windowed grid and lists, CSP, token table with contrast ratios) and `tasks.md` (UTASK-01 to UTASK-24). The workspace steering files (`product`, `structure`, `tech`) apply. Spec and implementation were committed together as `e012744`.

Kiro implemented UTASK-01 to UTASK-24 in order in one non-interactive session, running `npm test`, `npm run lint`, `npm run typecheck` and the app build after each task before marking it done in `tasks.md`. `packages/*`, `fixtures/expected/*.json` and the `.gitignore` entries for `.agy-bridge` and `HANDOFF_CONTEXT.md` were not edited.

| Tasks | What was done |
|-------|---------------|
| UTASK-01 | Preact skeleton, Vitest workspace with a jsdom `app` project, `?inline` import of the demo `.xlsm` files through a small Vite plugin (the built-in `?inline` returns a path under Vitest) |
| UTASK-02 to 07 | Model and state: file sniffing, `exhume`, macro list, prediction from the static scan, `resurrect`, changed cells, graveyard marks, formatting, windowing function, reducer and actions |
| UTASK-08 to 12 | Tokens and contrast tests, theme lint, app shell with landmarks and live region, drop zone, demo buttons and CSP, exhume panel, ARIA tabs |
| UTASK-13 to 18 | Grid, source view, result bar and download, trace panel, graveyard panel, wide and narrow layouts |
| UTASK-19 to 21 | Two end-to-end tests through the DOM (`demo_acts`, `graveyard` through the file input) and the performance tests |
| UTASK-22 to 24 | Production build with size report, sub-path serving test, Pages workflow, accessibility sweep, `docs/ui-checklist.md`, README and backlog updates |

Things found on the way, in the order they came up:

1. **`File` has a `bytes()` method** in current Node and browsers, so `"bytes" in source` cannot tell a `File` from `{ name, bytes }`. Dropping a real `File` failed with "not an Excel workbook" until the check looked at the property's type.
2. **Passive effects run after the test looks.** The window drop listeners were registered in `useEffect` and were missing for a moment after the workbook appeared; `useLayoutEffect` closes that gap.
3. **A million-cell scan inside `Range.End(xlUp)`** costs about 90 ms on any macro that uses `Cells(Rows.Count, 1).End(xlUp)`. That alone makes the 100 ms budget for the 40-row demo fail. Not fixed here (`packages/*` is out of bounds); recorded in `BACKLOG.md` item 8, the test for the budget is skipped, and a looser regression guard runs in its place.
4. **SheetJS keeps a stale `<dimension>`.** A cell outside `!ref` is still readable. A bound on the `End` scan taken from `usedRowCount()` would therefore change results for such files, which is why the backlog item asks for a bound from the cells present.
5. **A 5 000 line source module did not render under 200 ms reliably** when the other test files ran in parallel (170 to 350 ms). Modules over 1 000 lines now draw only the lines near the viewport (3 ms); shorter modules are still drawn in full.
6. **`Go to cell` and `Go to line` sit under the trace list**, not on every row, because a button inside a `role="option"` row is a nested interactive control (`BACKLOG.md` item 13).

Open items for a person: the manual checks in `docs/ui-checklist.md`, the first deploy and the live demo link in the README, and the `git commit`.

---

## After the Kiro specs (developer with Claude Code)

- `e700bfc`: visual polish of the UI (first screen with a preview of the demo result, quieter panels, wider grid columns, mobile layout), MIT license.
- `21c2952`: an English twin of the demo workbook (`demo_invoice`) as the default demo, so the result reads without knowing Russian. Its expected results were recomputed in plain Python from its own input cells and checked against `demo_acts.json` number for number; `olevba` reads it like the others. The Russian workbook stays as the code page 1251 sample.

State on 19 Nov: eight fixture workbooks match their hand-written oracles, all eight are read identically by `olevba`, 655 tests pass.

---

## The sheet-buttons spec

`.kiro/specs/sheet-buttons/` (requirements in EARS form BTN-01..08 and END-01..03, a design and thirteen tasks) was implemented task by task, with `npm test`, `npm run lint`, `npm run typecheck` and `npm run build -w app` run after each one before the task was marked done. Writing the tasks as a strict order (bounds for `Range.End`, then the XML scanner, then each reader, then the fixture builder, then the UI) meant every task could be checked on its own. The spec caught several things that a looser request would have missed: it required that fixtures without buttons keep the same `xl/` parts and that building twice gives identical bytes, and that check showed `fflate` stamps the current time into every ZIP entry, so each rebuild changed every `.xlsm`; the builder now passes a fixed modification time, and the six fixtures without buttons were left as committed. It also required that a corrupt drawing part is reported by name and does not hide the other drawings, which meant inflating each drawing in its own `try` instead of one `unzipSync` for all parts. The result of the `Range.End` work is in `docs/ui-checklist.md` (40-row exhume + run: medians of 2.3 to 2.5 ms against the 100 ms budget).

Review after the sheet-buttons run (developer with Claude Code, 20 Nov): the requirements were written by the developer, design and tasks by Kiro. Checked independently: `fixtures/expected` and the MS-OVBA known-answer test were not touched; all 759 tests, lint, typecheck and build pass; olevba still reads all eight fixtures identically; LibreOffice (an independent reader) opens the rebuilt `demo_invoice.xlsm` and shows a "Build invoice" push button anchored on sheet Log. LibreOffice does not show which macro the button calls, so the macro link itself is checked only by our own reader, and the file has still not been opened in desktop Excel.


---

## The parser-fixes spec (21 Nov)

`.kiro/specs/parser-fixes/`: requirements by the developer (LIT-01..04 for `&H` and `&O` literals with a hand-written table of fourteen expected values, CALL-01..02 for `Foo -1, 2`, END-01..02 for procedure end lines), design and tasks PTASK-01..06 by Kiro. Kiro implemented the six tasks with the full check run after each. One existing UI-model test changed: the old `procedureSpans` guess (a Sub runs up to the line before the next one) gave 5–19 for the first graveyard macro; with `endLine` it is 5–18, and line 18 is the `End Sub` in `fixtures/src/graveyard`.

Review (developer with Claude Code): an independent test outside Kiro's suite ran every row of the literal table through the interpreter, checking both the value and `TypeName`; all fourteen matched. The same check found a bug that predates the spec: `x = 2^3` stored 2 and stopped, because the lexer took `^` after a decimal number as a LongLong type suffix (`2 ^ 3` with spaces worked). It went back to Kiro as an addendum (POW-01, task PTASK-07) with expected values written first; Kiro also found that `^` was right-associative and made it left-associative, so `2^3^2` gives 64. After PTASK-07, 838 tests, lint, typecheck and build pass, and `fixtures/expected` is untouched.

---

## The number-formats spec

`.kiro/specs/number-formats/`: requirements by the developer (FMT-01..06 and a hand-written table of 22 stored value and format pairs with the expected text), design and tasks NTASK-01..07 by Kiro, then implemented task by task with the four checks after each. The oracle table was not changed. What the work found: a time-only row (`0.5` with `h:mm` is `12:00`) showed that the "serials of 61 and above" rule must apply only to formats with a day, month or year, so the design was corrected instead of the row; SheetJS reports `General` for cells without a format, so the accessor treats it as no format; the General property test found that `formatValue` throws near `Number.MAX_VALUE` (BACKLOG); and the committed `.xlsm` files have older ZIP timestamps than the builder writes, so the old-fixture check compares part contents. Details in `docs/number-formats.md`.

## The number-formats spec (21 Nov)

`.kiro/specs/number-formats/`: requirements and a 22-row table of expected display text by the developer (the dates were computed separately from the 1899-12-30 epoch in Python), design and tasks NTASK-01..07 by Kiro, implemented by Kiro with the full check run after each task.

Review (developer with Claude Code): an independent test outside Kiro's suite ran all 22 rows through `formatNumber`; all matched. The same rows were run through SheetJS's own formatter as a second, independent implementation: it disagreed on five rows, three by design (`[Red]`, fractions and `dd.mm.yyyy` it could not parse) and two on rounding (`-2.5` with `0` gives `-2`, `1.005` with `0.00` gives `1.00`). LibreOffice, a third reader, opened the built `number_formats.xlsm` and showed every row exactly as the table says (in its Russian locale: decimal comma, space as thousands separator, Russian month names), including `-3`, `1,01` and `,5`; so the builder writes the formats correctly and the rounding rule matches a spreadsheet application. Not checked in desktop Excel. The grid formats with `.` and `,` regardless of the user's locale; olevba reads all nine fixtures; the eight older built fixtures are byte-identical; 940 tests, lint, typecheck and build pass.

## The vbscript-readiness spec

`.kiro/specs/vbscript-readiness/`: requirements by the developer (REF-01..02, VBS-01..03 and a three-row table of expected findings), design and tasks VTASK-01..06 by Kiro, implemented task by task with the four checks after each. The oracle `fixtures/expected/vbscript_deps.json` was written before the scanner; it was not changed. Reading the MS-OVBA pages for REFERENCECONTROL before coding changed the design: `LibidTwiddled` is normally a placeholder GUID, so the real libid is `LibidExtended`, and the leading REFERENCENAME belongs to the whole reference. The first scanner run flagged `CreateObject("WScript.Shell")` because the ProgID contains the word `wscript`; the negative test written from the requirements caught it and the scanner, not the test, was fixed. The committed `.xlsm` files again had older ZIP timestamps than the builder writes, so the byte-identity check compares ZIP entry contents.

Review of the vbscript-readiness spec (developer with Claude Code, 21 Nov): the reference record written for `vbscript_deps` was decoded independently, with oletools' MS-OVBA decompressor and a separate walk of the dir records; it holds the name `VBScript_RegExp_55` and the libid from the requirements table, and `demo_invoice` holds no reference. olevba reads all twelve modules of the nine fixtures plus `vbscript_deps`. LibreOffice opens the new workbook. One rule was widened by the developer after review: a `.vbs` path followed by closing quotes inside the literal (`Shell "cmd /c ""C:\a b\nightly.vbs"""`) is now found, with a test; `report.vbsx` is still not. 1029 tests, lint, typecheck and build pass.
