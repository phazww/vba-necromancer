import { describe, it, expect } from "vitest";
import { exhume, exhumeParts } from "../../src/model/exhume";
import { FIXTURE_NAMES, ROOT, fixtureBytes } from "../helpers";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface ExpectedFinding {
  kind: string;
  module?: string;
  line?: number;
  reference?: { name: string; libid: string };
}
const oracle = JSON.parse(readFileSync(join(ROOT, "fixtures/expected/vbscript_deps.json"), "utf8")) as {
  findings: ExpectedFinding[];
};

describe("VBS-02 exhume model: VBScript findings", () => {
  it("vbscript_deps: the findings of the oracle, in order, and its one reference", () => {
    const e = exhume("vbscript_deps.xlsm", fixtureBytes("vbscript_deps"));
    expect(e.vba).toBe("present");
    expect(e.references).toHaveLength(1);
    expect(e.referenceProblems).toEqual([]);
    expect(
      e.vbscript.map((f) => ({
        kind: f.kind,
        ...(f.module !== null ? { module: f.module, line: f.line } : {}),
        ...(f.reference ? { reference: f.reference } : {}),
      })),
    ).toEqual(oracle.findings);
  });

  it("vbscript_deps modules all parse or report their parse error without hiding the findings", () => {
    const e = exhume("vbscript_deps.xlsm", fixtureBytes("vbscript_deps"));
    expect(e.modules.map((m) => m.name)).toEqual(["EarlyBound", "LateBound", "Nightly"]);
    expect(e.vbscript).toHaveLength(3);
  });

  it.each(FIXTURE_NAMES.filter((n) => n !== "vbscript_deps"))("%s: no VBScript finding", (name) => {
    const e = exhume(`${name}.xlsm`, fixtureBytes(name));
    expect(e.vbscript).toEqual([]);
    expect(e.references).toEqual([]);
  });

  it("exhumeParts without references (as older callers use it) gives none and a code finding still shows", () => {
    const bytes = fixtureBytes("demo_invoice");
    const e = exhumeParts("x.xlsm", bytes, [
      { name: "Module1", type: "procedural", source: 'Sub A()\n    Shell "a.vbs"\nEnd Sub\n' },
    ]);
    expect(e.references).toEqual([]);
    expect(e.vbscript.map((f) => [f.kind, f.module, f.line])).toEqual([["external-vbs", "Module1", 2]]);
  });
});
