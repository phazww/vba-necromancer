# Tasks: scripting-dictionary

Ordered so each task builds on the previous one and leaves `npm test` green. IDs use the `DTASK-` prefix to avoid clashing with `TASK-` in `vba-resurrection-core`. Design references are to `design.md`.

Rules for every task:
- Do not edit `fixtures/expected/*.json` (hand-written oracles, guarded by a hook).
- Run `npm test` and `tsc --noEmit` for `packages/vba` before marking a task done.
- No `any` in `packages/vba`.

---

## DTASK-01: Parse dotted type names and `As New`

**Status:** Done  
**Requires:** DICT-02  
**Design:** section 3.2 (Parser)

### What to do
1. `ast.ts`: add `isNew: boolean` to `DimDeclarator`.
2. `parser.ts`: add a helper that reads `Ident ( . Ident )*` and returns the joined name. Use it in `parseTypeName` and for the class name after `New` in expressions.
3. `parseDimDeclarator`: detect `New` before the type name and set `isNew`.
4. Update existing parser code that builds `DimDeclarator` objects so the field is always set.

### Tests (`packages/vba/tests/parser.test.ts`)
- `Dim d As New Scripting.Dictionary` gives `typeName "Scripting.Dictionary"` and `isNew true`.
- `Dim d As Scripting.Dictionary` gives `isNew false`.
- `Set d = New Scripting.Dictionary` gives a `NewExpr` with `className "Scripting.Dictionary"`.
- `Dim r As Excel.Range`, `Dim x As Long`, `Dim a(1 To 3) As String` parse as before.
- All existing parser, interpreter and fixture tests still pass.

---

## DTASK-02: `DictionaryObject` core (members, keys, errors)

**Status:** Done  
**Requires:** DICT-03, DICT-04, DICT-05, DICT-06, DICT-07, DICT-08  
**Depends on:** none (the class is standalone)  
**Design:** sections 2.1, 2.2

### What to do
1. Create `packages/vba/src/dictionary.ts` with `DictionaryObject`, key normalisation and all members from the table in 2.2.
2. Re-export it from `objects.ts`.
3. Add the optional `defaultMember`, `indexedSetters` and `enumerate` members to `VbObject` in `values.ts` (declaration only).

### Tests (`packages/vba/tests/dictionary-object.test.ts`, direct calls on the class, no interpreter)
- Add, Exists, Item get and set, Count, Remove, RemoveAll.
- Insertion order of `Keys()` and `Items()`; both 0-based; empty Dictionary gives bounds `0 To -1`; returned array is a copy.
- `Add` of an existing key throws `RuntimeError` code 457 with the required description.
- Reading a missing key appends it with Empty and returns Empty; `Exists` does not append.
- `Remove` of a missing key throws 32811.
- Keys: `1` vs `"1"` distinct; `1`, `1&` (IntValue long), `1.0` same; `"a"` vs `"A"` distinct in binary mode, same in text mode; first spelling is kept.
- `CompareMode`: default 0; set 1 on empty works; set on non-empty throws 5; value 7 throws 5; value 2 throws `UnsupportedError`.
- `Key(old) = new`: keeps position and item; missing old gives 32811; existing new gives 457; case-only rename under text mode is allowed.
- Unknown member throws 438; wrong argument counts throw 450.
- Property test (fast-check): random operation sequences match a reference model (array of pairs). Keys come from numbers, mixed-case strings and numeric strings; run in both compare modes.

---

## DTASK-03: `CreateObject` and `New` create a Dictionary

**Status:** Done  
**Requires:** DICT-01, DICT-02, DICT-10  
**Depends on:** DTASK-01, DTASK-02  
**Design:** sections 3.2

### What to do
1. `errors.ts`: add optional `detail` to `UnsupportedError`; when present, the message ends with `<construct> ("<detail>")`, for example `CreateObject ("Scripting.FileSystemObject")`. `construct` is unchanged.
2. `interpreter.ts`: add `createObject`, handle `createobject` in `callByName` before `KNOWN_UNIMPLEMENTED`, evaluate `NewExpr` for Scripting.Dictionary, and carry `detail` through `handleError` when the error is located.
3. `values.ts`: add the `"Dictionary"` type (`SUPPORTED_TYPES`, `isObjectType`, `coerceToType` check). `newSlot`: create the instance for `isNew` declarators; keep other `New` classes unsupported.

