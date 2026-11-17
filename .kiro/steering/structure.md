# Structure

```
packages/
  ovba/          CFB reader use, MS-OVBA decompression, dir stream, module extraction
  vba/           lexer, parser (AST), interpreter, runtime library (built-ins), errors
  workbook/      Workbook interface + adapter over the xlsx library; Range/Cells model
app/             browser UI (drop zone, macro list, run, trace view, graveyard, download)
fixtures/
  src/           VBA source + initial cell data per fixture (plain text/JSON)
  build/         script that produces .xlsm files from src (generated, not hand-edited)
  expected/      expected cell values after running each macro, written by hand before the first run
docs/            write-up, Kiro usage notes, demo script
```

## Conventions
- Every interpreter feature lands with tests: a unit test for the construct and at least one fixture that exercises it end to end.
- Unsupported constructs throw `UnsupportedError` with module, line and construct name; the UI collects them into the "graveyard".
- No network calls from `packages/*`. The app works offline once loaded.
- Commit messages in English, imperative mood.
