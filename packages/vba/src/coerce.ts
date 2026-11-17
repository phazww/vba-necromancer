/**
 * VBA numeric semantics and coercion helpers.
 *
 * Key VBA rules implemented here:
 *
 *  - CInt / CLng use "banker's rounding" (round half to even), matching VBA's
 *    documented behaviour. Standard JavaScript Math.round uses round-half-away-
 *    from-zero, so we cannot use it directly.
 *
 *  - Integer division (\) and Mod first round each operand with roundHalfEven,
 *    then truncate toward zero (Math.trunc). The rounding step means
 *    7.5 \ 2 -> 8 \ 2 = 4, and 5.5 Mod 2 -> 6 Mod 2 = 0.
 *
 *  - Integer (16-bit) overflow raises error 6; Long (32-bit) overflow raises
 *    error 6.  Division result keeps Double precision (10/4 = 2.5).
 *
 *  - Round(x, n) is banker's rounding to n decimal places, implemented with
 *    exact integer arithmetic (BigInt) over the binary representation of x.
 *    Multiplying a double by 10^n can land slightly above or below the true
 *    half-way point due to IEEE 754 representation — e.g. 2.675 is stored as
 *    2.67499999…, so Round(2.675, 2) = 2.67, not 2.68.  By decomposing the
 *    double into mantissa * 2^exp and multiplying by 10^n exactly, we see the
 *    actual half-way relationship and apply banker's rounding on the exact
 *    rational value, which matches what VBA does.
 *
 *  - Date values are doubles counting days from 1899-12-30 (VBA epoch).
 *    CDbl(DateSerial(1900,1,1)) = 2.  VBA does not insert a fictitious
 *    Feb 29 1900.  Excel cell serials share the same values for dates on or
 *    after 1900-03-01; for dates in Jan–Feb 1900 the Excel serial is one less
 *    than the VBA double.
 */

import { RuntimeError } from "./errors.js";

/** Round x to the nearest integer, ties go to the nearest even integer. */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const remainder = x - floor;

  // Not a half-way case: use ordinary round.
  if (remainder < 0.5 || remainder > 0.5) {
    return Math.round(x);
  }

  // Exactly half-way: pick the even neighbour.
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Round x to `digits` decimal places using banker's rounding.
 *
 * Uses exact integer arithmetic (BigInt) over the IEEE 754 bit pattern of x
 * to determine the precise half-way relationship before rounding, so the
 * result matches VBA's Round() for every representable double.
 *
 * Example: 2.675 is stored as 2.6749999…, so Round(2.675, 2) = 2.67 (rounds
 * down because the exact value is below the half-way point).  An epsilon-based
 * approach would incorrectly treat it as a tie and round up to 2.68.
 */
export function roundHalfEvenTo(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x;

  // Clamp to a sane range (VBA supports Round(x, 0..28)).
  if (digits <= 0) return roundHalfEven(x);

  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);

  if (abs === 0) return 0;

  // --- Decompose abs into mantissa * 2^exp (IEEE 754 double) ---
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, abs, false /* big-endian */);
  const hiWord = dv.getUint32(0, false);
  const loWord = dv.getUint32(4, false);

  const expBits = (hiWord >>> 20) & 0x7ff;
  // For normal numbers: implicit leading 1 bit; for subnormals: no leading 1.
  const mantHi =
    expBits === 0
      ? hiWord & 0x000fffff
      : (hiWord & 0x000fffff) | 0x00100000;
  const mant = (BigInt(mantHi) << 32n) | BigInt(loWord >>> 0);
  // exp is chosen so that abs = mant * 2^exp exactly.
  const exp = BigInt(expBits === 0 ? -1074 : expBits - 1023 - 52);

  // --- Compute mant * 10^digits * 2^exp exactly using BigInt ---
  const tenD = 10n ** BigInt(digits);

  let numerator: bigint;
  let denominator: bigint;
  if (exp >= 0n) {
    numerator = mant * tenD * (2n ** exp);
    denominator = 1n;
  } else {
    numerator = mant * tenD;
    denominator = 2n ** -exp;
  }

  // Floor-divide to get quotient and remainder.
  const q = numerator / denominator;
  const r = numerator - q * denominator;
  const twoR = 2n * r;

  let rounded: bigint;
  if (twoR < denominator) {
    rounded = q; // below half: round down
  } else if (twoR > denominator) {
    rounded = q + 1n; // above half: round up
  } else {
    // exactly half: round to even
    rounded = q % 2n === 0n ? q : q + 1n;
  }

  return (sign * Number(rounded)) / Math.pow(10, digits);
}

