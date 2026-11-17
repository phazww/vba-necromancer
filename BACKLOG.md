# Backlog (next specs for Kiro)

1. **Scripting.Dictionary shim.** Real business macros use `CreateObject("Scripting.Dictionary")` constantly (grouping by category, de-duplication). REQ-12 currently marks all `CreateObject` as unsupported. A built-in, browser-safe Dictionary (Add, Exists, Item, Keys, Items, Count, Remove, CompareMode) would turn many "partly resurrected" macros into "fully resurrected". FileSystemObject, Outlook, ADODB stay unsupported.
2. **Buttons.** Read shapes/form controls bound to macros (`xl/drawings`, `OnAction`) so the UI shows the same buttons the user clicked in Excel.
3. **Demo workbook** for the video: an acts workbook with a «Сформировать акты» button, ~40 journal rows, built from fixtures/src like the others.
4. **Export to TypeScript** (stretch): emit an equivalent TS function per macro and prove equality on the fixtures.
5. **Construct names must match REQ-12.2.** The parser reports `Print` for `Print #1, ...`; REQ-12.2 and fixtures/expected/graveyard.json use `Print #`. Align in TASK-12. `CreateObject` is a call expression, so it must be reported by the static scan of call sites (line 11 in graveyard), not by the statement parser.
