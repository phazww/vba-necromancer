import { describe, it, expect } from "vitest";
import { exhume, exhumeParts } from "../../src/model/exhume";
import { countProcedures, procedureSpans } from "../../src/model/macros";
import { fixtureBytes } from "../helpers";

function parts(sources: Array<{ name: string; source: string }>) {
  return exhumeParts(
    "demo_acts.xlsm",
    fixtureBytes("demo_acts"),
    sources.map((s) => ({ ...s, type: "procedural" as const })),
  );
}

describe("listMacros", () => {
  it("labour_statement: CalcPay is a macro, RateFor (a Function with a parameter) is not", () => {
    const e = exhume("labour_statement.xlsm", fixtureBytes("labour_statement"));
    expect(e.macros.map((m) => m.id)).toContain("Module1.CalcPay");
    expect(e.macros.map((m) => m.name)).not.toContain("RateFor");
    expect(countProcedures(e.modules) - e.macros.length).toBe(1);
    expect(e.procedureCount).toBe(countProcedures(e.modules));
  });

  it("lists only Subs without parameters that are not Private", () => {
    const e = parts([
      {
        name: "M",
        source: "Private Sub A()\nEnd Sub\nSub B(x As Long)\nEnd Sub\nPublic Sub C()\nEnd Sub\nSub D()\nEnd Sub\n",
      },
    ]);
    expect(e.macros.map((m) => m.name)).toEqual(["C", "D"]);
    expect(e.macros.map((m) => m.line)).toEqual([5, 7]);
  });

  it("gives duplicate names in two modules distinct ids, ordered by module then line", () => {
    const e = parts([
      { name: "One", source: "Sub Go()\nEnd Sub\n" },
      { name: "Two", source: "Sub Go()\nEnd Sub\n" },
    ]);
    expect(e.macros.map((m) => m.id)).toEqual(["One.Go", "Two.Go"]);
  });

  it("modules that did not parse contribute no macros", () => {
    const e = parts([{ name: "Bad", source: "Sub A()\n x = (1 +\nEnd Sub\n" }]);
    expect(e.macros).toEqual([]);
  });
});

describe("procedureSpans", () => {
  it("graveyard: lines 5 to 19 and 20 to the last line", () => {
    const e = exhume("graveyard.xlsm", fixtureBytes("graveyard"));
    const m = e.modules[0];
    if (!m.ast) throw new Error("module did not parse");
    const spans = procedureSpans(m.ast.procedures, m.lines.length);
    expect(spans.map((s) => [s.proc.name, s.from, s.to])).toEqual([
      ["ExportReport", 5, 19],
      ["ExportStrict", 20, m.lines.length],
    ]);
    expect(m.lines.length).toBe(24);
  });
});
