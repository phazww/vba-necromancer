import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { DictionaryObject } from "../src/objects.js";
import { RuntimeError, UnsupportedError } from "../src/errors.js";
import { IntValue, NOTHING, VbArray, mkInt, mkLong, type Value } from "../src/values.js";

const add = (d: DictionaryObject, k: Value, v: Value) => d.get("Add", [k, v]);
const item = (d: DictionaryObject, k: Value) => d.get("Item", [k]);
const exists = (d: DictionaryObject, k: Value) => d.get("Exists", [k]);
const count = (d: DictionaryObject) => (d.get("Count", []) as IntValue).n;
const arr = (v: Value) => (v as VbArray).data;

function codeOf(fn: () => unknown): number {
  try {
    fn();
  } catch (e) {
    if (e instanceof RuntimeError) return e.code;
    throw e;
  }
  throw new Error("no error thrown");
}

describe("DictionaryObject basics", () => {
  it("Add, Exists, Item get/set, Count, Remove, RemoveAll", () => {
    const d = new DictionaryObject();
    expect(add(d, "a", 1)).toBeNull();
    expect(exists(d, "a")).toBe(true);
    expect(exists(d, "b")).toBe(false);
    expect(item(d, "a")).toBe(1);
    d.set("Item", ["a"], 2);
    expect(item(d, "a")).toBe(2);
    d.set("Item", ["b"], 3); // set on a missing key adds it
    expect(count(d)).toBe(2);
    expect(d.get("Count", [])).toEqual(new IntValue(2, true));
    expect(d.get("Remove", ["a"])).toBeNull();
    expect(exists(d, "a")).toBe(false);
    expect(d.get("RemoveAll", [])).toBeNull();
    expect(count(d)).toBe(0);
  });

  it("members are case-insensitive", () => {
    const d = new DictionaryObject();
    d.get("ADD", ["a", 1]);
    expect(d.get("count", [])).toEqual(mkLong(1));
  });

  it("Keys and Items are 0-based, in insertion order, and copies", () => {
    const d = new DictionaryObject();
    add(d, "z", 1);
    add(d, 5, "x");
    add(d, "a", 3);
    const keys = d.get("Keys", []) as VbArray;
    expect(keys.lbounds).toEqual([0]);
    expect(keys.ubounds).toEqual([2]);
    expect(keys.data).toEqual(["z", 5, "a"]);
    expect(arr(d.get("Items", []))).toEqual([1, "x", 3]);
    keys.data[0] = "changed";
    expect(arr(d.get("Keys", []))[0]).toBe("z");
  });

  it("empty Keys and Items have bounds 0 To -1", () => {
    const d = new DictionaryObject();
    for (const m of ["Keys", "Items"]) {
      const a = d.get(m, []) as VbArray;
      expect(a.lbounds).toEqual([0]);
      expect(a.ubounds).toEqual([-1]);
    }
  });

  it("array items are copied on the way in and out", () => {
    const d = new DictionaryObject();
    const a = VbArray.allocate([1], [2], "Variant");
    d.set("Item", ["k"], a);
    a.set([1], 99);
    const got = item(d, "k") as VbArray;
    expect(got.get([1])).toBeNull();
    got.set([1], 5);
    expect((item(d, "k") as VbArray).get([1])).toBeNull();
  });
});

describe("DictionaryObject errors", () => {
  it("Add of an existing key throws 457", () => {
    const d = new DictionaryObject();
    add(d, "a", 1);
    expect(() => add(d, "a", 2)).toThrow(RuntimeError);
    try {
      add(d, "a", 2);
    } catch (e) {
      expect((e as RuntimeError).code).toBe(457);
      expect((e as RuntimeError).message).toBe("This key is already associated with an element of this collection");
    }
  });

  it("reading a missing key appends it with Empty; Exists does not append", () => {
    const d = new DictionaryObject();
    expect(exists(d, "x")).toBe(false);
    expect(count(d)).toBe(0);
    expect(item(d, "x")).toBeNull();
    expect(count(d)).toBe(1);
    expect(exists(d, "x")).toBe(true);
    expect(arr(d.get("Keys", []))).toEqual(["x"]);
  });

  it("Remove of a missing key throws 32811 // unverified against Excel (description)", () => {
    const d = new DictionaryObject();
    expect(codeOf(() => d.get("Remove", ["nope"]))).toBe(32811);
  });

  it("unknown members throw 438, wrong argument counts throw 450", () => {
    const d = new DictionaryObject();
    expect(codeOf(() => d.get("Foo", []))).toBe(438);
    expect(codeOf(() => d.set("Count", [], 1))).toBe(438);
    expect(codeOf(() => d.get("Add", ["a"]))).toBe(450);
    expect(codeOf(() => d.get("Exists", []))).toBe(450);
    expect(codeOf(() => d.get("Item", ["a", "b"]))).toBe(450);
    expect(codeOf(() => d.get("Count", [1]))).toBe(450);
    expect(codeOf(() => d.get("Keys", [1]))).toBe(450);
    expect(codeOf(() => d.set("Item", [], 1))).toBe(450);
  });
});