/** Convert a number to VBA Integer (16-bit signed). Throws RuntimeError(6) on overflow. */
export function toInteger(x: number): number {
  const rounded = roundHalfEven(x);
  if (rounded < -32768 || rounded > 32767) {
    throw new RuntimeError(6, "Overflow", "", 0);
  }
  return rounded;
}

/** Convert a number to VBA Long (32-bit signed). Throws RuntimeError(6) on overflow. */
export function toLong(x: number): number {
  const rounded = roundHalfEven(x);
  if (rounded < -2147483648 || rounded > 2147483647) {
    throw new RuntimeError(6, "Overflow", "", 0);
  }
  return rounded;
}

/**
 * VBA integer division (\).
 * Both operands are rounded with roundHalfEven first, then the result is
 * truncated toward zero.  Division by zero raises RuntimeError(11).
 */
export function intDiv(a: number, b: number): number {
  const ra = roundHalfEven(a);
  const rb = roundHalfEven(b);
  if (rb === 0) {
    throw new RuntimeError(11, "Division by zero", "", 0);
  }
  return Math.trunc(ra / rb);
}

/**
 * VBA Mod.
 * Both operands are rounded with roundHalfEven first; the sign of the result
 * follows the dividend (same as Math.trunc division remainder).
 * Division by zero raises RuntimeError(11).
 */
export function vbaMod(a: number, b: number): number {
  const ra = roundHalfEven(a);
  const rb = roundHalfEven(b);
  if (rb === 0) {
    throw new RuntimeError(11, "Division by zero", "", 0);
  }
  return ra - rb * Math.trunc(ra / rb);
}

/**
 * VBA DateSerial — returns the VBA Date double for the given year/month/day.
 *
 * VBA's Date type counts days from 1899-12-30, so:
 *   CDbl(DateSerial(1900, 1, 1)) = 2
 *   CDbl(DateSerial(1900, 2, 28)) = 60
 *   CDbl(DateSerial(1900, 3, 1)) = 61
 *   CDbl(DateSerial(2000, 1, 1)) = 36526
 *
 * VBA does not insert the fictitious Feb 29 1900 that Excel cell serials
 * carry (the Lotus 1-2-3 bug).  For dates on or after 1900-03-01 the VBA
 * double and the Excel cell serial are the same number.  For 1900-01-01 and
 * 1900-02-28 the VBA double is one greater than the Excel cell serial.
 * Serial 1 in Excel corresponds to 1900-01-01 (VBA double 2); Excel serial 60
 * is the fictitious Feb 29 (no VBA equivalent).
 *
 * Use excelSerialToVbaDate / vbaDateToExcelSerial when converting between
 * cell-stored serials and VBA Date doubles in the Jan–Feb 1900 window.
 */
export function dateSerial(year: number, month: number, day: number): number {
  const msPerDay = 86400000;
  // VBA epoch: December 30, 1899.
  const epoch = Date.UTC(1899, 11, 30);
  return (Date.UTC(year, month - 1, day) - epoch) / msPerDay;
}

/**
 * Convert an Excel cell serial (1-based, includes fictitious Feb 29 1900 at
 * serial 60) to a VBA Date double (days from 1899-12-30, no fake Feb 29).
 *
 * Conversion table:
 *   Excel serial 1  (1900-01-01) → VBA double 2
 *   Excel serial 59 (1900-02-28) → VBA double 60
 *   Excel serial 60 (fictitious) → NaN (date does not exist)
 *   Excel serial 61 (1900-03-01) → VBA double 61  (same from here on)
 */
export function excelSerialToVbaDate(excelSerial: number): number {
  if (excelSerial === 60) return NaN; // fictitious Feb 29 1900
  if (excelSerial < 60) return excelSerial + 1;
  return excelSerial; // >= 61: same value
}

/**
 * Convert a VBA Date double (days from 1899-12-30) to an Excel cell serial.
 *
 * Conversion table:
 *   VBA double 2  (1900-01-01) → Excel serial 1
 *   VBA double 60 (1900-02-28) → Excel serial 59
 *   VBA double 61 (1900-03-01) → Excel serial 61  (same from here on)
 *
 * VBA doubles 0 and 1 (1899-12-30 and 1899-12-31) have no Excel serial
 * equivalent; this function returns them unchanged.
 */
export function vbaDateToExcelSerial(vbaDate: number): number {
  if (vbaDate >= 2 && vbaDate <= 60) return vbaDate - 1;
  return vbaDate; // <= 1 or >= 61: same value
}
