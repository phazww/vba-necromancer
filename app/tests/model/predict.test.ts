import { describe, it, expect } from "vitest";
import { exhume, exhumeParts } from "../../src/model/exhume";
import { FIXTURE_NAMES, expectedFor, fixtureBytes } from "../helpers";

function build(sources: Array<{ name: string; source: string }>) {
  return exhumeParts(
    "demo_acts.xlsm",
    fixtureBytes("demo_acts"),
    sources.map((s) => ({ ...s, type: "procedural" as const })),
  );
}

const lines = (hits: Array<{ line: number }>): number[] => hits.map((h) => h.line);

describe("predictMacro", () => {
  const graveyard = exhume("graveyard.xlsm", fixtureBytes("graveyard"));

  it("graveyard.ExportReport is partly, with lines 11, 13, 14, 15 and no Declare", () => {
    const m = graveyard.macros.find((x) => x.id === "Module1.ExportReport");
    expect(m?.prediction.status).toBe("partly");
    expect(lines(m?.prediction.hits ?? [])).toEqual(expect.arrayContaining([11, 13, 14, 15]));
    expect(lines(m?.prediction.hits ?? [])).not.toContain(3);
    expect(lines(m?.prediction.hits ?? [])).not.toContain(22);
  });

  it("graveyard.ExportStrict is partly, with line 22 and no Declare", () => {
    const m = graveyard.macros.find((x) => x.id === "Module1.ExportStrict");
    expect(m?.prediction.status).toBe("partly");
    expect(lines(m?.prediction.hits ?? [])).toEqual([22]);
  });

  it("demo_acts.BuildActs is fully, with no hits", () => {
    const e = exhume("demo_acts.xlsm", fixtureBytes("demo_acts"));
    const m = e.macros.find((x) => x.id === "Module1.BuildActs");
    expect(m?.prediction).toEqual({ status: "fully", hits: [] });
  });

  it("follows a call into another module", () => {
    const e = build([
      { name: "A", source: "Sub Main()\n  Helper\nEnd Sub\n" },
      { name: "B", source: "Sub Helper()\n  Shell \"calc\"\nEnd Sub\n" },
    ]);
    const main = e.macros.find((m) => m.id === "A.Main");
    expect(main?.prediction.status).toBe("partly");
    expect(main?.prediction.hits).toEqual([{ module: "B", line: 2, construct: "Shell" }]);
  });

  it("attaches a Declare that a macro calls by name", () => {
    const e = build([
      {
        name: "A",
        source:
          "Private Declare PtrSafe Function GetTickCount Lib \"kernel32\" () As Long\nSub Uses()\n  Dim t As Long\n  t = GetTickCount()\nEnd Sub\nSub Plain()\nEnd Sub\n",
      },
    ]);
    const uses = e.macros.find((m) => m.name === "Uses");
    const plain = e.macros.find((m) => m.name === "Plain");
    expect(uses?.prediction.hits.map((h) => h.construct)).toEqual(["Declare"]);
    expect(plain?.prediction.status).toBe("fully");
  });

  it("attaches a module-level `Dim x As New Foo` to every macro in the module", () => {
    const e = build([{ name: "A", source: "Dim x As New Foo\nSub One()\nEnd Sub\nSub Two()\nEnd Sub\n" }]);
    expect(e.staticUnsupported.length).toBeGreaterThan(0);
    for (const m of e.macros) {
      expect(m.prediction.status).toBe("partly");
      expect(lines(m.prediction.hits)).toEqual([1]);
    }
  });

  it("a hit on a module-level line between two procedures is not attributed to the first one", () => {
    const e = build([
      {
        name: "A",
        source: "Sub One()\nEnd Sub\nDim x As New Foo\nSub Two()\nEnd Sub\n",
      },
    ]);
    // The hit is on line 3. It is a declaration-level hit, so it applies to the module's
    // macros through the module rule, and it is outside the span of One (lines 1 to 2).
    expect(lines(e.staticUnsupported)).toEqual([3]);
    const one = e.macros.find((m) => m.name === "One");
    expect(lines(one?.prediction.hits ?? [])).toEqual([3]);
    // Before endLine, line 3 counted as part of One only, and Two was predicted "fully".
    const two = e.macros.find((m) => m.name === "Two");
    expect(lines(two?.prediction.hits ?? [])).toEqual([3]);
  });

  it("terminates on mutual recursion", () => {
    const e = build([
      { name: "A", source: "Sub Ping()\n  Pong\nEnd Sub\nSub Pong()\n  Ping\n  Shell \"x\"\nEnd Sub\n" },
    ]);
    const ping = e.macros.find((m) => m.name === "Ping");
    expect(ping?.prediction.status).toBe("partly");
  });
});

describe("prediction against the hand-written oracles", () => {
  // Fixtures where the prediction says "partly" but the run is "fully resurrected" are listed
  // here with the reason. None at the moment: every conservative case in the corpus is partly.
  const KNOWN_OVERCAUTIOUS: string[] = [];

  it.each(FIXTURE_NAMES)("%s: fully is never wrong, partly is always predicted", (name) => {
    const e = exhume(`${name}.xlsm`, fixtureBytes(name));
    for (const run of expectedFor(name).runs) {
      const macro = e.macros.find((m) => m.name.toLowerCase() === run.macro.toLowerCase());
      expect(macro, `${name}.${run.macro} is listed`).toBeDefined();
      const predicted = macro?.prediction.status;
      if (predicted === "fully") expect(run.status).toBe("fully resurrected");
      if (run.status === "partly resurrected") expect(predicted).toBe("partly");
      if (run.status === "fully resurrected" && predicted === "partly") {
        expect(KNOWN_OVERCAUTIOUS, `${name}.${run.macro}`).toContain(`${name}.${run.macro}`);
      }
    }
  });
});
