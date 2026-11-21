import { describe, it, expect } from "vitest";
import type { TraceEvent } from "@vba-necromancer/vba";
import type { VBAValue } from "@vba-necromancer/workbook";
import { cellKey, deriveChanges } from "../../src/model/changes";
import { exhume } from "../../src/model/exhume";
import { resurrect } from "../../src/model/resurrect";
import { RUN_FIXTURE_NAMES, expectedFor, fixtureBytes } from "../helpers";

function same(actual: VBAValue, expected: VBAValue, tol: number): boolean {
  if (typeof expected === "number" && typeof actual === "number") return Math.abs(actual - expected) <= tol;
  return actual === expected;
}

describe.each(RUN_FIXTURE_NAMES)("resurrect on %s matches its oracle", (name) => {
  const expected = expectedFor(name);
  for (const run of expected.runs) {
    it(`${run.macro}: status, cells, changes`, () => {
      const exhumed = exhume(`${name}.xlsm`, fixtureBytes(name));
      const macro = exhumed.macros.find((m) => m.name === run.macro);
      if (!macro) throw new Error(`${run.macro} is not listed`);
      const view = resurrect(exhumed, macro.id);
      expect(view.result.status).toBe(run.status);
      for (const c of run.cells) {
        const actual = view.workbook.getSheet(c.sheet).getCellValue(c.row, c.col);
        expect(same(actual, c.value, expected.numericTolerance), `${c.sheet} R${c.row}C${c.col}`).toBe(true);
        const before = exhumed.initial.getSheet(c.sheet).getCellValue(c.row, c.col);
        if (!same(before, c.value, expected.numericTolerance)) {
          expect(view.changes.bySheet.get(c.sheet)?.has(cellKey(c.row, c.col)), `${c.sheet} R${c.row}C${c.col} changed`).toBe(true);
        }
      }
    });
  }
});

describe("resurrect", () => {
  it("demo_acts.BuildActs changes exactly the 22 oracle cells of Акты and none of Журнал", () => {
    const exhumed = exhume("demo_acts.xlsm", fixtureBytes("demo_acts"));
    const view = resurrect(exhumed, "Module1.BuildActs");
    const oracle = expectedFor("demo_acts").runs[0].cells;
    expect(oracle.length).toBe(22);
    const changed = view.changes.bySheet.get("Акты");
    expect(changed?.size).toBe(22);
    for (const c of oracle) expect(changed?.has(cellKey(c.row, c.col))).toBe(true);
    expect(view.changes.bySheet.has("Журнал")).toBe(false);
    expect(view.changes.firstChangedSheet).toBe("Акты");
    expect(view.counts.changed).toBe(22);
    expect(view.counts.writes).toBeGreaterThanOrEqual(22);
    expect(view.counts.reads).toBeGreaterThan(0);
    expect(view.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("graveyard.ExportReport: skipped only when the run lists the same module, line and construct", () => {
    const exhumed = exhume("graveyard.xlsm", fixtureBytes("graveyard"));
    const view = resurrect(exhumed, "Module1.ExportReport");
    expect(view.graveyard).toHaveLength(6);
    for (const e of view.graveyard) {
      const listed = view.result.unsupported.some(
        (u) => u.module === e.module && u.line === e.line && u.construct === e.construct,
      );
      expect(e.mark, `line ${e.line}`).toBe(listed ? "skipped" : "not-reached");
    }
    const byLine = (line: number) => view.graveyard.find((e) => e.line === line)?.mark;
    expect(byLine(3)).toBe("not-reached");
    expect(byLine(22)).toBe("not-reached");
    expect(byLine(11)).toBe("skipped");
  });

  it("graveyard.ExportStrict: line 22 is stopped and equals stoppedAt, the rest are not reached", () => {
    const exhumed = exhume("graveyard.xlsm", fixtureBytes("graveyard"));
    const view = resurrect(exhumed, "Module1.ExportStrict");
    const stopped = view.graveyard.filter((e) => e.mark === "stopped");
    expect(stopped).toHaveLength(1);
    expect(stopped[0].line).toBe(22);
    expect(stopped[0]).toMatchObject(view.result.stoppedAt ?? {});
    expect(view.graveyard.filter((e) => e.mark === "not-reached")).toHaveLength(5);
  });

  it("gives equal results on two runs and leaves exhumed.initial unchanged", () => {
    const exhumed = exhume("demo_acts.xlsm", fixtureBytes("demo_acts"));
    const before = exhumed.initial.getSheet("Акты").getCellValue(1, 1);
    const a = resurrect(exhumed, "Module1.BuildActs");
    const b = resurrect(exhumed, "Module1.BuildActs");
    expect(a.workbook).not.toBe(b.workbook);
    expect(a.result.trace).toEqual(b.result.trace);
    expect(a.result.status).toBe(b.result.status);
    expect(exhumed.initial.getSheet("Акты").getCellValue(1, 1)).toBe(before);
    expect(before).toBeNull();
  });

  it("keeps the RunResult untouched: the view status is the result's own field", () => {
    const exhumed = exhume("graveyard.xlsm", fixtureBytes("graveyard"));
    const view = resurrect(exhumed, "Module1.ExportStrict");
    expect(view.result.status).toBe("partly resurrected");
    expect(view.result.stoppedAt).toEqual({ module: "Module1", line: 22, construct: "Open" });
  });

  it("refuses an unknown macro id", () => {
    const exhumed = exhume("demo_acts.xlsm", fixtureBytes("demo_acts"));
    expect(() => resurrect(exhumed, "Module1.Nope")).toThrow(/Module1\.Nope/);
  });
});

describe("deriveChanges", () => {
  const at = { module: "M", line: 1 };
  const write = (row: number, before: VBAValue, after: VBAValue, sheet = "S"): TraceEvent => ({
    kind: "write",
    sheet,
    row,
    col: 1,
    before,
    after,
    statement: at,
  });

  it("writing the original value back is not a change", () => {
    const c = deriveChanges([write(1, "a", "b"), write(1, "b", "a")]);
    expect(c.count).toBe(0);
    expect(c.firstChangedSheet).toBeNull();
  });

  it("clearing a cell is a change and remembers the first before", () => {
    const c = deriveChanges([write(1, 5, 6), write(1, 6, null)]);
    expect(c.bySheet.get("S")?.get(cellKey(1, 1))).toEqual({ before: 5 });
    expect(c.count).toBe(1);
  });

  it("treats NaN as equal to itself and ignores reads", () => {
    const c = deriveChanges([
      write(1, NaN, NaN),
      { kind: "read", sheet: "S", row: 2, col: 1, value: 1, statement: at },
    ]);
    expect(c.count).toBe(0);
  });

  it("firstChangedSheet is the first sheet with a change", () => {
    const c = deriveChanges([write(1, 1, 1, "A"), write(1, 1, 2, "B"), write(1, 1, 2, "C")]);
    expect(c.firstChangedSheet).toBe("B");
  });
});
