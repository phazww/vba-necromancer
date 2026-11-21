# Design: VBScript readiness check

Implements REF-01, REF-02, VBS-01, VBS-02, VBS-03 (see `requirements.md`). Changes are in `packages/ovba` (reference records), `packages/vba` (the scanner), `fixtures/build` and `fixtures/src`, and `app` (model plumbing and one panel section). No network access anywhere. Existing `fixtures/expected/*.json` and `.gitignore` are not edited. This spec does touch `packages/ovba`; earlier specs said not to, this one needs it.

## 1. Where it plugs in

| Concern | Today | Change |
|---|---|---|
| `dir` stream | `parseDirStream` returns `{ codePage, projectName, modules }`; reference records fall into the `default:` branch and are skipped by size | also returns `references` and `referenceProblems` (REF-01) |
| Reading a file | `extractModules(bytes)` returns modules only | new `extractProject(bytes)` returns `{ modules, references, referenceProblems }`; `extractModules` calls it and returns `.modules`, so existing callers do not change |
| Fixture writer | `writeDirStream` writes no references | optional `references` (REF-02) |
| Fixture builder | embeds `Module1.bas` only (or the first `.bas`) | embeds every `.bas` of a fixture, in file-name order; reads `references` from `cells.json` |
| Static scan | `scanUnsupported(asts)` in `packages/vba` works on ASTs | new `scanVbscript(modules, references)` in `packages/vba`, works on tokens (section 3) |
| Exhume model | `exhumeParts(name, bytes, sources, options)` | `options.references`, result gets `references` and `vbscript` |
| UI | `ExhumePanel` | one more section, `VbscriptSection` (VBS-02) |

## 2. Reading references (`packages/ovba/src/dir.ts`)

### 2.1 Layouts used

From MS-OVBA 2.3.4.2.2 (read on learn.microsoft.com while writing this design: REFERENCE, REFERENCENAME, REFERENCECONTROL, REFERENCEORIGINAL, REFERENCEREGISTERED, REFERENCEPROJECT). All integers little-endian. Strings are MBCS in the project code page unless noted.

| Record | Id | Fields after `Id` |
|---|---|---|
| REFERENCENAME | 0x0016 | `SizeOfName` (4), `Name`; then `Reserved` (2) = 0x003E, `SizeOfNameUnicode` (4), `NameUnicode` (UTF-16LE) |
| REFERENCEREGISTERED | 0x000D | `Size` (4, covers the rest), `SizeOfLibid` (4), `Libid`, `Reserved1` (4), `Reserved2` (2) |
| REFERENCEPROJECT | 0x000E | `Size` (4), `SizeOfLibidAbsolute` (4), `LibidAbsolute`, `SizeOfLibidRelative` (4), `LibidRelative`, `MajorVersion` (4), `MinorVersion` (2) |
| REFERENCEORIGINAL | 0x0033 | `SizeOfLibidOriginal` (4), `LibidOriginal`; a REFERENCECONTROL follows it |
| REFERENCECONTROL | 0x002F | `SizeTwiddled` (4, covers up to `Reserved2`), `SizeOfLibidTwiddled` (4), `LibidTwiddled`, `Reserved1` (4), `Reserved2` (2); optional `NameRecordExtended` (a REFERENCENAME); `Reserved3` (2) = 0x0030, `SizeExtended` (4), `SizeOfLibidExtended` (4), `LibidExtended`, `Reserved4` (4), `Reserved5` (2), `OriginalTypeLib` (16), `Cookie` (4) |

A REFERENCE is an optional REFERENCENAME followed by one of CONTROL, ORIGINAL (then CONTROL), REGISTERED, PROJECT. So the name that precedes a record belongs to the reference.

The `Reserved` fields that start with a 2-byte id (0x003E, 0x0030) are followed by a 4-byte size that covers the rest of that part. This is why the existing walk `Id (2) | Size (4) | Data (Size)` also works for references: it sees 0x0016, 0x003E, 0x000D and so on as separate records. REFERENCECONTROL is the only one whose parts are split across several records of this walk: `0x002F`, an optional `0x0016`+`0x003E`, then `0x0030`.

### 2.2 Algorithm

Inside the existing record loop, before `PROJECTMODULES` (0x000F) has been seen, a small state machine:

- `0x0016`: decode `Name` into `pendingName`. If a control is open (see below), it goes to `control.extendedName` instead.
- `0x003E`: replace the name just read by `NameUnicode` (UTF-16LE).
- `0x000D`: emit `{ name: pendingName, kind: "registered", libid }`; clear `pendingName`.
- `0x000E`: emit `{ kind: "project", libid: LibidAbsolute }`.
- `0x0033`: skip (it is only a prefix of the next control); keep `pendingName`.
- `0x002F`: open a control, remember `LibidTwiddled`.
- `0x0030`: close the control and emit `{ kind: "control", libid: LibidExtended }`.

Module parsing is not touched. The result type is:

```ts
export interface DirReference { name: string; kind: "registered" | "project" | "control"; libid: string }
// DirStream gains:
references: DirReference[];      // file order
referenceProblems: string[];     // one line per reference record that could not be read
```

