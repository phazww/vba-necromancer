# VBA Necromancer

**Old Excel macros, alive again in the browser.** Drop an `.xlsm` file and run its VBA macros without desktop Excel, without Windows, and without uploading the file anywhere.

Kiroween 2026 entry, category **Resurrection**. Built spec-first with [Kiro](https://kiro.dev).

> Status: the file layer, the interpreter and the browser UI work end to end on the fixture workbooks. This README says what works today, not what is planned. Live demo: **https://phazww.github.io/vba-necromancer/** (click "Try the demo", then Run). Demo video (2 min): https://youtu.be/Hqbf-bfTuKg

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
| Interpreter, `Range`/`Cells`, execution trace | done for the fixture subset | all eight fixture workbooks match their hand-written expected results in `fixtures/expected/` |
| `Scripting.Dictionary` (`CreateObject` and `New`) | done | unit and property tests; `dictionary_grouping` fixture matches its hand-written oracle and the array version cell by cell. Details: `docs/scripting-dictionary.md` |
| Browser UI | works end to end | drop or choose a file (or use the three built-in samples: an English demo, the same job as a Russian workbook in code page 1251, and the graveyard), list sheets, modules and macros with a prediction from the static scan, run a macro, see changed cells in the grid, the trace, the graveyard and the VBA source, download the result as `.xlsx`. Tested with component tests, two end-to-end tests that drive the DOM, axe checks, performance budgets and a build test. `docs/ui-checklist.md` lists what still needs a person: real keyboard and screen reader walk, 375 px, light and dark, offline reload, the download opened in Excel or LibreOffice |

What the UI does not do yet: it does not read the buttons drawn on a sheet (macros are listed and run from a list), it cannot read VBA from legacy `.xls` files (the sheets open, the macros do not), it does not recalculate formulas (cached values are shown), and it does not apply number formats (dates and currency show as stored numbers). The same list is in the app, under "What this does not do yet". One performance budget is not met: running `BuildActs` on the 40-row demo takes 95 to 150 ms instead of under 100 ms, because of a scan in `packages/workbook` (`BACKLOG.md`, item 8).

## Honest by design

Anything the interpreter cannot run (UserForms, Windows API `Declare`, COM objects such as `CreateObject("Outlook.Application")`, file I/O) is listed in a "graveyard" with module and line, and the macro is marked **partly resurrected**. Nothing is silently skipped.

## Fixtures

`fixtures/src/` holds business-shaped modules: acts by category, a labour statement, numeric edge cases, strings, an unsupported-feature graveyard, Dictionary grouping, and the 40-row demo workbook in two languages (`demo_invoice` in English, `demo_acts` in Russian with code page 1251; same numbers). Each has expected results in `fixtures/expected/`, written by hand before the interpreter could run them, and cross-checked with an independent Python calculation where arithmetic is involved. All names and numbers are made up.

```bash
npm install
npm test                 # unit, property and fixture tests
npm run fixtures:build   # rebuild fixtures/build/*.xlsm from fixtures/src
python3 -m venv .venv-tools && .venv-tools/bin/pip install oletools==0.60.2
.venv-tools/bin/python tools/crosscheck_olevba.py   # independent check of the built files
```

## How it was built with Kiro

See [`docs/kiro-usage.md`](docs/kiro-usage.md): the spec (`.kiro/specs/vba-resurrection-core`), steering docs, agent hooks, which tasks Kiro implemented, and which bugs review caught and how.

## Run and deploy

```bash
npm install
npm run dev -w app       # dev server for the browser UI
npm run build -w app     # static site in app/dist, with a size report
npm run preview -w app   # serve app/dist locally
```

The build is a static site with relative URLs (`base: "./"`), so it works from any sub-path. It makes no network request after the page has loaded, and the page carries a Content-Security-Policy that forbids connections. The build prints the raw and gzip size of every file and fails when the total gzip size is over 600 KB.

The live demo is the built `app/dist`, published to the `gh-pages` branch. To deploy with GitHub Actions instead (typecheck, lint, tests, build, deploy on every push to `main`), copy `docs/ci/pages.yml` to `.github/workflows/` and set Settings, Pages, Source to "GitHub Actions".

## Layout

```
packages/ovba      ZIP, CFB, MS-OVBA decompression, dir stream, module extraction
packages/vba       lexer, parser, numeric semantics, interpreter
packages/workbook  workbook model over an xlsx library
app/               browser UI (Preact, Vite): model, state, components, tests
fixtures/          VBA sources, expected results, builder, built .xlsm files
tools/             independent cross-checks
```

## License

[MIT](LICENSE).
