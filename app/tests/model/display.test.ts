import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { openWorkbook } from "@vba-necromancer/workbook";
import { displayText } from "../../src/model/display";

function sheet() {
  const ws: XLSX.WorkSheet = {
    A1: { t: "n", v: 46296, z: "yyyy-mm-dd" },
    A2: { t: "n", v: 5 },
    A3: { t: "s", v: "46296", z: "yyyy-mm-dd" },
    A4: { t: "b", v: true },
    "!ref": "A1:A4",
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "S");
  return openWorkbook(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer)).getSheet("S");
}

describe("displayText (FMT-01)", () => {
  it("FMT-01 formats numbers that have a format and leaves the rest as formatValue", () => {
    const s = sheet();
    expect(displayText(s, 1, 1, s.getCellValue(1, 1))).toBe("2026-10-01");
    expect(displayText(s, 2, 1, s.getCellValue(2, 1))).toBe("5");
    expect(displayText(s, 3, 1, s.getCellValue(3, 1))).toBe("46296");
    expect(displayText(s, 4, 1, s.getCellValue(4, 1))).toBe("TRUE");
    expect(displayText(s, 9, 9, null)).toBe("");
  });
});
