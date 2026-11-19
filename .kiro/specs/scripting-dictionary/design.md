# Design: Scripting.Dictionary shim

Implements DICT-01..DICT-10 (see `requirements.md`, including "Acceptance details"). All changes are in `packages/vba` plus one test list in `packages/vba/tests`. No change to `packages/workbook`, `packages/ovba` or `app`, and no network access.

## 1. Where it plugs in

The interpreter talks to every host object through the `VbObject` interface in `values.ts` (`typeName`, `get(member, args)`, `set(member, args, value)`, optional `defaultValue()`). Dictionary is one more `VbObject`. These gaps stop it from working today:

| Gap | Where | Current behaviour |
|---|---|---|
| `CreateObject` | `callByName` falls into `KNOWN_UNIMPLEMENTED` | `UnsupportedError("", 0, "CreateObject")` for every ProgID |
| `New X` | `evaluate` case `NewExpr` | always `UnsupportedError("New X")`; `parseTypeName` drops `New` and reads one token, so `As New Scripting.Dictionary` leaves `.Dictionary` unparsed |
| static scan | `constructs.ts` `scanUnsupported` | every `CreateObject` identifier and every `NewExpr` is a hit |
| `d(key)`, `d(key) = v` | `callByName` slot branch, `assignTarget` `CallExpr` branch | a slot that holds an object throws `FatalError("Expected array")`, or falls through to "assignment to a call result" |
| `For Each k In d` | `execForEach` | anything that is not a `VbArray` throws `UnsupportedError("For Each over a non-array")` |

## 2. New file `packages/vba/src/dictionary.ts`

`objects.ts` already holds `ErrObject`, `RangeObject`, `WorksheetObject`, `WorkbookObject`. Dictionary needs its own key-normalisation code, so it lives in `dictionary.ts` and `objects.ts` re-exports `DictionaryObject`. Everything that imports from `objects.js` keeps working.

```ts
export class DictionaryObject implements VbObject {
  readonly typeName = "Dictionary";
  readonly defaultMember = "Item";                       // see 3.1
  readonly indexedSetters = new Set(["item", "key"]);    // see 3.2
  private entries = new Map<string, { key: Value; item: Value }>(); // JS Map keeps insertion order
  private mode: CompareMode = "binary";                  // from compare.ts
  get(member, args): Value
  set(member, args, value): void
  enumerate(): Value[]                                   // keys, for For Each
}
```

### 2.1 Key normalisation (DICT-08)

`normalise(key: Value): string` maps a VBA value to the string used as the `Map` key. The original `key` Value is stored in the entry and is what `Keys()` and `For Each` return, so `Add 1&, "x"` gives back a Long and `Add "Abc"` under text compare keeps the first spelling.

| Key value | Map key |
|---|---|
| `IntValue`, `number` (Double, Date) | `"n:" + String(n)`; `-0` becomes `0`. Integer, Long and Double with equal value collide on purpose. |
| `string`, binary mode | `"s:" + s` |
| `string`, text mode | `"s:" + s.toLowerCase()` (same folding as `compareStrings` in `compare.ts`) |
| `boolean` | `"b:true"` / `"b:false"` (unverified) |
| `null` (Empty) | `"e:"` (unverified) |
| `VbArray`, `VbObject`, `NOTHING` | `RuntimeError(5, "Invalid procedure call or argument")` (unverified) |

`1` and `"1"` get different prefixes, so they are different keys. The module's `Option Compare` is not consulted: the Dictionary uses only its own `mode`.

### 2.2 Members (DICT-03..DICT-09)

Member names are matched case-insensitively. `get` serves property reads and method calls, as in `RangeObject`.

| Member | Behaviour | Result |
|---|---|---|
| `Add k, v` | 2 args else 450. Key present: `RuntimeError(457, "This key is already associated with an element of this collection")`. Else append. | `null` |
| `Exists(k)` | 1 arg. Never adds. | Boolean |
| `Item(k)` get | Missing key: append `{key: k, item: null}` and return `null` (DICT-05). No trace event, no hit, `Err` untouched, because the code path only touches `entries`. | stored item |
| `Item(k) = v` (set) | Existing key: replace the item in place, position unchanged. Missing key: append. Objects on the right side follow the rule in 3.3. | |
| `Items()` | `VbArray.from1D(items, 0, "Variant")`. Empty: bounds `0 To -1`. | copy, 0-based |
| `Keys()` | same, with keys. | copy, 0-based |
| `Count` | | `mkLong(entries.size)` |
| `Remove k` | Missing: `RuntimeError(32811, "Application-defined or object-defined error")`. | `null` |
| `RemoveAll` | clears. | `null` |
| `Key(old) = new` | `old` missing: 32811. `new` present under a different entry: 457. Otherwise rebuild `entries` with the same order and the entry's `key` replaced. Renaming an entry to a key that normalises to itself (changing case under text compare) is allowed. | |
| `CompareMode` get | | `mkLong(0 or 1)` |
| `CompareMode = n` | `toLongArg(n)`. Non-empty: `RuntimeError(5, ...)`. Empty: 0 gives binary, 1 gives text, 2 gives `UnsupportedError("", 0, "CompareMode vbDatabaseCompare")`, anything else error 5. `vbUseCompareOption` (-1) is also error 5. | |
| anything else | `RuntimeError(438, "Object doesn't support this property or method")` | |

