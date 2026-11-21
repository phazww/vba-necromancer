# Tasks: vbscript-readiness

Ordered so each task builds on the previous one. After every task `npm test`, `npm run lint`, `npm run typecheck` and `npm run build -w app` are green; a task is marked Done only then. IDs use the `VTASK-` prefix to avoid clashing with `TASK-`, `DTASK-`, `UTASK-` and `STASK-`. Design references are to `design.md`.

Rules for every task:
- Do not edit existing `fixtures/expected/*.json` or `.gitignore`. `fixtures/expected/vbscript_deps.json` is written in VTASK-02 from the table in VBS-03, before the scanner exists, and is never changed to make a test pass. If a row looks wrong, stop and write why under "Blocked" at the end of this file.
- MS-OVBA record layouts follow the specification; doubts are written in `design.md` section 2.3.
- No `any` in `packages/*` or `app/src`. No `dangerouslySetInnerHTML`. No network calls from `packages/*`.
- Each task adds its own tests in the same change. All user-visible strings are in English.
- Do not commit. Do not touch git config. Commit messages (when the developer commits) are English, imperative.

---

## VTASK-01: Read PROJECTREFERENCES from the dir stream

**Status:** Done  
**Requires:** REF-01  
**Design:** sections 2.1 to 2.4

### What to do
1. `packages/ovba/src/dir.ts`: add `DirReference`, `references` and `referenceProblems` to `DirStream`; add the state machine of 2.2 to the record loop. Module code is not changed.
2. `packages/ovba/src/extract.ts`: split out `readDir`; add `extractProject`; keep `extractModules`.
3. `packages/ovba/src/index.ts`: export `extractProject`, `DirReference`, `ProjectInfo`.

### Tests (`packages/ovba/tests/references.test.ts`)
- Hand-built dir bytes (a small local builder in the test, independent of `dirWriter`), one case each: REFERENCENAME + REGISTERED; REFERENCEPROJECT; REFERENCECONTROL without and with `NameRecordExtended`; REFERENCEORIGINAL followed by CONTROL; several references in file order.
- Name: MBCS only, and with the Unicode part (Cyrillic name in code page 1251 and its UTF-16 form).
- A reference without a name record gets `name: ""`.
- Damaged reference (inner size runs past the record): left out, one line in `referenceProblems`, modules still returned.
- The existing eight fixtures and `number_formats`: the module list from `extractModules` is the list of `*.bas` names in `fixtures/src/<name>/` and `references` is `[]`.
- Property (fast-check): well-framed reference records with random contents followed by a valid module section never throw and give the same modules.
- All existing ovba tests still pass.

---

## VTASK-02: Write references in fixtures; the `vbscript_deps` fixture and its oracle

**Status:** Done  
**Requires:** REF-02, VBS-03 (fixture and oracle)  
**Depends on:** VTASK-01  
**Design:** sections 4 and 5

### What to do
1. `packages/ovba/src/dirWriter.ts`: optional `references`.
2. `fixtures/build/build.ts`: embed every `.bas` (design 4), read `references`, one `Module=` line per module. Update the header comment.
3. `fixtures/src/vbscript_deps/`: `EarlyBound.bas`, `LateBound.bas`, `Nightly.bas`, `cells.json` with the `references` entry from the table in VBS-03. Sources are plain VBA that parses.
4. **Write `fixtures/expected/vbscript_deps.json` now**, from the VBS-03 table and the line numbers of the three `.bas` files, before any scanner code exists. Explain in `"notes"` where each line number comes from.
5. Run `npm run fixtures:build`. `git status` must show only `fixtures/build/vbscript_deps.xlsm` as new; every existing `.xlsm` is byte-identical.
6. Tests that enumerate `fixtures/expected` or `fixtures/build` and read `runs` (`packages/vba/tests/e2e.test.ts`, `app/tests/helpers.ts` and what depends on it) skip a fixture without `runs`. Test code only.
7. `tools/crosscheck_olevba.py`: compare every `.bas` of a fixture with the module of the same name, not only `Module1`.

### Tests
- `packages/ovba/tests/references.test.ts`: `writeDirStream` with references, read back with `parseDirStream`: same name and libid; without references the bytes equal the output of the old writer for the same options (golden bytes captured from the current writer for one case).
- Build every fixture into a temporary directory with `FIXTURES_OUT_DIR` and compare the bytes of the existing nine with `fixtures/build`.
- `extractProject(vbscript_deps.xlsm)`: three modules `EarlyBound`, `LateBound`, `Nightly` with sources equal to the `.bas` files (line endings normalised), one reference with the libid of the table.
- olevba (`tools/crosscheck_olevba.py`) reads all fixtures, if oletools can be installed offline here; otherwise recorded under "Deferred".

---

## VTASK-03: The static scan

**Status:** Done  
**Requires:** VBS-01, VBS-03 (findings)  
**Depends on:** VTASK-02  
**Design:** section 3

### What to do
1. `packages/vba/src/vbscript.ts`: `scanVbscript` and the three finding texts exactly as written in VBS-01. Export from `index.ts`.

