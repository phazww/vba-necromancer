import { describe, it, expect } from "vitest";
import fc from "fast-check";
import * as XLSX from "xlsx";
import { SheetJSSheet } from "../src/adapter.js";
import { MAX_COLS, MAX_ROWS, SheetRange, type RangeSheet } from "../src/range.js";
import type { RangeHandle, VBAValue, XlDirection } from "../src/types.js";

const DIRECTIONS: XlDirection[] = ["xlUp", "xlDown", "xlLeft", "xlRight"];

interface Stub extends RangeSheet {
  cells: Map<string, VBAValue>;
  reads: number;
}

function stub(
  cells: Array<[number, number]>,
  bounds: "none" | "exact" | { extraRows: number; extraCols: number },
): Stub {
  const map = new Map<string, VBAValue>(cells.map(([r, c]) => [`${r},${c}`, 1]));
  const s: Stub = {
    name: "S",
    index: 1,
    cells: map,
    reads: 0,
    getCellValue(r, c) {
      s.reads++;
      return map.get(`${r},${c}`) ?? null;
    },
    setCellValue(r, c, v) {
      if (v === null) map.delete(`${r},${c}`);
      else map.set(`${r},${c}`, v);
    },
    getCellFormula: () => null,
    usedRowCount: () => 0,
    usedColCount: () => 0,
    getRange(): RangeHandle {
      throw new Error("not used");
    },
  };
  if (bounds !== "none") {
    const extra = bounds === "exact" ? { extraRows: 0, extraCols: 0 } : bounds;
    s.lastRowBound = () =>
      Math.min(
        MAX_ROWS,
        Math.max(0, ...[...map.keys()].map((k) => Number(k.split(",")[0]))) + extra.extraRows,
      );
    s.lastColBound = () =>
      Math.min(
        MAX_COLS,
        Math.max(0, ...[...map.keys()].map((k) => Number(k.split(",")[1]))) + extra.extraCols,
      );
  }
  return s;
}

function endOf(sheet: RangeSheet, row: number, col: number, d: XlDirection): [number, number] {
  const e = new SheetRange(sheet, row, col, row, col).end(d) as SheetRange;
  return [e.topRow, e.leftCol];
}

/** Verbatim copy of the old walk, which only uses getCellValue. */
function referenceEnd(
  sheet: RangeSheet,
  row: number,
  col: number,
  direction: XlDirection,
): [number, number] {
  const dr = direction === "xlUp" ? -1 : direction === "xlDown" ? 1 : 0;
  const dc = direction === "xlLeft" ? -1 : direction === "xlRight" ? 1 : 0;
  let r = row;
  let c = col;
  const inside = (rr: number, cc: number): boolean =>
    rr >= 1 && rr <= MAX_ROWS && cc >= 1 && cc <= MAX_COLS;
  const filled = (rr: number, cc: number): boolean => sheet.getCellValue(rr, cc) !== null;
  if (inside(r + dr, c + dc)) {
    if (filled(r, c) && filled(r + dr, c + dc)) {
      while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) {
        r += dr;
        c += dc;
      }
    } else {
      r += dr;
      c += dc;
      while (inside(r, c) && !filled(r, c)) {
        if (!inside(r + dr, c + dc)) break;
        r += dr;
        c += dc;
      }
    }
  }
  return [r, c];
}

function sheetJs(cells: Array<[number, number]>, ref?: string): SheetJSSheet {
  const ws: XLSX.WorkSheet = {};
  for (const [r, c] of cells) ws[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })] = { t: "n", v: 1 };
  if (ref) ws["!ref"] = ref;
  return new SheetJSSheet("S", 1, ws);
}

