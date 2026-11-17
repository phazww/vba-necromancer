import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  roundHalfEven,
  roundHalfEvenTo,
  toInteger,
  toLong,
  intDiv,
  vbaMod,
  dateSerial,
  excelSerialToVbaDate,
  vbaDateToExcelSerial,
} from "../src/coerce.js";
import { RuntimeError } from "../src/errors.js";

// ---------------------------------------------------------------------------
// roundHalfEven — banker's rounding to integer
// ---------------------------------------------------------------------------
describe("roundHalfEven", () => {
  it("rounds 0.5 down to 0 (even)", () => {
    expect(roundHalfEven(0.5)).toBe(0);
  });

  it("rounds 1.5 up to 2 (even)", () => {
    expect(roundHalfEven(1.5)).toBe(2);
  });

  it("rounds 2.5 down to 2 (even)", () => {
    // CInt(2.5) = 2 in VBA
    expect(roundHalfEven(2.5)).toBe(2);
  });

  it("rounds 3.5 up to 4 (even)", () => {
    // CInt(3.5) = 4 in VBA
    expect(roundHalfEven(3.5)).toBe(4);
  });

  it("rounds -2.5 to -2 (even, toward zero)", () => {
    // CLng(-2.5) = -2 in VBA
    expect(roundHalfEven(-2.5)).toBe(-2);
  });

  it("rounds -1.5 to -2 (even, away from zero)", () => {
    expect(roundHalfEven(-1.5)).toBe(-2);
  });

  it("rounds non-half values with ordinary rounding", () => {
    expect(roundHalfEven(2.4)).toBe(2);
    expect(roundHalfEven(2.6)).toBe(3);
    expect(roundHalfEven(-2.4)).toBe(-2);
    expect(roundHalfEven(-2.6)).toBe(-3);
  });
});

// ---------------------------------------------------------------------------
// roundHalfEvenTo — banker's rounding to n decimal places
// Uses exact BigInt arithmetic over the IEEE 754 bit pattern of x, so the
// result matches VBA's Round() for every representable double.
// ---------------------------------------------------------------------------
describe("roundHalfEvenTo", () => {
  it("Round(2.5, 0) = 2 — ties round to even", () => {
    expect(roundHalfEvenTo(2.5, 0)).toBe(2);
  });

  it("Round(-2.5, 0) = -2 — ties round to even (symmetric)", () => {
    expect(roundHalfEvenTo(-2.5, 0)).toBe(-2);
  });

  it("Round(3.5, 0) = 4 — ties round to even", () => {
    expect(roundHalfEvenTo(3.5, 0)).toBe(4);
  });

  it("Round(0.125, 2) = 0.12 — exact tie, even floor wins", () => {
    // 0.125 is stored exactly as 2^-3; 0.125 * 100 = 12.5 exactly.
    // Floor = 12 (even) → banker's rounding keeps 12 → 0.12.
    // VBA: Round(0.125, 2) = 0.12.
    expect(roundHalfEvenTo(0.125, 2)).toBe(0.12);
  });

  it("Round(0.375, 2) = 0.38 — exact tie, odd floor rounds up", () => {
    // 0.375 is stored exactly as 3 * 2^-3; 0.375 * 100 = 37.5 exactly.
    // Floor = 37 (odd) → banker's rounding rounds up to 38 → 0.38.
    // VBA: Round(0.375, 2) = 0.38.
    expect(roundHalfEvenTo(0.375, 2)).toBe(0.38);
  });

  it("Round(2.675, 2) = 2.67 — stored below half-way", () => {
    // 2.675 is stored as 2.6749999…; exact * 100 is below 267.5.
    // Rounds down to 267 → 2.67.  VBA: Round(2.675, 2) = 2.67.
    expect(roundHalfEvenTo(2.675, 2)).toBe(2.67);
  });

  it("Round(32.675, 2) = 32.67 — stored below half-way (larger magnitude)", () => {
    // 32.675 is stored as 32.6749999…; exact * 100 is below 3267.5.
    // VBA: Round(32.675, 2) = 32.67.
    expect(roundHalfEvenTo(32.675, 2)).toBe(32.67);
  });

  it("Round(1.005, 2) = 1 — stored below half-way", () => {
    // 1.005 is stored slightly below 1.005; exact * 100 < 100.5.
    // VBA: Round(1.005, 2) = 1.
    expect(roundHalfEvenTo(1.005, 2)).toBe(1);
  });

  it("Round(1.235, 2) = 1.24 — stored above half-way, rounds up", () => {
    // 1.235 is stored as 1.2350000…001; exact * 100 > 123.5 → rounds up.
    expect(roundHalfEvenTo(1.235, 2)).toBe(1.24);
  });

  it("Round(1.245, 2) = 1.25 — stored above half-way, rounds up", () => {
    // 1.245 is stored as 1.2450000…001; exact * 100 > 124.5 → rounds up.
    // VBA: Round(1.245, 2) = 1.25.
    expect(roundHalfEvenTo(1.245, 2)).toBe(1.25);
  });
});

