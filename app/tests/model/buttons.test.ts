import { describe, it, expect } from "vitest";
import type { RawButton } from "@vba-necromancer/workbook";
import { resolveButtons } from "../../src/model/buttons";
import { exhumeParts } from "../../src/model/exhume";
import type { MacroInfo } from "../../src/model/types";
import { fixtureBytes } from "../helpers";

const macro = (module: string, name: string, status: "fully" | "partly" = "fully"): MacroInfo => ({
  id: `${module}.${name}`,
  module,
  name,
  line: 1,
  prediction: { status, hits: [] },
});
const button = (macroRef: string): RawButton => ({
  sheet: "Log",
  caption: "Go",
  anchor: "H2",
  macroRef,
  source: "form-control",
});
const MACROS = [macro("Module1", "BuildActs"), macro("Module1", "Other", "partly")];
const resolve = (ref: string, macros = MACROS, file = "Book.xlsm") =>
  resolveButtons([button(ref)], macros, file)[0];

describe("resolveButtons (BTN-03)", () => {
  it.each([
    "[0]!Module1.BuildActs",
    "'Book.xlsm'!BuildActs",
    "Module1.BuildActs",
    "BuildActs",
    "module1.BUILDACTS",
    "'book.XLSM'!buildacts",
  ])("%s resolves to Module1.BuildActs", (ref) => {
    const b = resolve(ref);
    expect(b.macroId).toBe("Module1.BuildActs");
    expect(b.note).toBeNull();
  });

  it("copies the prediction from the macro (the same object)", () => {
    expect(resolve("Module1.Other").prediction).toBe(MACROS[1].prediction);
  });

  it("keeps the raw fields of the button", () => {
    expect(resolve("BuildActs")).toMatchObject({
      sheet: "Log",
      caption: "Go",
      anchor: "H2",
      source: "form-control",
    });
  });

  it("a reference to a missing macro has a note and no Run action", () => {
    const b = resolve("Module1.Nope");
    expect(b).toMatchObject({
      macroId: null,
      prediction: null,
      note: "Macro not found: Module1.Nope.",
    });
    expect(resolve("Nope").note).toBe("Macro not found: Nope.");
  });

  it("a reference to another workbook is not resolved", () => {
    expect(resolve("'Other.xlsm'!BuildActs")).toMatchObject({
      macroId: null,
      note: "Macro not found: it belongs to another workbook (Other.xlsm).",
    });
    expect(resolve("[2]!BuildActs")).toMatchObject({
      macroId: null,
      note: "Macro not found: it belongs to another workbook ([2]).",
    });
  });

  it("a bare name that exists in two modules is ambiguous", () => {
    const macros = [macro("Module1", "Go"), macro("Module2", "Go")];
    expect(resolve("Go", macros)).toMatchObject({
      macroId: null,
      note: "Macro not found: Go exists in Module1 and Module2, so the button is ambiguous.",
    });
    expect(resolve("Module2.Go", macros).macroId).toBe("Module2.Go");
  });

  it("a Private Sub and a Function are not in the macro list, so they are not found", () => {
    const e = exhumeParts("Book.xlsm", fixtureBytes("demo_acts"), [
      {
        name: "Module1",
        type: "procedural",
        source:
          "Private Sub Hidden()\nEnd Sub\nFunction Calc() As Long\nEnd Function\nSub Public1()\nEnd Sub\n",
      },
    ]);
    const out = resolveButtons(
      [button("Hidden"), button("Module1.Calc"), button("Public1")],
      e.macros,
      "Book.xlsm",
    );
    expect(out.map((b) => b.macroId)).toEqual([null, null, "Module1.Public1"]);
    expect(out[0].note).toBe("Macro not found: Hidden.");
  });
});
