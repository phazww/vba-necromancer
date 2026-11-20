import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { address, colLetters, formatValue, parseCellRef, qualified } from "../../src/model/format";
import { visibleRange } from "../../src/ui/useWindow";

describe("formatValue", () => {
  it("rounds to 15 significant digits", () => {
    expect(formatValue(0.1 + 0.2)).toBe("0.3");
    expect(formatValue(1286290)).toBe("1286290");
    expect(formatValue(484.65)).toBe("484.65");
    expect(formatValue(-0)).toBe("0");
  });
  it("documents the output outside the plain range", () => {
    expect(formatValue(1e21)).toBe("1E+21");
    expect(formatValue(1.5e-7)).toBe("1.5E-07");
    expect(formatValue(1e20)).toBe("100000000000000000000");
    expect(formatValue(0.000001)).toBe("0.000001");
  });
  it("shows booleans, strings and empty cells", () => {
    expect(formatValue(true)).toBe("TRUE");
    expect(formatValue(false)).toBe("FALSE");
    expect(formatValue(null)).toBe("");
    expect(formatValue("Журнал")).toBe("Журнал");
  });
  it("never throws and never returns exponent text for ordinary numbers", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, min: -1e12, max: 1e12 }), (n) => {
        const s = formatValue(n);
        if (Math.abs(n) >= 1e-6 || n === 0) expect(s).not.toMatch(/E/);
        expect(typeof s).toBe("string");
      }),
    );
  });
});

describe("addresses", () => {
  it("builds A1 references", () => {
    expect(address(1, 1)).toBe("A1");
    expect(address(1, 27)).toBe("AA1");
    expect(address(5000, 16384)).toBe("XFD5000");
    expect(colLetters(26)).toBe("Z");
  });
  it("quotes sheet names only when needed", () => {
    expect(qualified("Акты", 1, 1)).toBe("Акты!A1");
    expect(qualified("My Sheet", 7, 2)).toBe("'My Sheet'!B7");
    expect(qualified("O'Neil", 1, 1)).toBe("'O''Neil'!A1");
    expect(qualified("A1", 1, 1)).toBe("'A1'!A1");
  });
});

describe("visibleRange", () => {
  it("stays inside [0, count], contains the visible items and is bounded", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 100_000 }),
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 50_000 }),
        fc.integer({ min: 0, max: 10 }),
        (offset, viewport, size, count, overscan) => {
          const { start, end } = visibleRange(offset, viewport, size, count, overscan);
          expect(start).toBeGreaterThanOrEqual(0);
          expect(end).toBeLessThanOrEqual(count);
          expect(end).toBeGreaterThanOrEqual(start);
          expect(end - start).toBeLessThanOrEqual(Math.ceil(viewport / size) + 2 * overscan + 1);
          const top = Math.max(0, offset);
          for (const probe of [Math.floor(top / size), Math.ceil((top + viewport) / size) - 1]) {
            if (probe >= 0 && probe < count && viewport > 0) {
              expect(probe).toBeGreaterThanOrEqual(start);
              expect(probe).toBeLessThan(end);
            }
          }
        },
      ),
    );
  });
  it("renders row 101 for scrollTop 2400 at 24 px rows and a 480 px viewport", () => {
    const { start, end } = visibleRange(2400, 480, 24, 5000, 4);
    expect(start).toBeLessThanOrEqual(100);
    expect(end).toBeGreaterThan(100);
  });
});

describe("parseCellRef", () => {
  it("reads plain and absolute references", () => {
    expect(parseCellRef("A1")).toEqual({ row: 1, col: 1 });
    expect(parseCellRef("H2")).toEqual({ row: 2, col: 8 });
    expect(parseCellRef("AA10")).toEqual({ row: 10, col: 27 });
    expect(parseCellRef("$B$3")).toEqual({ row: 3, col: 2 });
    expect(parseCellRef("xfd1048576")).toEqual({ row: 1048576, col: 16384 });
  });
  it("gives null for anything else", () => {
    for (const bad of ["", "H", "2", "A0", "A1:B2", "XFE1", "A1048577", "Sheet1!A1", "A-1"]) {
      expect(parseCellRef(bad), bad).toBeNull();
    }
  });
  it("is the inverse of address", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1048576 }),
        fc.integer({ min: 1, max: 16384 }),
        (row, col) => {
          expect(parseCellRef(address(row, col))).toEqual({ row, col });
        },
      ),
    );
  });
});
