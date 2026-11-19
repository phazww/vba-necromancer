/**
 * DTASK-07: dictionary_grouping against the hand-written oracle (see e2e.test.ts for the cell
 * checks), and against acts_by_category, which does the same job with arrays.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { extractModules } from "@vba-necromancer/ovba";
import { openWorkbook } from "@vba-necromancer/workbook";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { runMacro } from "../src/run.js";

const ROOT = resolve(__dirname, "../../..");

function open(name: string) {
  const bytes = new Uint8Array(readFileSync(join(ROOT, "fixtures/build", `${name}.xlsm`)));
  return {
    modules: extractModules(bytes).map((m) => parse(tokenize(m.source), m.name)),
    workbook: openWorkbook(bytes),
  };
}

describe("dictionary_grouping", () => {
  const dict = open("dictionary_grouping");
  const arrays = open("acts_by_category");
  const dictRun = runMacro("BuildActsDict", dict.modules, dict.workbook);
  const arraysRun = runMacro("BuildActs", arrays.modules, arrays.workbook);

  it("BuildActsDict is fully resurrected with nothing unsupported", () => {
    expect(dictRun.status).toBe("fully resurrected");
    expect(dictRun.error).toBeUndefined();
    expect(dictRun.stoppedAt).toBeUndefined();
    expect(dictRun.staticUnsupported).toEqual([]);
    expect(dictRun.unsupported).toEqual([]);
  });

  it("produces the same Акты sheet as acts_by_category, cell by cell", () => {
    expect(arraysRun.status).toBe("fully resurrected");
    const a = dict.workbook.getSheet("Акты");
    const b = arrays.workbook.getSheet("Акты");
    expect(a.usedRowCount()).toBe(b.usedRowCount());
    expect(a.usedColCount()).toBe(b.usedColCount());
    expect(a.usedRowCount()).toBeGreaterThan(2);
    for (let r = 1; r <= b.usedRowCount(); r++) {
      for (let c = 1; c <= b.usedColCount(); c++) {
        expect(a.getCellValue(r, c), `Акты!R${r}C${c}`).toEqual(b.getCellValue(r, c));
      }
    }
  });

  it("the trace lists reads of Журнал and writes to Акты only", () => {
    const reads = dictRun.trace.filter((e) => e.kind === "read");
    const writes = dictRun.trace.filter((e) => e.kind === "write");
    expect(reads.length).toBeGreaterThan(0);
    expect(writes.length).toBeGreaterThan(0);
    expect(new Set(reads.map((e) => e.sheet))).toEqual(new Set(["Журнал"]));
    expect(new Set(writes.map((e) => e.sheet))).toEqual(new Set(["Акты"]));
    expect(dictRun.trace.every((e) => e.kind === "read" || e.kind === "write")).toBe(true);
  });
});
