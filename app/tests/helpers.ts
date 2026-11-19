import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(__dirname, "../..");

export interface Pos {
  sheet: string;
  row: number;
  col: number;
}
export interface Hit {
  module: string;
  line: number;
  construct: string;
}
export interface ExpectedRun {
  macro: string;
  status: string;
  cells: Array<Pos & { value: number | string | boolean }>;
  empty?: Pos[];
  unsupported: Hit[];
  stoppedAt?: Hit;
}
export interface Expected {
  runs: ExpectedRun[];
  numericTolerance: number;
}
export interface CellsJson {
  sheets: Array<{ name: string; cells: Array<{ row: number; col: number; value: unknown }> }>;
}

export const FIXTURE_NAMES: string[] = readdirSync(join(ROOT, "fixtures/build"))
  .filter((f) => f.endsWith(".xlsm"))
  .map((f) => f.replace(/\.xlsm$/, ""))
  .sort();

export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(ROOT, "fixtures/build", `${name}.xlsm`)));
}

export function expectedFor(name: string): Expected {
  return JSON.parse(readFileSync(join(ROOT, "fixtures/expected", `${name}.json`), "utf8")) as Expected;
}

export function cellsFor(name: string): CellsJson {
  return JSON.parse(readFileSync(join(ROOT, "fixtures/src", name, "cells.json"), "utf8")) as CellsJson;
}

export function srcModuleNames(name: string): string[] {
  return readdirSync(join(ROOT, "fixtures/src", name))
    .filter((f) => f.endsWith(".bas"))
    .map((f) => f.replace(/\.bas$/, ""))
    .sort();
}

export function srcText(name: string, module: string): string {
  return readFileSync(join(ROOT, "fixtures/src", name, `${module}.bas`), "utf8");
}
