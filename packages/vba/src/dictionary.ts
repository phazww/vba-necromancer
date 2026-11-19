/**
 * Scripting.Dictionary shim: a browser-safe stand-in for the COM object, so that macros which
 * group and de-duplicate with CreateObject("Scripting.Dictionary") can run.
 *
 * Keys follow VBA value semantics (see normalise). Entries keep insertion order. Errors are
 * RuntimeErrors, so On Error and Err work through the normal interpreter path.
 */

import type { CompareMode } from "./compare.js";
import { RuntimeError, UnsupportedError } from "./errors.js";
import {
  IntValue,
  VbArray,
  isObject,
  mkLong,
  toLongArg,
  type Value,
  type VbObject,
} from "./values.js";

interface Entry {
  key: Value;
  item: Value;
}

const ERR_5 = "Invalid procedure call or argument";
const ERR_450 = "Wrong number of arguments or invalid property assignment";
const ERR_457 = "This key is already associated with an element of this collection";
const ERR_438 = "Object doesn't support this property or method";
const ERR_32811 = "Application-defined or object-defined error";

function argCount(args: Value[], n: number): void {
  if (args.length !== n) throw new RuntimeError(450, ERR_450);
}

/** An item is stored as a Variant: arrays are copied, objects are replaced by their default value. */
function toItem(v: Value): Value {
  if (v instanceof VbArray) return v.copy();
  if (isObject(v)) {
    if (v.defaultValue) return v.defaultValue();
    throw new RuntimeError(438, ERR_438);
  }
  return v;
}

/** True for the ProgID / class name Scripting.Dictionary, in any case. */
export function isDictionaryProgId(name: string): boolean {
  return name.trim().toLowerCase() === "scripting.dictionary";
}

export class DictionaryObject implements VbObject {
  readonly typeName = "Dictionary";
  readonly defaultMember = "Item";
  readonly indexedSetters: ReadonlySet<string> = new Set(["item", "key"]);

  /** A JS Map keeps insertion order. */
  private entries = new Map<string, Entry>();
  private mode: CompareMode = "binary";

  /**
   * Map key for a VBA key. Numbers of every numeric type with the same value collide, a String
   * never equals a number. Under text compare, strings are folded the way compareStrings does.
   */
  private normalise(key: Value): string {
    if (key instanceof IntValue) return "n:" + String(key.n);
    if (typeof key === "number") return "n:" + String(key === 0 ? 0 : key); // -0 becomes 0
    if (typeof key === "string") return "s:" + (this.mode === "text" ? key.toLowerCase() : key);
    if (typeof key === "boolean") return key ? "b:true" : "b:false"; // unverified against Excel
    if (key === null) return "e:"; // unverified against Excel
    // arrays, objects and Nothing: unverified against Excel
    throw new RuntimeError(5, ERR_5);
  }

  get(member: string, args: Value[]): Value {
    switch (member.toLowerCase()) {
      case "add": {
        argCount(args, 2);
        const k = this.normalise(args[0]);
        if (this.entries.has(k)) throw new RuntimeError(457, ERR_457);
        this.entries.set(k, { key: args[0], item: toItem(args[1]) });
        return null;
      }
      case "exists":
        argCount(args, 1);
        return this.entries.has(this.normalise(args[0]));
      case "item": {
        argCount(args, 1);
        const k = this.normalise(args[0]);
        const found = this.entries.get(k);
        if (found) return found.item instanceof VbArray ? found.item.copy() : found.item;
        this.entries.set(k, { key: args[0], item: null }); // VBA behaviour: a read adds the key
        return null;
      }
      case "items":
        argCount(args, 0);
        return this.toArray((e) => e.item);
      case "keys":
        argCount(args, 0);
        return this.toArray((e) => e.key);
      case "count":
        argCount(args, 0);
        return mkLong(this.entries.size);
      case "remove": {
        argCount(args, 1);
        const k = this.normalise(args[0]);
        if (!this.entries.delete(k)) throw new RuntimeError(32811, ERR_32811);
        return null;
      }
      case "removeall":
        argCount(args, 0);
        this.entries.clear();
        return null;
      case "comparemode":
        argCount(args, 0);
        return mkLong(this.mode === "text" ? 1 : 0);
      default:
        throw new RuntimeError(438, ERR_438);
    }
  }

  set(member: string, args: Value[], value: Value): void {
    switch (member.toLowerCase()) {
      case "item": {
        argCount(args, 1);
        const k = this.normalise(args[0]);
        const found = this.entries.get(k);
        const item = toItem(value);
        if (found) found.item = item;
        else this.entries.set(k, { key: args[0], item });
        return;
      }
      case "key":
        argCount(args, 1);
        this.rename(args[0], value);
        return;
      case "comparemode":
        argCount(args, 0);
        this.setCompareMode(value);
        return;
      default:
        throw new RuntimeError(438, ERR_438);
    }
  }

  /** Keys, for For Each. A snapshot. */
  enumerate(): Value[] {
    return [...this.entries.values()].map((e) => e.key);
  }

  private toArray(pick: (e: Entry) => Value): VbArray {
    const values = [...this.entries.values()].map((e) => {
      const v = pick(e);
      return v instanceof VbArray ? v.copy() : v;
    });
    return VbArray.from1D(values, 0, "Variant");
  }

  private rename(oldKey: Value, newKey: Value): void {
    const from = this.normalise(oldKey);
    if (!this.entries.has(from)) throw new RuntimeError(32811, ERR_32811);
    const to = this.normalise(newKey);
    if (to !== from && this.entries.has(to)) throw new RuntimeError(457, ERR_457);
    const rebuilt = new Map<string, Entry>();
    for (const [k, e] of this.entries) {
      if (k === from) rebuilt.set(to, { key: newKey, item: e.item });
      else rebuilt.set(k, e);
    }
    this.entries = rebuilt;
  }

  private setCompareMode(value: Value): void {
    const n = toLongArg(value);
    if (this.entries.size > 0) throw new RuntimeError(5, ERR_5);
    if (n === 0) this.mode = "binary";
    else if (n === 1) this.mode = "text";
    else if (n === 2) throw new UnsupportedError("", 0, "CompareMode vbDatabaseCompare");
    else throw new RuntimeError(5, ERR_5);
  }
}
