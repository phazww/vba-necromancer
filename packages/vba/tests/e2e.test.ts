/**
 * End to end: every fixtures/build/<name>.xlsm is opened the way the app opens it
 * (extractModules for the VBA, the SheetJS adapter for the cells), and each macro listed in
 * fixtures/expected/<name>.json runs in order on the same workbook. The expected files are
 * hand-written oracles and are only read here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { extractModules } from "@vba-necromancer/ovba";
import { openWorkbook } from "@vba-necromancer/workbook";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { runMacro } from "../src/run.js";

const ROOT = resolve(__dirname, "../../..");

interface Pos {
  sheet: string;
  row: number;
  col: number;
}
interface Hit {
  module: string;
  line: number;
  construct: string;
}
interface Expected {
  runs: Array<{
    macro: string;
    status: string;
    cells: Array<Pos & { value: number | string | boolean }>;
    empty?: Pos[];
    unsupported: Hit[];
    stoppedAt?: Hit;
  }>;
  numericTolerance: number;
}

const names = readdirSync(join(ROOT, "fixtures/expected"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  // vbscript_deps has static findings instead of runs; it is checked in vbscript-fixture.test.ts
  .filter((n) => Array.isArray((JSON.parse(readFileSync(join(ROOT, "fixtures/expected", `${n}.json`), "utf8")) as { runs?: unknown }).runs))
  .sort();

describe.each(names)("end to end: %s", (name) => {
  const expected = JSON.parse(readFileSync(join(ROOT, "fixtures/expected", `${name}.json`), "utf8")) as Expected;
  const bytes = new Uint8Array(readFileSync(join(ROOT, "fixtures/build", `${name}.xlsm`)));
  const modules = extractModules(bytes).map((m) => parse(tokenize(m.source), m.name));
  const workbook = openWorkbook(bytes);

  for (const run of expected.runs) {
    it(`${run.macro}: status, cells, static unsupported list, stoppedAt`, () => {
      const result = runMacro(run.macro, modules, workbook);

      expect(result.status).toBe(run.status);
      if (run.stoppedAt) {
        expect(result.stoppedAt).toEqual(run.stoppedAt);
      } else {
        expect(result.stoppedAt).toBeUndefined();
        expect(result.error).toBeUndefined();
      }
      expect(result.staticUnsupported).toEqual(run.unsupported);

      for (const c of run.cells) {
        const actual = workbook.getSheet(c.sheet).getCellValue(c.row, c.col);
        const where = `${c.sheet}!R${c.row}C${c.col}`;
        if (typeof c.value === "number") {
          expect(typeof actual, where).toBe("number");
          expect(Math.abs((actual as number) - c.value), where).toBeLessThanOrEqual(expected.numericTolerance);
        } else {
          expect(actual, where).toBe(c.value);
        }
      }
      for (const c of run.empty ?? []) {
        expect(workbook.getSheet(c.sheet).getCellValue(c.row, c.col), `${c.sheet}!R${c.row}C${c.col}`).toBeNull();
      }
    });
  }

  it("the workbook saved after all runs is a readable .xlsx with the last run's cells", () => {
    const saved = openWorkbook(workbook.save());
    const last = expected.runs[expected.runs.length - 1];
    for (const c of last.cells.slice(0, 5)) {
      expect(saved.getSheet(c.sheet).getCellValue(c.row, c.col)).toEqual(workbook.getSheet(c.sheet).getCellValue(c.row, c.col));
    }
  });
});