A reference record whose inner sizes run past its own record is not fatal: it is left out and gets a line in `referenceProblems` with its dir-stream offset. The module list must not depend on reference parsing, so a damaged reference never raises `DirStreamError` (the record-level checks of the existing loop stay as they are).

### 2.3 Decisions and doubts (stated, not guessed)

1. **Control libid.** For a REFERENCECONTROL I report `LibidExtended`. The spec says `LibidTwiddled` should normally be the all-zero placeholder `*\G{00000000-0000-0000-0000-000000000000}#0.0#0##`, so it carries no information. Doubt: I did not check what Excel writes in `LibidExtended` on a real file; the choice only affects display, because VBS-01 looks at registered references only.
2. **Control name.** I use the name record that precedes the whole reference. `NameRecordExtended` is, by the spec, the name of the extended type library; it is used only when no leading name exists. Doubt: whether Excel ever writes both with different text.
3. **REFERENCEORIGINAL** is not reported on its own; its `LibidOriginal` is dropped. Only the control that follows it is listed.
4. **`Size` fields** of REGISTERED, PROJECT, CONTROL (`SizeTwiddled`, `SizeExtended`) are "MUST be ignored on read" in the spec for some of them. The walk trusts the outer record size (as today) and reads the inner sizes only to cut out the libid; it does not require `Size` to equal the sum of its parts.
5. **Name encoding.** If `NameUnicode` is absent (a file that stops after `Name`) the MBCS name stands. The spec requires `Reserved` = 0x003E but marks it "MUST be ignored", so the reader keys on the `0x003E` id only to attach the Unicode part and does not validate more.
6. **Not read:** `LibidRelative`, versions, `OriginalTypeLib`, `Cookie`.
7. **Id collisions.** I found no module-level record that uses 0x0016, 0x000D, 0x000E, 0x002F, 0x0030, 0x0033 or 0x003E. References are read only before `PROJECTMODULES` as a precaution.

### 2.4 Reading from a file

`extract.ts` is split: `readDir(bytes)` finds and decompresses `VBA/dir` and returns the `DirStream` plus the CFB stream map; `extractProject` builds modules from it. `extractModules` keeps its signature and behaviour. `index.ts` exports `extractProject`, `DirReference` and the `ProjectInfo` type.

## 3. The scanner (`packages/vba/src/vbscript.ts`)

```ts
export type VbscriptKind = "vbscript-reference" | "vbscript-createobject" | "external-vbs";
export interface VbscriptFinding {
  kind: VbscriptKind;
  /** The text from VBS-01 for this kind. */
  text: string;
  /** Code findings: module and 1-based line. Reference findings: null. */
  module: string | null;
  line: number | null;
  /** Reference findings: name and libid. Code findings: null. */
  reference: { name: string; libid: string } | null;
}
export function scanVbscript(
  modules: ReadonlyArray<{ name: string; source: string }>,
  references: ReadonlyArray<{ name: string; kind: string; libid: string }>,
): VbscriptFinding[];
```

The input types are structural, so `packages/vba` does not import `packages/ovba`. Order of the result: reference findings in file order, then code findings by module order and line.

The scan works on `tokenize(source)`, not on the AST: a module that does not parse still gets scanned, comments are `Comment` tokens that the scan ignores, and string literals come with their line. `tokenize` already decodes `""` inside a literal (the scan relies on the token value being the decoded text; the first test checks it).

Rules, in terms of tokens:

1. **vbscript-reference**: a reference with `kind === "registered"` whose libid, lower-cased, contains `vbscript.dll` or `{3f4daca0-160d-11d2-a8e9-00104b365c9f}`. One finding per reference.
2. **vbscript-createobject**: an `Identifier` token `CreateObject` (case-insensitive; not preceded by `.`, except `VBA.CreateObject`), then `(`, then a string literal whose value equals `VBScript.RegExp` case-insensitively. Line of the `CreateObject` token. A literal built by concatenation or held in a variable is not seen (static scan; stated in the docs).
3. **external-vbs**: procedures are delimited by `Sub`/`Function` to `End Sub`/`End Function` (also `Property`). A procedure is a *shell procedure* if it has `Shell` as an identifier (same dot rule as above) or `CreateObject("WScript.Shell")` (case-insensitive). In a shell procedure every string literal that ends in `.vbs` (case-insensitive) or contains `wscript` or `cscript` as a word (`\b(?:wscript|cscript)\b`, case-insensitive; `_` and digits are word characters, so `mycscript` and `cscript2` do not match) is a finding at the literal's line. One finding per literal. Literals outside any procedure (module-level `Const`) are not reported. "Ends in `.vbs`" is exact: `"report.vbsx"` does not match, and a literal that ends in `.vbs"` with a closing quote inside the value (`"cmd /c ""a.vbs"""`) does not match this clause (it can still match the `wscript`/`cscript` clause). This follows the wording of VBS-01 literally; see "Open points".

Because "passed to `Shell`" always happens inside a procedure that calls `Shell`, the second clause of rule 3 covers the first; the scan does not need to parse arguments.

