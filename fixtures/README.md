# Fixtures

Every fixture is plain text, so it can be reviewed in a diff and rebuilt at any time. No client data: all names, numbers and companies are made up.

```
fixtures/
  src/<name>/
    Module1.bas      VBA source of the module (more modules: Module2.bas, ...)
    cells.json       initial workbook state
  expected/<name>.json   expected state after each macro run, written by hand BEFORE the interpreter could run it
  build/             builder script and generated .xlsm files
```

## Encoding
`.bas` files are stored in UTF-8 in the repo. Fixtures with Cyrillic text declare `"codePage": 1251` in `cells.json`; the builder must encode module text in that code page and write it to the PROJECTCODEPAGE record of the `dir` stream, the way Russian Excel does. The extractor must decode with the project code page.

## cells.json
```json
{
  "codePage": 1251,
  "sheets": [
    { "name": "Журнал", "cells": [ { "row": 1, "col": 1, "value": "Дата" } ] }
  ]
}
```
`value` is a JSON number, string or boolean. Empty cells are simply absent.

## expected/<name>.json
```json
{
  "runs": [
    {
      "macro": "BuildActs",
      "status": "fully resurrected",
      "cells": [ { "sheet": "Акты", "row": 1, "col": 1, "value": "Категория" } ],
      "empty": [ { "sheet": "Отчёт", "row": 2, "col": 2 } ],
      "unsupported": [ { "module": "Module1", "line": 3, "construct": "Declare" } ],
      "stoppedAt": { "module": "Module1", "line": 22, "construct": "Open" }
    }
  ],
  "numericTolerance": 1e-9
}
```
- Runs are executed in order on the same workbook, each on the state left by the previous run.
- `cells` lists every cell the macro must leave with that value. Numbers compare with `numericTolerance`; strings and booleans compare exactly.
- `empty` lists cells that must stay empty (for example, after a macro stopped).
- `unsupported` lists every unsupported construct in the module, found statically, with 1-based line numbers of the `.bas` file.
- `stoppedAt` is present only when the run stopped on an unsupported construct outside `On Error Resume Next`.

## How expected values were obtained
By hand, from VBA semantics as documented by Microsoft (banker's rounding in `CInt`/`CLng`/`Round`, operand rounding in `\` and `Mod`, Integer overflow = error 6). Each file explains the less obvious numbers in `"notes"`.
