import { describe, it, expect } from "vitest";
import { formatNumber } from "../src/index.js";

// Rows copied from the hand-written table in .kiro/specs/number-formats/requirements.md.
// Never change an expected value here to make a test pass.
const DATE_ROWS: Array<[number, string, string]> = [
  [46296, "yyyy-mm-dd", "2026-10-01"],
  [46000, "dd.mm.yyyy", "09.12.2025"],
  [45658, "d mmm yyyy", "1 Jan 2025"],
  [45658, "mmmm yy", "January 25"],
  [46000.75, "dd.mm.yyyy hh:mm", "09.12.2025 18:00"],
  [0.5, "h:mm", "12:00"],
];

const NUMBER_ROWS: Array<[number, string, string]> = [
  [0.125, "0%", "13%"],
  [0.125, "0.0%", "12.5%"],
  [1234567.891, "#,##0.00", "1,234,567.89"],
  [1286290, "#,##0", "1,286,290"],
  [2.5, "0", "3"],
  [-2.5, "0", "-3"],
  [1.005, "0.00", "1.01"],
  [0.5, "0.00", "0.50"],
  [0.5, "#.##", ".5"],
  [7, "000", "007"],
  [1500, '#,##0.00 "₽"', "1,500.00 ₽"],
  [-1500, "#,##0.00;(#,##0.00)", "(1,500.00)"],
  [0, '0.00;-0.00;"-"', "-"],
  [1234.5, "General", "1234.5"],
  [1234.5, "[Red]0.00", "1234.5"],
  [0.3333, "# ?/?", "0.3333"],
];

describe("formatNumber: oracle table, number rows (FMT-02, FMT-03)", () => {
  it.each(NUMBER_ROWS)("FMT-02 %s with %s shows %s", (value, format, shown) => {
    expect(formatNumber(value, format)).toBe(shown);
  });
});

describe("formatNumber: General and empty (FMT-02)", () => {
  it("FMT-02 empty format and General in any case give the plain text", () => {
    expect(formatNumber(0.1 + 0.2, "")).toBe("0.3");
    expect(formatNumber(0.1 + 0.2, "general")).toBe("0.3");
    expect(formatNumber(1e21, "GENERAL")).toBe("1E+21");
    expect(formatNumber(1.5e-7, "General")).toBe("1.5E-07");
    expect(formatNumber(-0, "General")).toBe("0");
  });
});

describe("formatNumber: sections, literals, rounding (FMT-02, FMT-03)", () => {
  it("FMT-02 one section puts a minus before a negative value", () => {
    expect(formatNumber(-1234.5, "#,##0.00")).toBe("-1,234.50");
    expect(formatNumber(-0.25, "0.0%")).toBe("-25.0%");
  });
  it("FMT-02 two sections: zero uses the first, negative formats the absolute value", () => {
    expect(formatNumber(0, "0.0;(0.0)")).toBe("0.0");
    expect(formatNumber(-3, "0.0;(0.0)")).toBe("(3.0)");
  });
  it("FMT-02 three sections: positive, negative, zero", () => {
    expect(formatNumber(5, '0;-0;"zero"')).toBe("5");
    expect(formatNumber(-5, '0;-0;"zero"')).toBe("-5");
    expect(formatNumber(0, '0;-0;"zero"')).toBe("zero");
  });
  it("FMT-02 backslash escapes and $ and € literals", () => {
    expect(formatNumber(12, "0\\ \\k\\g")).toBe("12 kg");
    expect(formatNumber(9.5, "$0.00")).toBe("$9.50");
    expect(formatNumber(9.5, "0.00 €")).toBe("9.50 €");
    expect(formatNumber(3, '"No."0')).toBe("No.3");
  });
  it("FMT-02 a quoted semicolon does not split sections", () => {
    expect(formatNumber(3, '0"; "')).toBe("3; ");
  });
  it("FMT-02 a thousands separator needs digit placeholders on both sides", () => {
    expect(formatNumber(1234567, "0,0")).toBe("1,234,567");
    expect(formatNumber(999, "#,##0")).toBe("999");
    expect(formatNumber(1000, "#,##0")).toBe("1,000");
  });
  it("FMT-02 more digits than placeholders all print", () => {
    expect(formatNumber(12345, "0")).toBe("12345");
    expect(formatNumber(12345, "#")).toBe("12345");
    expect(formatNumber(0, "#")).toBe("");
    expect(formatNumber(3, "#.##")).toBe("3.");
  });
  it("FMT-03 half away from zero, decimal representation", () => {
    expect(formatNumber(0.5, "0")).toBe("1");
    expect(formatNumber(-0.5, "0")).toBe("-1");
    expect(formatNumber(1.5, "0")).toBe("2");
    expect(formatNumber(0.125, "0.00")).toBe("0.13");
    expect(formatNumber(2.675, "0.00")).toBe("2.68");
    expect(formatNumber(0.285, "0.00")).toBe("0.29");
    expect(formatNumber(0.1 + 0.2, "0.0000000000000000")).toBe("0.3000000000000000");
    expect(formatNumber(999.995, "0.00")).toBe("1000.00");
    expect(formatNumber(0.995, "0.0")).toBe("1.0");
  });
  it("FMT-03 percent keeps decimal digits exact", () => {
    expect(formatNumber(0.07, "0%")).toBe("7%");
    expect(formatNumber(1.005, "0.0%")).toBe("100.5%");
    expect(formatNumber(0.00005, "0.00%")).toBe("0.01%");
  });
  it("FMT-02 large and small values", () => {
    expect(formatNumber(1e20, "#,##0")).toBe("100,000,000,000,000,000,000");
    expect(formatNumber(1e-7, "0.00")).toBe("0.00");
  });
});

