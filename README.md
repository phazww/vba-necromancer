# VBA Necromancer

**Old Excel macros, alive again in the browser.** Drop an `.xlsm` file and run its VBA macros without desktop Excel, without Windows, and without uploading the file anywhere.

Kiroween 2026 entry, category **Resurrection**. Built spec-first with [Kiro](https://kiro.dev).

> Status (18 Nov 2026): the file layer is done and verified; the interpreter and the UI are in progress. This README says what works today, not what is planned.

## Why

Millions of business workbooks still depend on VBA: monthly acts, labour statements, payroll sheets, report generators. VBA does not run in Excel for the web, in Google Sheets, on phones, or anywhere without desktop Excel. The people who wrote those macros have often left. The macros are dead, but the work they did is still needed.

## What works today

| Part | Status | How it is checked |
|---|---|---|
| Read `.xlsm` (ZIP) and `vbaProject.bin` (Compound File Binary) | done | unit tests; real fixtures |
| MS-OVBA decompression | done | known-answer test from the MS-OVBA spec (section 3.2.2), 10 000-run round-trip property test with back-references |
| `dir` stream: modules, stream names, code page | done | written per MS-OVBA 2.3.4.2; fixtures read identically by **olevba** (oletools), an independent implementation |
| Module source with Cyrillic text (code page 1251) | done | same cross-check |
| VBA lexer | done | property test: never throws on arbitrary input |
| VBA parser | done | parses every fixture module; unsupported statements become AST nodes with line numbers |
| VBA numeric semantics | done | `CInt`/`CLng`/`Round` banker's rounding on the stored double (`Round(2.675, 2) = 2.67` as in VBA), `\` and `Mod` operand rounding, Integer overflow = error 6, VBA Date epoch 1899-12-30 |
| Interpreter, `Range`/`Cells`, execution trace | in progress | hand-written expected results in `fixtures/expected/` |
| Browser UI | in progress | |

## Honest by design

Anything the interpreter cannot run (UserForms, Windows API `Declare`, COM objects such as `CreateObject("Outlook.Application")`, file I/O) is listed in a "graveyard" with module and line, and the macro is marked **partly resurrected**. Nothing is silently skipped.

## Fixtures

`fixtures/src/` holds six business-shaped modules (acts by category, labour statement, numeric edge cases, strings, an unsupported-feature graveyard, a 40-row demo workbook). Each has expected results in `fixtures/expected/`, written by hand before the interpreter could run them, and cross-checked with an independent Python calculation where arithmetic is involved. All names and numbers are made up.

```bash
npm install
npm test                 # unit, property and fixture tests
npm run fixtures:build   # rebuild fixtures/build/*.xlsm from fixtures/src
python3 -m venv .venv-tools && .venv-tools/bin/pip install oletools==0.60.2
.venv-tools/bin/python tools/crosscheck_olevba.py   # independent check of the built files
```

## How it was built with Kiro

See [`docs/kiro-usage.md`](docs/kiro-usage.md): the spec (`.kiro/specs/vba-resurrection-core`), steering docs, agent hooks, which tasks Kiro implemented, and which bugs review caught and how.

## Layout

```
packages/ovba      ZIP, CFB, MS-OVBA decompression, dir stream, module extraction
packages/vba       lexer, parser, numeric semantics, interpreter (in progress)
packages/workbook  workbook model over an xlsx library (in progress)
app/               browser UI (in progress)
fixtures/          VBA sources, expected results, builder, built .xlsm files
tools/             independent cross-checks
```

## License

To be added before the repository is made public (the hackathon requires an open-source license).
