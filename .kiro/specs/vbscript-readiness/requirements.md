# Spec: VBScript readiness check

## Why
Microsoft is turning VBScript off by default in Windows "approximately in 2026 or 2027" (phase 2), and will remove it later (phase 3, no date). Its guidance for VBA (Microsoft 365 Developer blog, 9 Sep 2025, "How to prepare VBA projects for VBScript deprecation") names two patterns that break: calling external `.vbs` scripts from VBA, and referencing the VBScript type library (usually `VBScript.RegExp`). Office version 2508 (build 19127.20154) and later have RegExp built into VBA; on older builds a reference to the VBScript RegExp library breaks once VBScript is disabled. Microsoft asks developers to find these hidden dependencies; it gives no scanner. We already read the VBA project from the file in the browser, so we can list them without the file leaving the machine.

Sources (quote these in docs/vbscript-readiness.md, do not paraphrase them into stronger claims):
- https://devblogs.microsoft.com/microsoft365dev/how-to-prepare-vba-projects-for-vbscript-deprecation/
- https://techcommunity.microsoft.com/blog/Windows-ITPro-blog/vbscript-deprecation-timelines-and-next-steps/4148301

## Requirements (EARS)

**REF-01** The dir stream reader in `packages/ovba` shall read the PROJECTREFERENCES records (MS-OVBA 2.3.4.2.2): REFERENCENAME (Id 0x0016, with its Unicode part after Reserved 0x003E), REFERENCEREGISTERED (Id 0x000D), REFERENCEPROJECT (Id 0x000E), REFERENCECONTROL (Id 0x002F, with its optional name and extended parts) and REFERENCEORIGINAL (Id 0x0033), and return a list of references `{ name, kind: "registered" | "project" | "control", libid }` in file order. Today these records are skipped by size; the module list must stay exactly as today for every existing fixture.

**REF-02** The dir stream writer used by the fixture builder shall be able to write REFERENCENAME + REFERENCEREGISTERED records from an optional `"references"` array in a fixture's `cells.json` (`[{ "name": "...", "libid": "..." }]`). Fixtures without `"references"` keep identical bytes.

**VBS-01** The static scan shall report, per workbook, these findings with module and line (a reference has no line, report the reference name and libid):
1. **vbscript-reference**: a registered reference whose libid contains `vbscript.dll` (case-insensitive) or the GUID `{3F4DACA0-160D-11D2-A8E9-00104B365C9F}` (Microsoft VBScript Regular Expressions 5.5). Text: "References the VBScript RegExp library. Breaks when VBScript is disabled, unless Office is version 2508 or later (RegExp is built into VBA from 2508)."
2. **vbscript-createobject**: `CreateObject("VBScript.RegExp")` (any case, string literal argument). Text: "Late-bound VBScript RegExp. Microsoft's guidance says this runs on Office 2508 and later, and on older builds only while VBScript is enabled."
3. **external-vbs**: a string literal ending in `.vbs` (any case), or containing `wscript` or `cscript` as a word, passed to `Shell`, or used anywhere in a procedure that also calls `Shell` or `CreateObject("WScript.Shell")`. Text: "Runs an external VBScript file. This stops working once VBScript is disabled, on any Office version."
No other object (for example `Scripting.FileSystemObject`, `Scripting.Dictionary`, `WScript.Shell` without a `.vbs`) shall be reported: Microsoft's guidance lists only the two patterns above.

**VBS-02** The Exhume panel shall show a "VBScript readiness" section: "No VBScript dependencies found" when there are none, otherwise each finding with its text and location (clicking a code finding selects the line in the source view, like graveyard entries). The section shall say in one line that the check follows Microsoft's guidance of 9 Sep 2025 and is a static scan.

**VBS-03** Add a fixture `vbscript_deps` with three modules: one that has the RegExp reference and uses early binding (`Dim re As New RegExp` with the reference present), one with `Set re = CreateObject("VBScript.RegExp")`, and one with `Shell "wscript.exe ""C:\scripts\nightly.vbs"""`. Hand-written expected findings in `fixtures/expected/vbscript_deps.json` (written before the scanner exists):

| Finding | Where |
|---|---|
| vbscript-reference | reference `VBScript_RegExp_55`, libid `*\G{3F4DACA0-160D-11D2-A8E9-00104B365C9F}#5.5#0#C:\Windows\System32\vbscript.dll\3#Microsoft VBScript Regular Expressions 5.5` |
| vbscript-createobject | module `LateBound`, the line of the `CreateObject` call |
| external-vbs | module `Nightly`, the line of the `Shell` call |

and no other finding. The existing eight fixtures (and `number_formats`) shall report no VBScript finding. The interpreter's behaviour for these macros is out of scope (they may be partly resurrected).

## Acceptance
- Unit tests for REF-01 on hand-built dir bytes for each reference kind, and on every existing fixture (module list unchanged).
- Unit tests for VBS-01 on small module sources, including negative cases: `Scripting.FileSystemObject`, `"report.vbsx"`, a comment that mentions `VBScript.RegExp`, and the word `cscript` inside a longer identifier.
- olevba still reads all fixtures including `vbscript_deps`; existing built fixtures byte-identical; `fixtures/expected` of existing fixtures untouched.
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run build -w app` green after every task.
- `docs/vbscript-readiness.md` with the sources above; README "What works" line updated.