describe("DictionaryObject keys", () => {
  it("1 and '1' are distinct keys", () => {
    const d = new DictionaryObject();
    add(d, 1, "n");
    add(d, "1", "s");
    expect(count(d)).toBe(2);
    expect(item(d, 1)).toBe("n");
    expect(item(d, "1")).toBe("s");
  });

  it("Integer, Long and Double keys with the same value are the same key", () => {
    const d = new DictionaryObject();
    add(d, mkInt(1), "x");
    expect(exists(d, mkLong(1))).toBe(true);
    expect(exists(d, 1)).toBe(true);
    expect(codeOf(() => add(d, 1.0, "y"))).toBe(457);
    expect(exists(d, 0)).toBe(false);
    add(d, 0, "zero");
    expect(exists(d, -0)).toBe(true);
  });

  it("strings are case-sensitive in binary mode, and the first spelling is kept in text mode", () => {
    const d = new DictionaryObject();
    add(d, "a", 1);
    expect(exists(d, "A")).toBe(false);

    const t = new DictionaryObject();
    t.set("CompareMode", [], 1);
    add(t, "Abc", 1);
    expect(exists(t, "aBC")).toBe(true);
    expect(codeOf(() => add(t, "ABC", 2))).toBe(457);
    expect(arr(t.get("Keys", []))).toEqual(["Abc"]);
    t.set("Item", ["ABC"], 7);
    expect(item(t, "abc")).toBe(7);
    expect(arr(t.get("Keys", []))).toEqual(["Abc"]);
  });

  it("the original key type is kept", () => {
    const d = new DictionaryObject();
    add(d, mkLong(1), "x");
    expect(arr(d.get("Keys", []))[0]).toEqual(mkLong(1));
  });

  // unverified against Excel
  it("Boolean keys are distinct from numbers, Empty is a valid key, arrays and objects raise 5", () => {
    const d = new DictionaryObject();
    add(d, true, "t");
    add(d, -1, "n");
    add(d, null, "e");
    expect(count(d)).toBe(3);
    expect(exists(d, null)).toBe(true);
    expect(codeOf(() => exists(d, VbArray.allocate([1], [1], "Variant")))).toBe(5);
    expect(codeOf(() => exists(d, new DictionaryObject()))).toBe(5);
    expect(codeOf(() => exists(d, NOTHING))).toBe(5);
  });
});

describe("DictionaryObject.CompareMode", () => {
  it("defaults to 0 and can be set on an empty Dictionary", () => {
    const d = new DictionaryObject();
    expect(d.get("CompareMode", [])).toEqual(mkLong(0));
    d.set("CompareMode", [], 1);
    expect(d.get("CompareMode", [])).toEqual(mkLong(1));
    d.set("CompareMode", [], 0);
    expect(d.get("CompareMode", [])).toEqual(mkLong(0));
  });

  it("throws 5 on a non-empty Dictionary and for values other than 0, 1, 2", () => {
    const d = new DictionaryObject();
    add(d, "a", 1);
    expect(codeOf(() => d.set("CompareMode", [], 1))).toBe(5);
    const e = new DictionaryObject();
    expect(codeOf(() => e.set("CompareMode", [], 7))).toBe(5);
    expect(codeOf(() => e.set("CompareMode", [], -1))).toBe(5);
  });

  it("vbDatabaseCompare is reported as unsupported", () => {
    const d = new DictionaryObject();
    expect(() => d.set("CompareMode", [], 2)).toThrow(UnsupportedError);
  });
});