describe("formatNumber: formats it does not read give the plain text (FMT-02)", () => {
  it.each([
    ["more than three sections", "0;0;0;0"],
    ["empty section", "0;;0"],
    ["scientific", "0.00E+00"],
    ["text placeholder", "@"],
    ["fill", "*-0"],
    ["padding", "0_)"],
    ["condition", "[>100]0"],
    ["scaling comma", "0,"],
    ["literal between digits", "000-0000"],
    ["two decimal points", "0.0.0"],
    ["unclosed quote", '0"abc'],
    ["trailing backslash", "0\\"],
    ["bare letter", "0 kg"],
    ["General inside sections", "General;-General"],
    ["elapsed time", "[h]:mm"],
  ])("FMT-02 %s: %s", (_name, format) => {
    expect(formatNumber(1234.5, format)).toBe("1234.5");
  });
  it("FMT-02 non-finite values stay as they are", () => {
    expect(formatNumber(Infinity, "0.00")).toBe("Infinity");
    expect(formatNumber(NaN, "0.00")).toBe("NaN");
  });
});

describe("formatNumber: oracle table, date rows (FMT-02)", () => {
  it.each(DATE_ROWS)("FMT-02 %s with %s shows %s", (value, format, shown) => {
    expect(formatNumber(value, format)).toBe(shown);
  });
});

describe("formatNumber: dates and times (FMT-02, FMT-03)", () => {
  // Pairs computed independently with Python datetime.date(1899, 12, 30) + timedelta(days=serial).
  it.each([
    [61, "1900-03-01"],
    [100, "1900-04-09"],
    [366, "1900-12-31"],
    [10000, "1927-05-18"],
    [25569, "1970-01-01"],
    [36526, "2000-01-01"],
    [36585, "2000-02-29"],
    [43831, "2020-01-01"],
    [44927, "2023-01-01"],
    [50000, "2036-11-21"],
    [73050, "2099-12-31"],
    [2958465, "9999-12-31"],
  ])("FMT-02 serial %s is %s", (serial, iso) => {
    expect(formatNumber(serial, "yyyy-mm-dd")).toBe(iso);
  });
  it("FMT-02 serials below 61, negative or after 9999-12-31 show the plain text", () => {
    expect(formatNumber(60, "yyyy-mm-dd")).toBe("60");
    expect(formatNumber(0, "yyyy-mm-dd")).toBe("0");
    expect(formatNumber(-5, "yyyy-mm-dd")).toBe("-5");
    expect(formatNumber(2958466, "yyyy-mm-dd")).toBe("2958466");
  });
  it("FMT-02 m after h and before ss is minutes, otherwise the month", () => {
    expect(formatNumber(46000.75 + 5 / 1440, "hh:mm")).toBe("18:05");
    expect(formatNumber(46000.75 + 5 / 1440, "h:m")).toBe("18:5");
    expect(formatNumber(61 + 7 / 1440 + 9 / 86400, "mm:ss")).toBe("07:09");
    expect(formatNumber(46296, "m/d/yyyy")).toBe("10/1/2026");
    expect(formatNumber(46296.5, "mm/dd hh:mm")).toBe("10/01 12:00");
  });
  it("FMT-02 hh:mm:ss near the end of a day", () => {
    expect(formatNumber(61.999988426, "hh:mm:ss")).toBe("23:59:59");
  });
  it("FMT-03 time is rounded to the nearest second and carries into the day", () => {
    expect(formatNumber(46000.99999999, "dd.mm.yyyy hh:mm")).toBe("10.12.2025 00:00");
    expect(formatNumber(46000.99999999, "dd.mm.yyyy")).toBe("09.12.2025");
    expect(formatNumber(61 + 0.25, "hh:mm:ss")).toBe("06:00:00");
  });
  it("FMT-02 yy pads, d and m do not", () => {
    expect(formatNumber(45658 + 3 * 365 + 1, "yy")).toBe("28");
    expect(formatNumber(36526, "yy")).toBe("00");
    expect(formatNumber(45658, "d.m")).toBe("1.1");
  });
  it("FMT-02 unsupported date parts give the plain text", () => {
    for (const f of [
      "yyy",
      "ddd",
      "dddd",
      "s",
      "yyyy-mm-dd AM/PM",
      "mmmmm",
      "yyyy-mm-dd;@",
      "yyyy0",
      "yyyy%",
    ]) {
      expect(formatNumber(46296, f)).toBe("46296");
    }
  });
  it("FMT-02 negative value with a date format is the plain text", () => {
    expect(formatNumber(-46296, "yyyy-mm-dd;yyyy-mm-dd")).toBe("-46296");
  });
  it("FMT-02 date sections in sign sections", () => {
    expect(formatNumber(46296, 'yyyy-mm-dd;"neg"')).toBe("2026-10-01");
    expect(formatNumber(-1, 'yyyy-mm-dd;"neg"')).toBe("neg");
  });
});

describe("formatNumber: time-only formats (FMT-02)", () => {
  it("FMT-02 a time-only format works on fractions, whole serials and large serials", () => {
    expect(formatNumber(0.75, "hh:mm")).toBe("18:00");
    expect(formatNumber(0, "hh:mm:ss")).toBe("00:00:00");
    expect(formatNumber(46000.75, "h:mm")).toBe("18:00");
    expect(formatNumber(-0.5, "h:mm")).toBe("-0.5");
  });
});