// ---------------------------------------------------------------------------
// toInteger — 16-bit signed with banker's rounding and overflow check
// ---------------------------------------------------------------------------
describe("toInteger", () => {
  it("toInteger(2.5) = 2 — CInt(2.5) in VBA", () => {
    expect(toInteger(2.5)).toBe(2);
  });

  it("toInteger(3.5) = 4 — CInt(3.5) in VBA", () => {
    expect(toInteger(3.5)).toBe(4);
  });

  it("toInteger(32767) = 32767 — upper bound", () => {
    expect(toInteger(32767)).toBe(32767);
  });

  it("toInteger(32768) throws RuntimeError(6) — overflow", () => {
    expect(() => toInteger(32768)).toThrowError(RuntimeError);
    try {
      toInteger(32768);
    } catch (e) {
      expect((e as RuntimeError).code).toBe(6);
    }
  });

  it("toInteger(-32768) = -32768 — lower bound", () => {
    expect(toInteger(-32768)).toBe(-32768);
  });

  it("toInteger(-32769) throws RuntimeError(6) — overflow", () => {
    expect(() => toInteger(-32769)).toThrowError(RuntimeError);
    try {
      toInteger(-32769);
    } catch (e) {
      expect((e as RuntimeError).code).toBe(6);
    }
  });

  // Property: any integer in [−32768, 32767] must succeed.
  it("property: in-range integers never throw", () => {
    fc.assert(
      fc.property(fc.integer({ min: -32768, max: 32767 }), (n) => {
        expect(() => toInteger(n)).not.toThrow();
        return true;
      }),
      { numRuns: 10_000 },
    );
  });

  // Property: integers outside [−32768, 32767] always throw RuntimeError(6).
  it("property: out-of-range integers always throw RuntimeError(6)", () => {
    fc.assert(
      fc.property(
        fc
          .integer()
          .filter((n) => n < -32768 || n > 32767)
          .map((n) => n),
        (n) => {
          let caught: unknown;
          try {
            toInteger(n);
          } catch (e) {
            caught = e;
          }
          if (!(caught instanceof RuntimeError)) return false;
          return caught.code === 6;
        },
      ),
      { numRuns: 10_000 },
    );
  });
});

// ---------------------------------------------------------------------------
// toLong — 32-bit signed with banker's rounding and overflow check
// ---------------------------------------------------------------------------
describe("toLong", () => {
  it("toLong(-2.5) = -2 — CLng(-2.5) in VBA", () => {
    expect(toLong(-2.5)).toBe(-2);
  });

  it("toLong(32768) = 32768 — fits in Long, not Integer", () => {
    // This is the 'big + 1' case from the fixture: Long arithmetic gives 32768
    expect(toLong(32768)).toBe(32768);
  });

  it("toLong(2147483647) = 2147483647 — upper bound", () => {
    expect(toLong(2147483647)).toBe(2147483647);
  });

  it("toLong(2147483648) throws RuntimeError(6)", () => {
    expect(() => toLong(2147483648)).toThrowError(RuntimeError);
    try {
      toLong(2147483648);
    } catch (e) {
      expect((e as RuntimeError).code).toBe(6);
    }
  });

  it("toLong(-2147483648) = -2147483648 — lower bound", () => {
    expect(toLong(-2147483648)).toBe(-2147483648);
  });

  it("toLong(-2147483649) throws RuntimeError(6)", () => {
    expect(() => toLong(-2147483649)).toThrowError(RuntimeError);
  });
});