describe("Range.End on small sheets (END-01)", () => {
  // Column A: rows 3..5 filled, row 8 filled. Row 3: columns A..C filled, E filled.
  const cells: Array<[number, number]> = [
    [3, 1],
    [4, 1],
    [5, 1],
    [8, 1],
    [3, 2],
    [3, 3],
    [3, 5],
  ];
  const sheet = sheetJs(cells);
  it("walks to the end of a filled block", () => {
    expect(endOf(sheet, 3, 1, "xlDown")).toEqual([5, 1]);
    expect(endOf(sheet, 5, 1, "xlUp")).toEqual([3, 1]);
    expect(endOf(sheet, 3, 1, "xlRight")).toEqual([3, 3]);
    expect(endOf(sheet, 3, 3, "xlLeft")).toEqual([3, 1]);
  });
  it("jumps over a gap to the next filled cell", () => {
    expect(endOf(sheet, 5, 1, "xlDown")).toEqual([8, 1]);
    expect(endOf(sheet, 8, 1, "xlUp")).toEqual([5, 1]);
    expect(endOf(sheet, 3, 3, "xlRight")).toEqual([3, 5]);
    expect(endOf(sheet, 3, 5, "xlLeft")).toEqual([3, 3]);
  });
  it("goes to the sheet edge over an empty column or row", () => {
    expect(endOf(sheet, 1, 7, "xlDown")).toEqual([MAX_ROWS, 7]);
    expect(endOf(sheet, 20, 7, "xlUp")).toEqual([1, 7]);
    expect(endOf(sheet, 9, 1, "xlRight")).toEqual([9, MAX_COLS]);
    expect(endOf(sheet, 9, 9, "xlLeft")).toEqual([9, 1]);
    expect(endOf(sheet, 8, 1, "xlDown")).toEqual([MAX_ROWS, 1]);
  });
  it("stays at the edge and starts in the last cell", () => {
    expect(endOf(sheet, 1, 1, "xlUp")).toEqual([1, 1]);
    expect(endOf(sheet, 1, 1, "xlLeft")).toEqual([1, 1]);
    expect(endOf(sheet, MAX_ROWS, 1, "xlDown")).toEqual([MAX_ROWS, 1]);
    expect(endOf(sheet, 1, MAX_COLS, "xlRight")).toEqual([1, MAX_COLS]);
  });
  it("handles an empty sheet", () => {
    const empty = sheetJs([]);
    expect(endOf(empty, MAX_ROWS, 1, "xlUp")).toEqual([1, 1]);
    expect(endOf(empty, 1, MAX_COLS, "xlLeft")).toEqual([1, 1]);
    expect(endOf(empty, 5, 5, "xlDown")).toEqual([MAX_ROWS, 5]);
    expect(endOf(empty, 5, 5, "xlRight")).toEqual([5, MAX_COLS]);
  });
  it("handles cells at row 1 048 576 and column 16 384", () => {
    const edge = sheetJs([
      [MAX_ROWS, 1],
      [1, MAX_COLS],
    ]);
    expect(endOf(edge, 1, 1, "xlDown")).toEqual([MAX_ROWS, 1]);
    expect(endOf(edge, MAX_ROWS, 1, "xlUp")).toEqual([1, 1]);
    expect(endOf(edge, 1, 1, "xlRight")).toEqual([1, MAX_COLS]);
    expect(endOf(edge, 1, MAX_COLS, "xlLeft")).toEqual([1, 1]);
    expect(endOf(sheetJs([[5, MAX_COLS]]), 5, MAX_COLS, "xlLeft")).toEqual([5, 1]);
  });
});

describe("Range.End with a stale dimension (END-01, END-02)", () => {
  it("finds a value in A4 although !ref says A1:A2", () => {
    const s = sheetJs(
      [
        [1, 1],
        [2, 1],
        [4, 1],
      ],
      "A1:A2",
    );
    expect(endOf(s, MAX_ROWS, 1, "xlUp")).toEqual([4, 1]);
  });
  it("finds a value written far outside the old !ref", () => {
    const s = sheetJs([[1, 1]], "A1:A1");
    expect(endOf(s, MAX_ROWS, 1, "xlUp")).toEqual([1, 1]); // computes and caches the bounds
    s.setCellValue(500, 1, 7);
    s.setCellValue(500, 30, 7);
    expect(endOf(s, MAX_ROWS, 1, "xlUp")).toEqual([500, 1]);
    expect(endOf(s, 500, MAX_COLS, "xlLeft")).toEqual([500, 30]);
  });
  it("is still right after a delete at the bound", () => {
    const s = sheetJs(
      [
        [1, 1],
        [40, 1],
        [90, 2],
      ],
      "A1:A1",
    );
    expect(endOf(s, MAX_ROWS, 1, "xlUp")).toEqual([40, 1]);
    s.setCellValue(90, 2, null);
    s.setCellValue(40, 1, null);
    expect(s.lastRowBound()).toBe(1);
    expect(s.lastColBound()).toBe(1);
    expect(endOf(s, MAX_ROWS, 1, "xlUp")).toEqual([1, 1]);
  });
  it("reads a hand-built xlsx with a stale dimension", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([[1], [2]]);
    ws["A4"] = { t: "n", v: 4 };
    XLSX.utils.book_append_sheet(wb, ws, "S");
    const s = new SheetJSSheet("S", 1, ws);
    expect(ws["!ref"]).toBe("A1:A2");
    expect(endOf(s, MAX_ROWS, 1, "xlUp")).toEqual([4, 1]);
  });
});

