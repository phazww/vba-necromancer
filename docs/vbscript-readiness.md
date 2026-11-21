# VBScript readiness

The Exhume panel has a "VBScript readiness" section. It lists the places where a workbook's VBA project depends on VBScript, so you can find them before VBScript is switched off. The file stays in the browser. The check is static: it reads the project, it does not run anything.

## Why

Microsoft's guidance for VBA developers (Microsoft 365 Developer blog, 9 Sep 2025, [How to prepare VBA projects for VBScript deprecation](https://devblogs.microsoft.com/microsoft365dev/how-to-prepare-vba-projects-for-vbscript-deprecation/)) names two ways VBA projects use VBScript:

> Executing external .vbs scripts from VBA.
> Referencing VBScript type libraries, such as VBScript.RegExp for regular expressions.

and gives the consequences:

> Calling .vbs scripts from VBA will no longer be supported
> References to VBScript RegExp library will break unless the Office client is updated to a supported build.

The same post says that from Office version 2508 (build 19127.20154) RegExp classes are included in VBA by default, and recommends testing projects "in environments where VBScript is disabled to identify any hidden dependencies". It gives no tool for that. The timeline (phase 2, VBScript off by default "approximately 2026 or 2027"; phase 3, removal, "TBD") is in the Windows IT Pro post [VBScript deprecation: Timelines and next steps](https://techcommunity.microsoft.com/blog/Windows-ITPro-blog/vbscript-deprecation-timelines-and-next-steps/4148301).

## What is reported

| Finding | Rule | Text shown |
|---|---|---|
| `vbscript-reference` | A registered reference in the `dir` stream whose libid contains `vbscript.dll` (any case) or the GUID `{3F4DACA0-160D-11D2-A8E9-00104B365C9F}` (Microsoft VBScript Regular Expressions 5.5). Reported with the reference name and libid; there is no line. | References the VBScript RegExp library. Breaks when VBScript is disabled, unless Office is version 2508 or later (RegExp is built into VBA from 2508). |
| `vbscript-createobject` | `CreateObject("VBScript.RegExp")`, any case, with a string literal. Module and line of the call. | Late-bound VBScript RegExp. Microsoft's guidance says this runs on Office 2508 and later, and on older builds only while VBScript is enabled. |
| `external-vbs` | In a procedure that calls `Shell` or `CreateObject("WScript.Shell")`: a string literal that ends in `.vbs` (any case) or contains `wscript` or `cscript` as a word. Module and line of the literal. | Runs an external VBScript file. This stops working once VBScript is disabled, on any Office version. |

Nothing else is reported. `Scripting.FileSystemObject`, `Scripting.Dictionary` and `WScript.Shell` without a `.vbs` are not on Microsoft's list. Comments are ignored.

## What it cannot see

- A ProgID or script path held in a variable or built by concatenation (`CreateObject(p)`, `"VBScript." & "RegExp"`), and `Shell cmd` where no string literal in the procedure names the script.
- A quoted script path as the whole literal: `"""C:\a.vbs"""` does not end in `.vbs`. It is found when `wscript` or `cscript` is in the same literal, as in `"wscript.exe ""C:\a.vbs"""`. Ending the literal with a quote is a gap in the rule as written, not a decision about Microsoft's guidance.
- Constants at module level: a `.vbs` literal is reported only inside a procedure that calls `Shell`.
- Legacy `.xls` files: their VBA is not read yet, so the section says so instead of "none found".
- Which Office build the users of the file have. A reference finding is a dependency, not a certain failure: it breaks only on builds before 2508 once VBScript is off.
- Early binding with `Dim re As New RegExp` is not a finding of its own. It shows up through the reference, if the reference is present.

## How the references are read

`packages/ovba` reads the `PROJECTREFERENCES` records of the `dir` stream (MS-OVBA 2.3.4.2.2): REFERENCENAME, REFERENCEREGISTERED, REFERENCEPROJECT, REFERENCECONTROL and REFERENCEORIGINAL. For a control the libid shown is `LibidExtended`. A record that does not fit is left out and listed in the panel. Open questions about the layouts are in `.kiro/specs/vbscript-readiness/design.md`, section 2.3.

## Fixture

`fixtures/src/vbscript_deps` has three modules (`EarlyBound`, `LateBound`, `Nightly`) and the RegExp 5.5 reference. `fixtures/expected/vbscript_deps.json` lists the three expected findings; it was written by hand from the requirements before the scanner existed. The fixture has not been opened in desktop Excel.