// ---------------------------------------------------------------------------
// intDiv — VBA integer division (\)
// Operands are rounded with roundHalfEven first; result is truncated.
// ---------------------------------------------------------------------------
describe("intDiv", () => {
  it("7 \\ 2 = 3", () => {
    expect(intDiv(7, 2)).toBe(3);
  });

  it("7.5 \\ 2 = 4 — 7.5 rounds to 8, then 8 \\ 2 = 4", () => {
    expect(intDiv(7.5, 2)).toBe(4);
  });

  it("-7 \\ 2 = -3 — truncates toward zero", () => {
    expect(intDiv(-7, 2)).toBe(-3);
  });

  it("division by zero throws RuntimeError(11)", () => {
    expect(() => intDiv(7, 0)).toThrowError(RuntimeError);
    try {
      intDiv(7, 0);
    } catch (e) {
      expect((e as RuntimeError).code).toBe(11);
    }
  });
});

// ---------------------------------------------------------------------------
// vbaMod — VBA Mod operator
// Operands are rounded with roundHalfEven first; sign follows dividend.
// ---------------------------------------------------------------------------
describe("vbaMod", () => {
  it("7 Mod 2 = 1", () => {
    expect(vbaMod(7, 2)).toBe(1);
  });

  it("5.5 Mod 2 = 0 — 5.5 rounds to 6, then 6 Mod 2 = 0", () => {
    expect(vbaMod(5.5, 2)).toBe(0);
  });

  it("-7 Mod 3 = -1 — sign follows dividend", () => {
    expect(vbaMod(-7, 3)).toBe(-1);
  });

  it("mod by zero throws RuntimeError(11)", () => {
    expect(() => vbaMod(5, 0)).toThrowError(RuntimeError);
    try {
      vbaMod(5, 0);
    } catch (e) {
      expect((e as RuntimeError).code).toBe(11);
    }
  });
});