describe("DictionaryObject.Key", () => {
  it("renames in place: position and item are kept", () => {
    const d = new DictionaryObject();
    add(d, "a", 1);
    add(d, "b", 2);
    add(d, "c", 3);
    d.set("Key", ["b"], "x");
    expect(arr(d.get("Keys", []))).toEqual(["a", "x", "c"]);
    expect(arr(d.get("Items", []))).toEqual([1, 2, 3]);
    expect(exists(d, "b")).toBe(false);
  });

  it("missing old key gives 32811, existing new key gives 457", () => {
    const d = new DictionaryObject();
    add(d, "a", 1);
    add(d, "b", 2);
    expect(codeOf(() => d.set("Key", ["zzz"], "q"))).toBe(32811);
    expect(codeOf(() => d.set("Key", ["a"], "b"))).toBe(457);
    expect(arr(d.get("Keys", []))).toEqual(["a", "b"]);
  });

  // unverified against Excel
  it("a case-only rename is allowed under text compare", () => {
    const d = new DictionaryObject();
    d.set("CompareMode", [], 1);
    add(d, "abc", 1);
    d.set("Key", ["ABC"], "Abc");
    expect(arr(d.get("Keys", []))).toEqual(["Abc"]);
  });
});

describe("DictionaryObject against a reference model", () => {
  type Op =
    | { op: "add"; k: Value; v: number }
    | { op: "set"; k: Value; v: number }
    | { op: "get"; k: Value }
    | { op: "remove"; k: Value }
    | { op: "key"; k: Value; n: Value };

  const keyArb: fc.Arbitrary<Value> = fc.oneof(
    fc.constantFrom<Value>(0, 1, 2, 2.5, mkLong(1), mkInt(2)),
    fc.constantFrom<Value>("a", "A", "b", "B", "ab", "Ab"),
    fc.constantFrom<Value>("1", "2", "01"),
  );
  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ op: fc.constant("add" as const), k: keyArb, v: fc.integer() }),
    fc.record({ op: fc.constant("set" as const), k: keyArb, v: fc.integer() }),
    fc.record({ op: fc.constant("get" as const), k: keyArb }),
    fc.record({ op: fc.constant("remove" as const), k: keyArb }),
    fc.record({ op: fc.constant("key" as const), k: keyArb, n: keyArb }),
  );

  function same(a: Value, b: Value, text: boolean): boolean {
    const num = (x: Value) => (x instanceof IntValue ? x.n : typeof x === "number" ? x : null);
    const na = num(a);
    const nb = num(b);
    if (na !== null || nb !== null) return na === nb;
    if (typeof a === "string" && typeof b === "string") return text ? a.toLowerCase() === b.toLowerCase() : a === b;
    return false;
  }

  it.each([false, true])("matches in text mode = %s", (text) => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        const d = new DictionaryObject();
        if (text) d.set("CompareMode", [], 1);
        const model: Array<{ k: Value; v: Value }> = [];
        const find = (k: Value) => model.findIndex((e) => same(e.k, k, text));
        for (const o of ops) {
          const i = find(o.k);
          if (o.op === "add") {
            if (i >= 0) expect(codeOf(() => add(d, o.k, o.v))).toBe(457);
            else {
              add(d, o.k, o.v);
              model.push({ k: o.k, v: o.v });
            }
          } else if (o.op === "set") {
            d.set("Item", [o.k], o.v);
            if (i >= 0) model[i].v = o.v;
            else model.push({ k: o.k, v: o.v });
          } else if (o.op === "get") {
            const got = item(d, o.k);
            if (i >= 0) expect(got).toBe(model[i].v);
            else {
              expect(got).toBeNull();
              model.push({ k: o.k, v: null });
            }
          } else if (o.op === "remove") {
            if (i >= 0) {
              d.get("Remove", [o.k]);
              model.splice(i, 1);
            } else expect(codeOf(() => d.get("Remove", [o.k]))).toBe(32811);
          } else {
            const j = find(o.n);
            if (i < 0) expect(codeOf(() => d.set("Key", [o.k], o.n))).toBe(32811);
            else if (j >= 0 && j !== i) expect(codeOf(() => d.set("Key", [o.k], o.n))).toBe(457);
            else {
              d.set("Key", [o.k], o.n);
              model[i].k = o.n;
            }
          }
          expect(count(d)).toBe(model.length);
        }
        expect(arr(d.get("Keys", []))).toEqual(model.map((e) => e.k));
        expect(arr(d.get("Items", []))).toEqual(model.map((e) => e.v));
        for (const e of model) expect(exists(d, e.k)).toBe(true);
      }),
    );
  });
});
