# Scripting.Dictionary

Spec: `.kiro/specs/scripting-dictionary/`. Code: `packages/vba/src/dictionary.ts`.

## Supported

- Creation: `CreateObject("Scripting.Dictionary")` (any case), `Set d = New Scripting.Dictionary`, `Dim d As New Scripting.Dictionary`, `Dim d As Scripting.Dictionary` followed by `Set`.
- Members: `Add`, `Exists`, `Item` (get and set, also `d(key)` and `d(key) = v`), `Keys()`, `Items()`, `Count`, `Remove`, `RemoveAll`, `Key(old) = new`, `CompareMode` (0 and 1).
- `For Each k In d`, `For Each k In d.Keys`, `For Each v In d.Items`.
- Errors: 457 duplicate key, 32811 missing key on `Remove` and `Key`, 5 for `CompareMode` on a non-empty Dictionary or an invalid value, 438 unknown member, 450 wrong argument count, 91 when the variable is Nothing.
- Reading a missing key adds it with Empty, as VBA does. It records no trace event.

## Reported as unsupported

- `CreateObject` with any other ProgID. The construct is `CreateObject`, the message carries the ProgID.
- `Dim x As New Foo` and `Set x = New Foo` for any class other than `Scripting.Dictionary` (construct `New Foo`).
- `CompareMode = vbDatabaseCompare`.
- `Set d(key) = obj`, `Dim d As Dictionary` without the `Scripting.` prefix, `HashVal`, `GetObject`.

The static scan does not list a `CreateObject` call whose only argument is the literal `"Scripting.Dictionary"`. A ProgID held in a variable is still listed, even if it turns out to be the Dictionary at run time.

## Unverified choices

Pinned by tests marked `unverified against Excel`. Check on real Excel before treating them as truth:

- Descriptions of errors 32811 and 5.
- Boolean keys are distinct from numeric keys, Empty is a valid key, an Array or object as key raises 5.
- `For Each` with a modification of the Dictionary inside the loop.
- Case-only `Key` rename under text compare.
- `Keys()` on an empty Dictionary has bounds `0 To -1`.
- `Add` stores an object item (for example a Range) as its default value, like `Item(k) = v`. VBA would store the object.

## Known deviations

- `For Each` iterates over a snapshot of the keys taken at loop start.
- `As New` creates the Dictionary when the variable is declared. VBA creates it on first use, so after `Set d = Nothing` VBA re-creates it and this interpreter raises 91.
- `vbDatabaseCompare` is not accepted.
