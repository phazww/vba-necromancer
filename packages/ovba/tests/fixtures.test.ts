/**
 * Integration tests: verify that the fixture .xlsm files built by
 * `fixtures/build/build.ts` round-trip correctly through extractModules().
 *
 * For every fixtures/src/<name>/ that has a Module1.bas, the test asserts that
 * extractModules(readFileSync("fixtures/build/<name>.xlsm")) returns a module
 * named "Module1" whose source equals the content of fixtures/src/<name>/Module1.bas
 * after line-ending normalisation (CRLF → LF).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extractModules } from "../src/index.js";

// Repo root is three levels up from packages/ovba/tests/
const REPO_ROOT = join(import.meta.dirname, "../../..");
const SRC_ROOT = join(REPO_ROOT, "fixtures", "src");
const BUILD_ROOT = join(REPO_ROOT, "fixtures", "build");

/** Normalise line endings to LF. */
function normLF(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** List all fixture names (directories under fixtures/src/). */
function fixtureNames(): string[] {
  return readdirSync(SRC_ROOT)
    .filter((name) => statSync(join(SRC_ROOT, name)).isDirectory())
    .sort();
}

describe("fixture round-trip: extractModules matches Module1.bas", () => {
  const fixtures = fixtureNames();

  for (const name of fixtures) {
    const basPath = join(SRC_ROOT, name, "Module1.bas");
    const xlsmPath = join(BUILD_ROOT, `${name}.xlsm`);

    if (!existsSync(basPath)) {
      // Fixture has no Module1.bas — skip (shouldn't happen for current fixtures)
      continue;
    }

    it(`${name}: Module1.source matches Module1.bas`, () => {
      expect(existsSync(xlsmPath), `${name}.xlsm not found — run npm run fixtures:build`).toBe(true);

      const xlsmBytes = new Uint8Array(readFileSync(xlsmPath));
      const modules = extractModules(xlsmBytes);

      const module1 = modules.find((m) => m.name === "Module1");
      expect(module1, `Module1 not found in extracted modules for "${name}"`).toBeDefined();

      const expectedSource = normLF(readFileSync(basPath, "utf-8"));
      const actualSource = normLF(module1!.source);

      expect(actualSource).toBe(expectedSource);
    });

    it(`${name}: module type is procedural`, () => {
      expect(existsSync(xlsmPath)).toBe(true);
      const xlsmBytes = new Uint8Array(readFileSync(xlsmPath));
      const modules = extractModules(xlsmBytes);
      const module1 = modules.find((m) => m.name === "Module1");
      expect(module1?.type).toBe("procedural");
    });
  }
});
