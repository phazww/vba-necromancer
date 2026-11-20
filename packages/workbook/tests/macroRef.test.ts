import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseMacroRef } from "../src/macroRef.js";

describe("parseMacroRef (BTN-03)", () => {
  it.each([
    ["[0]!Module1.BuildActs", null, "Module1.BuildActs"],
    ["'Book.xlsm'!BuildActs", "Book.xlsm", "BuildActs"],
    ["Book.xlsm!BuildActs", "Book.xlsm", "BuildActs"],
    ["Module1.BuildActs", null, "Module1.BuildActs"],
    ["BuildActs", null, "BuildActs"],
    ["[2]!Foo", "[2]", "Foo"],
  ])("%s", (ref, book, qualified) => {
    expect(parseMacroRef(ref)).toEqual({ book, qualified });
  });

  it("reads a quoted name that contains ! and a doubled quote", () => {
    expect(parseMacroRef("'It''s! Book.xlsm'!Module1.Go")).toEqual({
      book: "It's! Book.xlsm",
      qualified: "Module1.Go",
    });
  });

  it("reads Cyrillic names", () => {
    expect(parseMacroRef("[0]!Модуль1.Акты")).toEqual({ book: null, qualified: "Модуль1.Акты" });
    expect(parseMacroRef("'Книга.xlsm'!Акты")).toEqual({ book: "Книга.xlsm", qualified: "Акты" });
  });

  it("gives an empty qualified name for empty input and trims spaces", () => {
    expect(parseMacroRef("")).toEqual({ book: null, qualified: "" });
    expect(parseMacroRef("   ")).toEqual({ book: null, qualified: "" });
    expect(parseMacroRef("  Module1.Go  ")).toEqual({ book: null, qualified: "Module1.Go" });
  });

  it("never throws on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string(), (s) => typeof parseMacroRef(s).qualified === "string"),
      { numRuns: 300 },
    );
  });
});