describe("Range.End read count", () => {
  it("End(xlUp) from the last row with data to row 40 reads fewer than 100 cells", () => {
    const cells: Array<[number, number]> = Array.from({ length: 40 }, (_, i) => [i + 1, 1]);
    const s = stub(cells, "exact");
    expect(endOf(s, MAX_ROWS, 1, "xlUp")).toEqual([40, 1]);
    expect(s.reads).toBeLessThan(100);
  });
});

describe("Range.End equals the old walk (END-01 property)", () => {
  const coord = fc.oneof(fc.integer({ min: 1, max: 12 }), fc.constantFrom(MAX_ROWS - 1, MAX_ROWS));
  const colCoord = fc.oneof(
    fc.integer({ min: 1, max: 12 }),
    fc.constantFrom(MAX_COLS - 1, MAX_COLS),
  );
  const cell = fc.tuple(coord, colCoord);
  const op = fc.tuple(fc.boolean(), cell);
  const bounds = fc.oneof(
    fc.constant<"exact">("exact"),
    fc.record({
      extraRows: fc.integer({ min: 0, max: 30 }),
      extraCols: fc.integer({ min: 0, max: 30 }),
    }),
  );

  it("on a map-backed stub, with exact and too-high bounds", () => {
    fc.assert(
      fc.property(
        fc.array(cell, { maxLength: 25 }),
        fc.array(op, { maxLength: 10 }),
        cell,
        fc.constantFrom(...DIRECTIONS),
        bounds,
        (initial, ops, start, d, b) => {
          const s = stub(initial, b);
          for (const [set, [r, c]] of ops) s.setCellValue(r, c, set ? 1 : null);
          const reference = stub(
            [...s.cells.keys()].map((k) => k.split(",").map(Number) as [number, number]),
            "none",
          );
          expect(endOf(s, start[0], start[1], d)).toEqual(
            referenceEnd(reference, start[0], start[1], d),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("on SheetJSSheet with a stale !ref", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 })), {
          maxLength: 15,
        }),
        fc.array(op, { maxLength: 6 }),
        fc.tuple(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 })),
        fc.constantFrom(...DIRECTIONS),
        fc.constantFrom("A1:A2", "A1:A1", undefined),
        (initial, ops, start, d, ref) => {
          const s = sheetJs(initial, ref);
          const ref2 = new Map<string, true>(initial.map(([r, c]) => [`${r},${c}`, true]));
          for (const [set, [r0, c0]] of ops) {
            const r = Math.min(r0, 8);
            const c = Math.min(c0, 8);
            s.setCellValue(r, c, set ? 1 : null);
            if (set) ref2.set(`${r},${c}`, true);
            else ref2.delete(`${r},${c}`);
          }
          const plain = stub(
            [...ref2.keys()].map((k) => k.split(",").map(Number) as [number, number]),
            "none",
          );
          expect(endOf(s, start[0], start[1], d)).toEqual(
            referenceEnd(plain, start[0], start[1], d),
          );
          // Also from the far corner, where the jump matters.
          expect(endOf(s, MAX_ROWS, start[1], "xlUp")).toEqual(
            referenceEnd(plain, MAX_ROWS, start[1], "xlUp"),
          );
        },
      ),
      { numRuns: 30 },
    );
  });
});
