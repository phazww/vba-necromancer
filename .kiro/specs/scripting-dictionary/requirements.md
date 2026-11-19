# Spec: Scripting.Dictionary shim

## Why
Business macros group and de-duplicate with `CreateObject("Scripting.Dictionary")` far more than with arrays. REQ-12 of `vba-resurrection-core` marks every `CreateObject` as unsupported, so most real-world grouping macros would end up "partly resurrected". A built-in, browser-safe Dictionary is the single feature that moves the most macros to "fully resurrected". Other COM objects (FileSystemObject, Outlook, ADODB, WScript.Shell) stay unsupported.

## Requirements (EARS)

**DICT-01** When a macro evaluates `CreateObject("Scripting.Dictionary")` (case-insensitive ProgID), the interpreter shall return a new Dictionary object instead of raising `UnsupportedError`.

**DICT-02** When a macro declares `Dim d As New Scripting.Dictionary` or `Set d = New Scripting.Dictionary`, the interpreter shall create a Dictionary the same way (early binding, as when the "Microsoft Scripting Runtime" reference is set).

**DICT-03** The Dictionary shall support `Add key, item`, `Exists(key)`, `Item(key)` (get and set, also via default member `d(key)` and `d(key) = v`), `Keys()`, `Items()`, `Count`, `Remove key`, `RemoveAll`, `Key(old) = new`, and `CompareMode`.

**DICT-04** `Add` with an existing key shall raise runtime error 457 ("This key is already associated with an element of this collection").

**DICT-05** Reading `d(key)` for a missing key shall add the key with an Empty item and return Empty (VBA behaviour), and the execution trace shall not report this as an error.

**DICT-06** `Remove` of a missing key shall raise runtime error 32811.

**DICT-07** `Keys()` and `Items()` shall return 0-based Variant arrays in insertion order.

**DICT-08** Keys shall compare by VBA value semantics: numbers and strings are different keys (`1` vs `"1"`); with the default `CompareMode = vbBinaryCompare` strings are case-sensitive; with `vbTextCompare` they are case-insensitive. Setting `CompareMode` on a non-empty Dictionary shall raise runtime error 5.

**DICT-09** `For Each k In d` shall iterate keys in insertion order; `For Each k In d.Keys` likewise.

**DICT-10** Any other ProgID passed to `CreateObject` shall still raise `UnsupportedError` with construct `CreateObject` and the ProgID in the message.

## Acceptance
- A new fixture `fixtures/src/dictionary_grouping/` (acts by category written with a Dictionary instead of arrays) produces exactly the same `Акты` sheet as `fixtures/expected/acts_by_category.json`, and status "fully resurrected".
- Unit tests for every requirement above, including errors 457, 32811 and 5.
- `graveyard` fixture is unchanged: `CreateObject("Scripting.FileSystemObject")` is still unsupported.

## Acceptance details (added with design.md; none of the requirements above is weakened)

Each item makes one requirement above checkable. Items marked *unverified* are choices made without a real Excel to compare against. They get a test that pins the choice, and must be checked on Excel before the test is treated as an oracle.

- **DICT-01 / DICT-02 / DICT-10, static scan.** The static unsupported scan (`scanUnsupported`) does not list `CreateObject("Scripting.Dictionary")` (string literal, any case) or `New Scripting.Dictionary`. It still lists `CreateObject` with any other literal ProgID, `CreateObject` with a non-literal argument, and `New <anything else>`. A run with no other unsupported statements is "fully resurrected".
- **DICT-10.** The `construct` stays `CreateObject`. The `UnsupportedError` message contains the ProgID as written in the macro, for example `CreateObject ("Scripting.FileSystemObject")`.
- **DICT-03.** `TypeName(d)` returns `"Dictionary"`. A member name that Dictionary does not have raises error 438. A wrong argument count raises error 450. `Count` is a Long. `Exists` returns a Boolean. `Add`, `Remove`, `RemoveAll` return Empty.
- **DICT-03, `Key`.** `d.Key(old) = new` keeps the item and its position. Missing `old` raises 32811. `new` already present as a different entry raises 457.
- **DICT-04.** Error 457 has description "This key is already associated with an element of this collection". Under `vbTextCompare`, `Add "a"` after `Add "A"` raises 457.
- **DICT-05.** A read of a missing key adds the key at the end. It records no trace event, no unsupported hit, and leaves `Err.Number` at 0. `Exists` never adds a key.
- **DICT-06.** Error 32811 has description "Application-defined or object-defined error".
- **DICT-07.** `Keys()` and `Items()` are 0-based whatever `Option Base` says. On an empty Dictionary they return an array with bounds `0 To -1`. The array is a copy: changing it does not change the Dictionary.
- **DICT-08.** Integer, Long, Double and Date keys with the same numeric value are the same key (`1`, `1&`, `1#`). A String key never equals a numeric key. Error 5 has description "Invalid procedure call or argument". `CompareMode` accepts 0 and 1; other numbers raise 5. `vbDatabaseCompare` (2) is reported as `UnsupportedError`, not accepted silently. The module's `Option Compare` does not affect a Dictionary. *Unverified:* Boolean keys are distinct from numeric keys; Empty is a valid key; an Array or object as key raises 5.
- **DICT-09.** `For Each` iterates over a snapshot of the keys taken when the loop starts. Adding or removing entries inside the loop does not change what is iterated. *Unverified:* real Scripting.Dictionary may differ when the body modifies the Dictionary.
- **Out of scope** (still reported as unsupported or by the existing mechanism): `Set d(key) = obj` and `Set d.Item(key) = obj` (existing "Set on a member or element"), `Dim d As Dictionary` without the `Scripting.` prefix, `HashVal`, `GetObject`, other ProgIDs.