### Tests
- `packages/vba/tests/vbscript.test.ts`:
  - reference: libid with `vbscript.dll` in any case; libid with the GUID only; a `project` or `control` reference with the same libid is not reported; an unrelated registered reference (stdole) is not reported.
  - CreateObject: `CreateObject("VBScript.RegExp")`, lower case, extra blanks, `VBA.CreateObject`, with a second argument; line number on a multi-line module.
  - external-vbs: `Shell "x.vbs"`, `Shell "X.VBS"`, the fixture line `Shell "wscript.exe ""C:\scripts\nightly.vbs"""`, `cscript` as a word, a `.vbs` literal in a procedure that calls `Shell`, the same procedure using `CreateObject("WScript.Shell")`, a literal in a different procedure without `Shell` (not reported), a module-level `Const` (not reported).
  - Negatives: `Scripting.FileSystemObject`, `Scripting.Dictionary`, `WScript.Shell` without a `.vbs`, `"report.vbsx"`, a comment (`'` and `Rem`) that mentions `VBScript.RegExp` and `x.vbs`, the identifier `mycscriptPath` and the literal `"mycscript"`, `obj.CreateObject("VBScript.RegExp")` and `obj.Shell "a.vbs"`.
  - `Option Compare` and line continuations do not change the line numbers; a module that does not parse is still scanned.
  - Property (fast-check): `scanVbscript` never throws on arbitrary source text.
- `packages/vba/tests/vbscript-fixture.test.ts` (VBS-03): extract `vbscript_deps.xlsm` with `extractProject`, scan, and compare kind, module, line, reference name and libid with `fixtures/expected/vbscript_deps.json` exactly, in order, "and no other finding". Every other `fixtures/build/*.xlsm` gives `[]`.

---

## VTASK-04: App model

**Status:** Done  
**Requires:** VBS-02 (data part)  
**Depends on:** VTASK-03  
**Design:** section 6, first two bullets

### What to do
1. `app/src/model/types.ts`: `Exhumed.references`, `referenceProblems`, `vbscript`.
2. `app/src/model/exhume.ts`: `extractSources` uses `extractProject`; `exhumeParts` calls `scanVbscript`. `PartsOptions` gets `references` and `referenceProblems`.

### Tests (`app/tests/model/vbscript.test.ts`)
- `exhume("vbscript_deps.xlsm", bytes)` has three findings in the oracle order and one reference.
- The nine other fixtures: `vbscript` is `[]`.
- `exhumeParts` without references (as the existing tests call it) gives `[]` and nothing else changes; existing model tests pass unchanged.

---

## VTASK-05: The "VBScript readiness" section

**Status:** Done  
**Requires:** VBS-02  
**Depends on:** VTASK-04  
**Design:** section 6, the `VbscriptSection` bullet

### What to do
1. `app/src/ui/ExhumePanel.tsx`: `VbscriptSection`, rendered after `ModuleList` and `NoVbaNotice`.
2. Styles only from existing classes; add a class only if needed, with tokens.

### Tests (`app/tests/ui/vbscript.test.tsx`)
- A workbook without findings shows "No VBScript dependencies found" and the one-line note about the 9 Sep 2025 guidance and the static scan.
- `vbscript_deps`: the three findings with their VBS-01 text and location (`LateBound:5`, `Nightly:4`, the reference name and libid).
- Clicking a code finding sets the selection and the source view shows that line selected, as for a graveyard entry; the reference finding has no button.
- A workbook with no readable VBA shows the "could not be checked" line, not the all-clear.
- `referenceProblems` are shown.
- axe has no violations; theme lint and token tests pass.

---

## VTASK-06: Docs and README

**Status:** Done  
**Requires:** VBS-01 (sources), acceptance list  
**Depends on:** VTASK-05

### What to do
1. `docs/vbscript-readiness.md`: what is checked, the three finding kinds, what is not checked (variables, `Shell cmd`, quoted script paths, `.xls`), the Office 2508 caveat, and the two sources from the requirements, quoted without stronger claims. Mention that the scan cannot know the Office build of the file's users.
2. `README.md`: update the "What works" table (one row or an addition to the UI row) and the fixtures paragraph (new fixture, nine to ten fixtures).
3. `docs/kiro-usage.md`: one paragraph on how this spec was written (oracle before the scanner, the spec read for the control record).
4. Check that every id REF-01, REF-02, VBS-01..03 appears in at least one test name or describe title (`grep -rn "REF-0\|VBS-0" packages app/tests`).

### Tests
- None new. The four commands, and `tools/crosscheck_olevba.py` when oletools is available.

---

## Blocked
Nothing yet.

## Deferred
- Byte identity of existing `.xlsm` files: the committed `fixtures/build/*.xlsm` of six older fixtures carry ZIP entry dates (2026-11-18) that the current builder does not write (it writes a fixed 2026-01-01), so a fresh build differs from them in those bytes even without this spec's changes (checked by building HEAD's builder). Contents of every ZIP entry are identical. I restored the committed files with `git checkout` instead of committing re-dated copies, and the test compares ZIP entry contents, not raw bytes (the numfmt test did the same before). `vbscript_deps.xlsm` is compared byte for byte only against itself.