### Tests (`packages/vba/tests/dictionary.test.ts`)
- `Set d = CreateObject("Scripting.Dictionary")`, also `"scripting.DICTIONARY"`: run is "fully resurrected" and `TypeName(d)` is `"Dictionary"`.
- `Dim d As New Scripting.Dictionary` (local and module level) and `Set d = New Scripting.Dictionary` give a usable object.
- `Dim d As Scripting.Dictionary` then `Set d = CreateObject(...)` works. `Set d = Range("A1")` for that variable raises 13.
- Two `CreateObject` calls give independent Dictionaries.
- `CreateObject("Scripting.FileSystemObject")` stops the run: status "partly resurrected", `stoppedAt.construct` is `CreateObject`, the error message contains `Scripting.FileSystemObject`. Same with `On Error Resume Next`: one `unsupported` trace event with that construct.
- `Set c = New Foo` and `Dim c As New Foo` are still unsupported with construct naming `New Foo`.
- `fixtures/expected/graveyard.json` still passes (e2e).

---

## DTASK-04: Default member `d(key)` and `d(key) = v`

**Status:** Done  
**Requires:** DICT-03, DICT-05  
**Depends on:** DTASK-03  
**Design:** section 3.1, 3.3

### What to do
1. `callByName`: object slot with `defaultMember` returns `get(defaultMember, args)`.
2. `assignTarget`: object slot with `defaultMember` calls `set(defaultMember, args, value)`; callee `MemberExpr`/`WithMemberExpr` whose object has the member in `indexedSetters` calls `set(member, args, value)`.
3. When assigning an object to an item, use the default value as `assignSlot` does for a Variant.

### Tests (`packages/vba/tests/dictionary.test.ts`)
- `d("a") = 1`, `x = d("a")`, `d("a") = d("a") + 1`.
- `d.Item("a") = 2`, `d.Item("a")`, and `With d` / `.Item("a") = 3`.
- `d.Key("a") = "b"` as a statement.
- `d(k) = Range("A1")` stores the cell value, not the Range.
- `ws.Cells(1, 1) = 5` and `Cells(1, 1) = 5` still write to the cell (regression for the `indexedSetters` check).
- `v = d("missing")` returns Empty, `d.Exists("missing")` is then True, `d.Count` grew by 1, `Err.Number` is 0, and the run's trace has no `unsupported` event and no event for it.
- Calling `d("a")` on a variable that is `Nothing` raises 91.

---

## DTASK-05: `For Each` over a Dictionary and over `Keys`/`Items`

**Status:** Done  
**Requires:** DICT-09  
**Depends on:** DTASK-04  
**Design:** section 3.4

### What to do
1. `execForEach`: use `enumerate()` when the collection is an object that provides it; keep the existing error for everything else.

### Tests (`packages/vba/tests/dictionary.test.ts`)
- `For Each k In d` visits keys in insertion order (strings and numbers, original types preserved).
- `For Each k In d.Keys` and `For Each v In d.Items` likewise.
- Empty Dictionary: zero iterations.
- Adding a key inside the loop does not extend the iteration (snapshot). `// unverified against Excel`.
- `Exit For` inside the loop works.
- `For Each x In Range("A1")` still reports `For Each over a non-array`.

---

## DTASK-06: Static scan stops flagging Scripting.Dictionary

**Status:** Done  
**Requires:** DICT-01, DICT-02, DICT-10  
**Depends on:** DTASK-03  
**Design:** section 4

### What to do
1. `constructs.ts`: implement the `CallExpr` exemption, the `NewExpr` exemption and the `DimStatement` case from section 4.
2. `unsupported.test.ts` line 44: change the dead-line `CreateObject("Scripting.Dictionary")` test to `Scripting.FileSystemObject` (same expectation, still a hit on line 4).

