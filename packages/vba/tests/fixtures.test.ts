/**
 * Runs fixtures/src/<name> through tokenize + parse + run against the in-memory workbook and
 * compares every cell with the hand-written oracle in fixtures/expected/<name>.json.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { runMacro } from "../src/run.js";
import { MemoryWorkbook } from "../src/memory-workbook.js";
import type { VBAValue } from "../src/host.js";

const ROOT = resolve(__dirname, "../../..");

interface CellsJson {
  sheets: Array<{ name: string; cells: Array<{ row: number; col: number; value: VBAValue }> }>;
}

interface Expected {
  runs: Array<{
    macro: string;
    status: string;
    cells: Array<{ sheet: string; row: number; col: number; value: number | string | boolean }>;
    empty?: Array<{ sheet: string; row: number; col: number }>;
  }>;
  numericTolerance: number;
}

function loadFixture(name: string) {
  const dir = join(ROOT, "fixtures/src", name);
  const cells = JSON.parse(readFileSync(join(dir, "cells.json"), "utf8")) as CellsJson;
  const modules = readdirSync(dir)
    .filter((f) => f.endsWith(".bas"))
    .sort()
    .map((f) => parse(tokenize(readFileSync(join(dir, f), "utf8")), f.replace(/\.bas$/, "")));
  const expected = JSON.parse(
    readFileSync(join(ROOT, "fixtures/expected", `${name}.json`), "utf8"),
  ) as Expected;
  return { cells, modules, expected };
}

describe.each(["numeric_semantics", "strings", "labour_statement"])("fixture %s", (name) => {
  if (!existsSync(join(ROOT, "fixtures/src", name))) return;
  const { cells, modules, expected } = loadFixture(name);
  const workbook = new MemoryWorkbook(cells.sheets);

  for (const run of expected.runs) {
    it(`${run.macro}: status and every expected cell`, () => {
      const result = runMacro(run.macro, modules, workbook);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(run.status);

      for (const c of run.cells) {
        const actual = workbook.cell(c.sheet, c.row, c.col);
        const where = `${c.sheet}!R${c.row}C${c.col}`;
        if (typeof c.value === "number") {
          expect(typeof actual, where).toBe("number");
          expect(Math.abs((actual as number) - c.value), where).toBeLessThanOrEqual(expected.numericTolerance);
        } else {
          expect(actual, where).toBe(c.value);
        }
      }
      for (const c of run.empty ?? []) {
        expect(workbook.cell(c.sheet, c.row, c.col), `${c.sheet}!R${c.row}C${c.col}`).toBeNull();
      }
    });
  }
});
