import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { formatNumber } from "@vba-necromancer/workbook";
import { formatValue } from "../../src/model/format";

describe("formatNumber properties (FMT-02, FMT-03)", () => {
  // formatValue throws for |n| above about 1.797e308 (toPrecision(15) rounds to Infinity): see tasks.md, NTASK-01 notes.
  it("FMT-02 General equals formatValue on random finite numbers", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e300, max: 1e300 }),
        (n) => {
          expect(formatNumber(n, "General")).toBe(formatValue(n));
          expect(formatNumber(n, "")).toBe(formatValue(n));
        },
      ),
      { numRuns: 500 },
    );
  });

  it("FMT-02 never throws on arbitrary formats and numbers, including NaN and infinities", () => {
    fc.assert(
      fc.property(
        fc.double(),
        fc.oneof(fc.string(), fc.stringOf(fc.constantFrom(...'0#,.%;"\\ymdhs:-/()[]$€₽_*@E+'))),
        (n, f) => {
          expect(typeof formatNumber(n, f)).toBe("string");
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("FMT-03 0.00 gives exactly two decimals, within 0.005 of the input", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 1e9, noNaN: true }), (n) => {
        const text = formatNumber(n, "0.00");
        expect(text).toMatch(/^-?\d+\.\d\d$/);
        expect(Math.abs(Number(text) - n)).toBeLessThanOrEqual(0.005 + 1e-6);
      }),
      { numRuns: 500 },
    );
  });
});

describe("formatNumber dates (FMT-02)", () => {
  it("FMT-02 yyyy-mm-dd matches Date arithmetic for random serials from 61 to 2958465", () => {
    fc.assert(
      fc.property(fc.integer({ min: 61, max: 2958465 }), (serial) => {
        const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
        const iso = `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        expect(formatNumber(serial, "yyyy-mm-dd")).toBe(iso);
      }),
      { numRuns: 300 },
    );
  });
});