Errors are `RuntimeError`, so `On Error`, `Err.Number` and `Err.Description` work through the existing `handleError` path with no interpreter change. `Err.Number` is 457, 32811 or 5 as required.

`Keys()` and `Items()` copy into a fresh `VbArray`. Elements that are `VbArray` are copied with `.copy()`, since arrays have value semantics.

`defaultValue` is not defined. `x = d` therefore raises 438 through the existing `unwrapDefault`/`defaultOf`, which is what VBA does for an object without a default value property.

## 3. Interpreter changes

### 3.1 Default member `d(key)` (DICT-03)

Add two optional members to `VbObject` in `values.ts`:

```ts
defaultMember?: string;                 // name used for obj(args) and obj(args) = v
indexedSetters?: ReadonlySet<string>;   // lower-case members that accept `obj.Member(args) = v`
enumerate?(): Value[];                  // elements for For Each
```

- `callByName`, slot branch. Before `throw new FatalError("Expected array")`: if `isObject(slot.value) && slot.value.defaultMember`, return `slot.value.get(slot.value.defaultMember, args.map(evaluate))`. A Nothing slot keeps raising 91 through `requireObject`.
- `assignTarget`, `CallExpr`/`IndexExpr` branch, callee `Identifier`: if the slot holds an object with `defaultMember`, call `obj.set(defaultMember, indices, value)` and return. This goes before the existing "Cells(1, 1) = x" fallback.
- `assignTarget`, callee `MemberExpr` or `WithMemberExpr` (`d.Item(k) = v`, `d.Key(old) = new`): evaluate the object; if `obj.indexedSetters?.has(member.toLowerCase())`, call `obj.set(member, args, value)`. The `indexedSetters` check is needed because `ws.Cells(1, 1) = x` has the same shape and must keep going through the default-property path.
- `d.Add k, v`, `d.Remove k` as statements already reach `evalCall` through `CallStatement` with a `MemberExpr` callee, so they need no change.

### 3.2 Creating the object (DICT-01, DICT-02)

A helper `createObject(progId: string, at: Located): Value` in `interpreter.ts`:

- `progId.trim().toLowerCase() === "scripting.dictionary"` returns `new DictionaryObject()`.
- Anything else throws `UnsupportedError(at.module, at.line, "CreateObject", progId)`. The new fourth parameter `detail` is appended to the message as `CreateObject ("<progId>")` (DICT-10). `construct` stays `"CreateObject"`, so the graveyard grouping and `graveyard.json` are unchanged.

`callByName`: handle key `createobject` before the `KNOWN_UNIMPLEMENTED` check. It takes exactly one argument (else 450), evaluates it with `toStr`, and calls `createObject`. `KNOWN_UNIMPLEMENTED` keeps `"createobject"` so a call with an unusable shape still reports as unsupported, never as "undefined". `handleError` currently rebuilds a located `UnsupportedError` from `e.construct` only. It must copy `detail` too.

`evaluate`, case `NewExpr`: `className.toLowerCase() === "scripting.dictionary"` returns `new DictionaryObject()`. Other class names throw as today.

Parser (`parser.ts`, `ast.ts`):

- `parseTypeName` reads a dotted name: identifier, then while the next token is `.` followed by an identifier, append both. `Excel.Range` then reaches `canonicalType` as one string, which already strips `Excel.`.
- `New` in `Dim x As New T`: `parseTypeName` stops dropping the keyword silently. `DimDeclarator` gets `isNew: boolean`. The parameter path (`ByVal p As New T`) is not valid VBA and ignores it.
- `NewExpr` (`Set d = New Scripting.Dictionary`): the class name is parsed with the same dotted-name helper.

Types (`values.ts`):

- `SUPPORTED_TYPES` maps `"scripting.dictionary"` to the canonical name `"Dictionary"`, the same string as `DictionaryObject.typeName`. `isObjectType` includes `"Dictionary"`, and `defaultValueFor` returns `NOTHING` for it through the existing object branch. `execSet` already rejects an object whose `typeName` differs from the slot's `declaredType`.
- `coerceToType` for `"Dictionary"` accepts `NOTHING` or an object with `typeName === "Dictionary"`, and raises 13 for any other object. The generic `isObjectType` branch accepts any object, so this is a separate check placed before it.

