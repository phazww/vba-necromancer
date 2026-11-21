/** VBS-03: findings of the `vbscript_deps` fixture against the hand-written oracle. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { extractProject } from "@vba-necromancer/ovba";
import { scanVbscript, VBSCRIPT_TEXTS, type VbscriptFinding } from "../src/index.js";

const ROOT = join(import.meta.dirname, "../../..");

interface ExpectedFinding {
  kind: VbscriptFinding["kind"];
  module?: string;
  line?: number;
  reference?: { name: string; libid: string };
}

function scanFixture(name: string): VbscriptFinding[] {
  const bytes = new Uint8Array(readFileSync(join(ROOT, "fixtures/build", `${name}.xlsm`)));
  const p = extractProject(bytes);
  return scanVbscript(p.modules, p.references);
}

describe("VBS-03 vbscript_deps matches fixtures/expected/vbscript_deps.json", () => {
  const expected = JSON.parse(readFileSync(join(ROOT, "fixtures/expected/vbscript_deps.json"), "utf8")) as {
    findings: ExpectedFinding[];
  };

  it("exactly the expected findings, in order, and no other", () => {
    const got = scanFixture("vbscript_deps").map((f) => ({
      kind: f.kind,
      ...(f.module !== null ? { module: f.module, line: f.line } : {}),
      ...(f.reference ? { reference: f.reference } : {}),
    }));
    expect(got).toEqual(expected.findings);
  });

  it("each finding has the text of its kind", () => {
    for (const f of scanFixture("vbscript_deps")) expect(f.text).toBe(VBSCRIPT_TEXTS[f.kind]);
  });
});

describe("VBS-03 the other fixtures report no VBScript finding", () => {
  const names = readdirSync(join(ROOT, "fixtures/build"))
    .filter((f) => f.endsWith(".xlsm"))
    .map((f) => f.replace(/\.xlsm$/, ""))
    .filter((n) => n !== "vbscript_deps");
  it("there are nine of them", () => expect(names).toHaveLength(9));
  it.each(names)("%s", (name) => {
    expect(scanFixture(name)).toEqual([]);
  });
});