### Tests (`packages/vba/tests/unsupported.test.ts`)
- `CreateObject("Scripting.Dictionary")` and `CreateObject("scripting.dictionary")` give no hit.
- `New Scripting.Dictionary` in `Set` and in `Dim ... As New` gives no hit.
- `CreateObject("Scripting.FileSystemObject")`, `CreateObject("ADODB.Connection")`, `CreateObject(progId)` (variable) each give one `CreateObject` hit with the right line.
- `Dim c As New Foo` gives `New Foo` at the Dim's line; `Set c = New Foo` unchanged.
- A module that declares its own `Function CreateObject` is not flagged (existing shadowing rule).
- A Dictionary line that never runs (inside `If False Then`) gives no hit.
- The existing "names constructs the way REQ-12.2 does" test still passes unchanged.

---

## DTASK-07: Enable the `dictionary_grouping` fixture

**Status:** Done  
**Requires:** Acceptance (fixture), DICT-01, DICT-03, DICT-05, DICT-09  
**Depends on:** DTASK-01..DTASK-06

### What to do
1. `e2e.test.ts`: delete the `dictionary_grouping` entry from `TODO`.
2. `fixtures.test.ts`: add `dictionary_grouping` to the `describe.each` list.
3. If `fixtures/build/dictionary_grouping.xlsm` is out of date, rebuild it with the fixture build script. Do not edit `fixtures/expected/dictionary_grouping.json`.

### Tests
- `BuildActsDict` returns "fully resurrected", `result.error` and `stoppedAt` undefined, `staticUnsupported` equal to `[]`.
- Every expected cell of the `Акты` sheet matches `fixtures/expected/dictionary_grouping.json`.
- The `Акты` sheet equals the one produced by `acts_by_category` for the same input (compare the two result sheets cell by cell).
- The trace for the run lists reads of `Журнал` and writes to `Акты` only.
- Whole suite, including `graveyard`, passes.

---

## DTASK-08: Error-path tests through the interpreter

**Status:** Done  
**Requires:** DICT-04, DICT-06, DICT-08  
**Depends on:** DTASK-04

### Tests (`packages/vba/tests/dictionary.test.ts`)
- Duplicate `Add` without `On Error`: `result.status` is "failed", `result.error` is a `RuntimeError` with code 457.
- With `On Error Resume Next`, a duplicate `Add` leaves `Err.Number = 457` and the description from the requirements, and the run continues.
- `Remove` of a missing key gives `Err.Number = 32811`.
- `CompareMode = vbTextCompare` on a non-empty Dictionary gives `Err.Number = 5`. On an empty one, `d.Exists("A")` after `Add "a"` is True.
- `On Error GoTo handler` reaches the handler for each of the three errors.
- Module with `Option Compare Text` does not change Dictionary key matching.
- Pinned unverified choices, each with `// unverified against Excel`: Boolean key distinct from number; Empty key accepted; array as key raises 5.

---

## DTASK-09: Known deviations and documentation

**Status:** Done  
**Requires:** Principles ("Be honest")  
**Depends on:** DTASK-07, DTASK-08

### What to do
1. Add a test that documents the `As New` deviation: after `Set d = Nothing`, using `d` raises 91 (VBA would re-create it). Comment it as a known deviation.
2. Add a short "Scripting.Dictionary" section to `docs/` (or to the existing write-up file if there is one): what is supported, what is reported unsupported, the unverified choices, the known deviations (snapshot `For Each`, `As New` timing, `vbDatabaseCompare`).
3. Update the README status line that says the Dictionary fixture is pending.

### Tests
- `npm test`, `npm run lint` and `tsc --noEmit` pass for all packages.
- A search for "pending" or "needs Scripting.Dictionary" in `README.md` and `packages/vba/tests` finds nothing stale.

---

## Check on real Excel (manual, needs a Windows or Mac Excel, not part of the automated run)

Compare against the tests marked `unverified against Excel`: error descriptions for 32811 and 5; Boolean, Empty and Array keys; `For Each` with modification inside the loop; case-only `Key` rename; `Keys()` on an empty Dictionary. Any difference changes the code and the test, with the Excel result as the source.