// ---------------------------------------------------------------------------
// dateSerial — VBA Date double (days from 1899-12-30, no fake Feb 29 1900)
// ---------------------------------------------------------------------------
describe("dateSerial", () => {
  it("dateSerial(1900, 1, 1) = 2 — VBA CDbl(DateSerial(1900,1,1))", () => {
    // VBA epoch is 1899-12-30; Jan 1 1900 is 2 days later.
    expect(dateSerial(1900, 1, 1)).toBe(2);
  });

  it("dateSerial(1900, 2, 28) = 60 — last real day before March 1900", () => {
    expect(dateSerial(1900, 2, 28)).toBe(60);
  });

  it("dateSerial(1900, 3, 1) = 61 — first day after the Excel fake-leap gap", () => {
    // Excel serial 61 = VBA double 61; they agree from here on.
    expect(dateSerial(1900, 3, 1)).toBe(61);
  });

  it("dateSerial(2026, 10, 31) = 46326 — matches Excel serial (post-1900)", () => {
    expect(dateSerial(2026, 10, 31)).toBe(46326);
  });

  it("dateSerial(2000, 1, 1) = 36526", () => {
    expect(dateSerial(2000, 1, 1)).toBe(36526);
  });

  it("dateSerial(1899, 12, 30) = 0 — VBA epoch day", () => {
    expect(dateSerial(1899, 12, 30)).toBe(0);
  });

  it("dateSerial(1899, 12, 31) = 1", () => {
    expect(dateSerial(1899, 12, 31)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// excelSerialToVbaDate / vbaDateToExcelSerial — bridging helpers
// ---------------------------------------------------------------------------
describe("excelSerialToVbaDate", () => {
  it("serial 1 (Excel 1900-01-01) → VBA double 2", () => {
    expect(excelSerialToVbaDate(1)).toBe(2);
  });

  it("serial 59 (Excel 1900-02-28) → VBA double 60", () => {
    expect(excelSerialToVbaDate(59)).toBe(60);
  });

  it("serial 60 (Excel fictitious Feb 29 1900) → NaN", () => {
    expect(excelSerialToVbaDate(60)).toBeNaN();
  });

  it("serial 61 (Excel 1900-03-01) → VBA double 61 (same)", () => {
    expect(excelSerialToVbaDate(61)).toBe(61);
  });

  it("serial 46326 (2026-10-31) → VBA double 46326 (same)", () => {
    expect(excelSerialToVbaDate(46326)).toBe(46326);
  });
});

describe("vbaDateToExcelSerial", () => {
  it("VBA double 2 (1900-01-01) → Excel serial 1", () => {
    expect(vbaDateToExcelSerial(2)).toBe(1);
  });

  it("VBA double 60 (1900-02-28) → Excel serial 59", () => {
    expect(vbaDateToExcelSerial(60)).toBe(59);
  });

  it("VBA double 61 (1900-03-01) → Excel serial 61 (same)", () => {
    expect(vbaDateToExcelSerial(61)).toBe(61);
  });

  it("VBA double 46326 (2026-10-31) → Excel serial 46326 (same)", () => {
    expect(vbaDateToExcelSerial(46326)).toBe(46326);
  });

  it("VBA double 0 (1899-12-30) → unchanged (no Excel equivalent)", () => {
    expect(vbaDateToExcelSerial(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fixture-driven checks from fixtures/expected/numeric_semantics.json
// These match the cells written by the NumericChecks macro exactly.
// ---------------------------------------------------------------------------
describe("numeric_semantics fixture values", () => {
  // Row 2: CInt(2.5) = 2
  it("CInt(2.5) = 2", () => expect(toInteger(2.5)).toBe(2));
  // Row 3: CInt(3.5) = 4
  it("CInt(3.5) = 4", () => expect(toInteger(3.5)).toBe(4));
  // Row 4: CLng(-2.5) = -2
  it("CLng(-2.5) = -2", () => expect(toLong(-2.5)).toBe(-2));
  // Row 5: 7 \ 2 = 3
  it("7 \\ 2 = 3", () => expect(intDiv(7, 2)).toBe(3));
  // Row 6: 7.5 \ 2 = 4
  it("7.5 \\ 2 = 4", () => expect(intDiv(7.5, 2)).toBe(4));
  // Row 7: -7 \ 2 = -3
  it("-7 \\ 2 = -3", () => expect(intDiv(-7, 2)).toBe(-3));
  // Row 8: 5.5 Mod 2 = 0
  it("5.5 Mod 2 = 0", () => expect(vbaMod(5.5, 2)).toBe(0));
  // Row 9: -7 Mod 3 = -1
  it("-7 Mod 3 = -1", () => expect(vbaMod(-7, 3)).toBe(-1));
  // Row 10: Round(2.5) = 2
  it("Round(2.5) = 2", () => expect(roundHalfEven(2.5)).toBe(2));
  // Row 11: Round(3.5) = 4
  it("Round(3.5) = 4", () => expect(roundHalfEven(3.5)).toBe(4));
  // Row 12: Int(-2.5) = -3  (Math.floor)
  it("Int(-2.5) = -3", () => expect(Math.floor(-2.5)).toBe(-3));
  // Row 13: Fix(-2.5) = -2  (Math.trunc)
  it("Fix(-2.5) = -2", () => expect(Math.trunc(-2.5)).toBe(-2));
  // Row 14: 2^10 = 1024
  it("2^10 = 1024", () => expect(2 ** 10).toBe(1024));
  // Row 15: 10/4 = 2.5
  it("10/4 = 2.5", () => expect(10 / 4).toBe(2.5));
  // Row 16: Integer overflow at 32767+1 raises error 6
  it("Integer 32767 + 1 overflows with error 6", () => {
    expect(() => toInteger(32768)).toThrowError(RuntimeError);
    try {
      toInteger(32768);
    } catch (e) {
      expect((e as RuntimeError).code).toBe(6);
    }
  });
  // Row 17: Long 32768 — adding 1 to a Long(32767) gives 32768, no overflow.
  it("Long 32767 + 1 = 32768 (no overflow)", () => {
    expect(toLong(32768)).toBe(32768);
  });
});