`newSlot`: when `d.isNew`, the initial value is a fresh `DictionaryObject` if the canonical type is `"Dictionary"`. For any other class the slot is `unsupported: "As New <T>"` as now. Real VBA creates an `As New` object on first use. This design creates it when the declaration is hoisted. The two differ only after `Set d = Nothing`, where VBA would re-create the object on the next use and this design leaves `Nothing` (error 91). That case is listed as a known deviation in the tests (DTASK-09).

### 3.3 Assigning items

`Item(k) = v` stores `v` as the Variant value. When `v` is an object (for example a Range), it is replaced by its default value, the rule `assignSlot` already applies to a Variant variable (`defaultOf`). Arrays are copied. `Set d(k) = obj` is out of scope and remains "Set on a member or element" in `execSet`.

### 3.4 `For Each` (DICT-09)

`execForEach`: after evaluating the collection, `if (isObject(collection) && collection.enumerate)` use `collection.enumerate()` as the element list. It is already a snapshot, matching the `[...collection.data]` copy used for arrays. Other values keep the current `UnsupportedError("For Each over a non-array")`, so existing tests are unaffected. `For Each k In d.Keys` already works through the array branch once `Keys()` returns a `VbArray`.

## 4. Static scan (`constructs.ts`)

`scanUnsupported` stays a pure AST walk. Changes:

1. New case `CallExpr`, before the generic descent: when `callee` is an `Identifier` named `createobject` (case-insensitive, not shadowed by a module-declared name, same `own` check as today), has exactly one argument, and that argument is a string `Literal` equal to `scripting.dictionary` case-insensitively, visit only the arguments and skip the callee. The callee `Identifier` is what produces the hit today, so skipping it removes the hit.
2. `NewExpr`: no hit when `className.toLowerCase() === "scripting.dictionary"`. Other classes still report `New <className>`; the class name is now dotted, as in `New Foo.Bar`.
3. New case `DimStatement`: for each declarator with `isNew` and a class other than `Scripting.Dictionary`, add `New <className>` at the statement's module and line. Before this change the parser dropped `New` there, so these were never listed statically.
4. A `CreateObject` call with a non-literal argument, or any other literal, is still reported. The run-time check in 3.2 decides what actually happens; `staticUnsupported` is reported separately from the run-time `hits` and does not affect `status`, so a macro that builds the ProgID in a variable and gets the Dictionary at run time is still "fully resurrected" while its line appears in the static list. That is the conservative direction.

`unsupported.test.ts` currently asserts that `Set f = CreateObject("Scripting.Dictionary")` on a dead line is a static hit (line 44). That test encodes the behaviour DICT-01 replaces. It is rewritten to use `Scripting.FileSystemObject`, which keeps its purpose (the scan finds `CreateObject` on a line that never runs), and a new test covers the Dictionary exemption.

## 5. Status and trace

- `status` is computed from `hits` (run-time) only. Dictionary raises no `UnsupportedError` in any supported path, so `dictionary_grouping` is "fully resurrected" and `staticUnsupported` is `[]`, as `fixtures/expected/dictionary_grouping.json` requires.
- No `TraceEvent` is produced by Dictionary operations. DICT-05 is satisfied structurally: the trace only records workbook reads and writes (`tracing-workbook.ts`) and `unsupported` events.
- `fixtures/expected/dictionary_grouping.json` is the hand-written oracle. It is not edited. If the implementation disagrees with it, the implementation is wrong.

## 6. Test strategy

- Unit tests go in a new `packages/vba/tests/dictionary.test.ts`, written against `runMacro` with `MemoryWorkbook`, one `describe` per DICT id. Error cases use `On Error Resume Next` and write `Err.Number` and `Err.Description` into cells, and also assert the uncaught `RuntimeError.code` through `result.error`.
- Property test (fast-check, already the repo's tool for built-ins): for random sequences of `Add`/`Remove`/`Item set`/`Key set` on a Dictionary, the observable state (`Keys()`, `Items()`, `Count`, `Exists`) matches a reference model written with an array of pairs and linear search. Keys are drawn from small sets of numbers, strings with mixed case, and numeric strings.
- Fixture end to end: remove the `dictionary_grouping` entry from `TODO` in `e2e.test.ts`. Add it to the `describe.each` list in `fixtures.test.ts` (the source-based loader). `graveyard` stays as is and is part of the regression run.
- Items marked *unverified* in the requirements get a test with a comment `// unverified against Excel` so a later check on real Excel is easy to find.

## 7. Risks

- Parser change for dotted type names touches every `Dim`/`As`. The existing parser and fixture tests must stay green after DTASK-02 before anything else is built on it.
- `indexedSetters` is a narrow escape hatch. If a second object type later needs indexed property assignment, it should join the same mechanism and not add another special case.
- The 457/32811/5 descriptions are taken from the Scripting Runtime. 457 is given in the requirements; the other two are from memory and must be checked on Excel (note in the tests).
