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