No other object is reported. `Scripting.FileSystemObject`, `Scripting.Dictionary` and a bare `WScript.Shell` produce nothing.

### Open points
- A quoted script path such as `"""C:\a.vbs"""` is not found by the `.vbs` clause. The oracle row for `Nightly` is found through the `wscript` clause. Widening the clause to ignore trailing quotes and blanks is a one-line change; I left it out because VBS-01 says "ending in `.vbs`". To decide with the requirement author.
- `Shell` called through a variable (`Shell cmd`) with no literal in the procedure is not found.

## 4. Fixture writer and builder (REF-02)

`DirWriterOptions` gains `references?: DirWriterReference[]` with `{ name, nameMbcs, libidMbcs }` (bytes already encoded in the code page, like modules). Per reference, in `PROJECTREFERENCES` position (after `ConstantsUnicode`, before `PROJECTMODULES`):

```
0x0016 name (MBCS)  | 0x003E name (UTF-16LE)
0x000D  u32 len(libid) | libid | u32 0 | u16 0
```

Without `references` nothing is written, so the bytes of existing fixtures do not change (checked by rebuilding and by `git status`).

The builder reads `"references": [{ "name": "...", "libid": "..." }]` from `cells.json`, encodes with the project code page, and now embeds every `.bas` in `fixtures/src/<name>/` sorted by file name: one `VBA/<name>` stream per module, one module record per module, one `Module=` line per module in the `PROJECT` stream. For a fixture with only `Module1.bas` the output is identical to today. Button macros without a module prefix still use `Module1`, or the first module when there is none. The `PROJECT` stream gets no `Reference=` lines; the `dir` stream is what readers use, and I have not checked what Excel writes there.

`vbscript_deps` has `EarlyBound.bas`, `LateBound.bas`, `Nightly.bas` and the reference from the table in VBS-03.

Generic tests that list `fixtures/expected/*.json` or `fixtures/build/*.xlsm` and read `runs` (`packages/vba/tests/e2e.test.ts`, `app/tests/helpers.ts`) must skip a fixture whose expected file has no `runs`. This changes test code only, never an oracle.

## 5. Oracle format (`fixtures/expected/vbscript_deps.json`)

```json
{
  "findings": [
    { "kind": "vbscript-reference", "reference": { "name": "...", "libid": "..." } },
    { "kind": "vbscript-createobject", "module": "LateBound", "line": 5 },
    { "kind": "external-vbs", "module": "Nightly", "line": 4 }
  ],
  "notes": "..."
}
```

Written by hand, from the table in VBS-03 and the line numbers of the fixture sources, in VTASK-02, before `scanVbscript` exists. The `text` of a finding is compared against the VBS-01 strings in unit tests, not in the oracle. This file is never changed to make a test pass.

## 6. App model and UI (VBS-02)

- `extractSources` returns `options.references` and `options.referenceProblems` next to the sources. `PartsOptions` gets both. `exhumeParts` calls `scanVbscript(modules, references)` once and stores `Exhumed.references`, `Exhumed.referenceProblems` and `Exhumed.vbscript`.
- `.xls` files: VBA is not read, so references are empty and the section says nothing about VBScript is known (see below).
- `VbscriptSection` in `ExhumePanel.tsx`, after the module list:
  - heading "VBScript readiness";
  - a muted line: "Static scan, following Microsoft's guidance of 9 Sep 2025.";
  - no findings and VBA read: "No VBScript dependencies found";
  - no VBA read (`vba !== "present"`): "No VBA project was read, so VBScript dependencies could not be checked." (not "none found", to avoid a false all-clear);
  - findings: a list; each shows the text and the location. A code finding is a button that dispatches `select-graveyard` with module and line (the existing action selects the line in the source view). A reference finding is plain text with name and libid (no line to select).
  - `referenceProblems` lines are shown as muted text.
- No new dependency, no network call. Classes reuse the existing `fold`, `plain-list`, `entry` and `muted` styles; no raw colours (theme lint stays green).

## 7. Tests

| What | Where |
|---|---|
| REF-01 on hand-built dir bytes, one case per kind, name with Unicode part, control with and without extended name, original + control, damaged reference, modules unchanged | `packages/ovba/tests/references.test.ts` |
| REF-01 on all fixtures: module list identical to `Module*.bas` file list | same file |
| REF-02 writer round trip and byte identity of existing fixtures (rebuild into a temp dir with `FIXTURES_OUT_DIR`, compare to `fixtures/build`) | `packages/ovba/tests/references.test.ts` |
| VBS-01 unit cases and negatives | `packages/vba/tests/vbscript.test.ts` |
| VBS-03 oracle comparison, nine other fixtures have no finding | `packages/vba/tests/vbscript-fixture.test.ts` |
| VBS-02 model and component | `app/tests/model/vbscript.test.ts`, `app/tests/ui/vbscript.test.tsx` |

Property test (fast-check) for `parseDirStream`: well-framed reference records with random contents (random inner sizes and bytes) followed by a valid module section never throw and always yield the same modules.
