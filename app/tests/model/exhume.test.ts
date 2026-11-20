import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { exhume, exhumeParts } from "../../src/model/exhume";
import { FileTooLargeError, MAX_FILE_BYTES, NotAWorkbookError, checkSize, sniffKind } from "../../src/model/sniff";
import { FIXTURE_NAMES, cellsFor, expectedFor, fixtureBytes, srcModuleNames } from "../helpers";

describe("sniffKind", () => {
  it("recognises ZIP and compound file signatures", () => {
    expect(sniffKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe("zip");
    expect(sniffKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe("cfb");
    expect(sniffKind(new TextEncoder().encode("hello world"))).toBe("unknown");
    expect(sniffKind(new Uint8Array(0))).toBe("unknown");
  });
});

describe("exhume on every fixture workbook", () => {
  it.each(FIXTURE_NAMES)("%s: modules and sheets match the sources", (name) => {
    const e = exhume(`${name}.xlsm`, fixtureBytes(name));
    expect(e.vba).toBe("present");
    expect(e.kind).toBe("zip");
    expect(e.modules.map((m) => m.name).sort()).toEqual(srcModuleNames(name));
    expect(e.sheets.map((s) => s.name)).toEqual(cellsFor(name).sheets.map((s) => s.name));
    for (const m of e.modules) expect(m.parseError, `${m.name} parses`).toBeNull();
  });

  it("keeps the Cyrillic text of demo_acts in code page 1251", () => {
    const e = exhume("demo_acts.xlsm", fixtureBytes("demo_acts"));
    expect(e.modules[0].source).toContain("Журнал");
    expect(e.modules[0].lines[0]).toBe("Option Explicit");
  });

  it("graveyard: the static list equals the oracle", () => {
    const e = exhume("graveyard.xlsm", fixtureBytes("graveyard"));
    expect(e.staticUnsupported).toEqual(expectedFor("graveyard").runs[0].unsupported);
  });
});

describe("exhume errors", () => {
  it("rejects a text file, an empty array and three bytes, naming the file", () => {
    for (const bytes of [new TextEncoder().encode("just some text"), new Uint8Array(0), new Uint8Array([1, 2, 3])]) {
      expect(() => exhume("notes.xlsm", bytes)).toThrow(NotAWorkbookError);
      expect(() => exhume("notes.xlsm", bytes)).toThrow(/notes\.xlsm/);
    }
  });

  it("checkSize rejects 50 MB + 1 and the message has both numbers", () => {
    expect(() => checkSize(MAX_FILE_BYTES)).not.toThrow();
    let message = "";
    try {
      checkSize(MAX_FILE_BYTES + 1);
    } catch (e) {
      expect(e).toBeInstanceOf(FileTooLargeError);
      message = (e as Error).message;
    }
    expect(message).toContain((MAX_FILE_BYTES + 1).toLocaleString("en-US"));
    expect(message).toContain(MAX_FILE_BYTES.toLocaleString("en-US"));
  });
});

describe("workbooks without a VBA project", () => {
  it("an .xlsx lists its sheets and reports no VBA", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", 1]]), "Data");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const e = exhume("plain.xlsx", bytes);
    expect(e.vba).toBe("none");
    expect(e.sheets).toEqual([{ name: "Data", rows: 1, cols: 2 }]);
    expect(e.modules).toEqual([]);
    expect(e.macros).toEqual([]);
  });
});

describe("exhumeParts", () => {
  it("a module with a syntax error gets parseError and does not stop the others", () => {
    const bytes = fixtureBytes("demo_acts");
    const e = exhumeParts("demo_acts.xlsm", bytes, [
      { name: "Bad", type: "procedural", source: "Sub A()\n  x = (1 +\nEnd Sub\n" },
      { name: "Good", type: "procedural", source: "Sub B()\nEnd Sub\n" },
    ]);
    const bad = e.modules.find((m) => m.name === "Bad");
    const good = e.modules.find((m) => m.name === "Good");
    expect(bad?.ast).toBeNull();
    expect(bad?.parseError?.message).toBeTruthy();
    expect(bad?.parseError?.line).toBeGreaterThan(0);
    expect(good?.ast).not.toBeNull();
    expect(good?.lines.length).toBeGreaterThan(0);
  });
});

describe("exhume: buttons (BTN-03, BTN-07, BTN-08)", () => {
  it("demo_invoice.xlsm gives exactly one resolved button", () => {
    const e = exhume("demo_invoice.xlsm", fixtureBytes("demo_invoice"));
    expect(e.buttonProblems).toEqual([]);
    expect(e.buttons).toHaveLength(1);
    expect(e.buttons[0]).toMatchObject({
      sheet: "Log",
      caption: "Build invoice",
      anchor: "H2",
      macroId: "Module1.BuildInvoice",
      note: null,
    });
    expect(e.buttons[0].prediction).toBe(e.macros.find((m) => m.id === "Module1.BuildInvoice")?.prediction);
  });

  it("demo_acts.xlsm gives exactly one resolved button", () => {
    const e = exhume("demo_acts.xlsm", fixtureBytes("demo_acts"));
    expect(e.buttons).toHaveLength(1);
    expect(e.buttons[0]).toMatchObject({
      sheet: "Журнал",
      caption: "Сформировать акты",
      anchor: "H2",
      macroId: "Module1.BuildActs",
    });
  });

  it("labour_statement.xlsm and the other fixtures have no buttons", () => {
    for (const name of FIXTURE_NAMES.filter((n) => n !== "demo_acts" && n !== "demo_invoice")) {
      const e = exhume(`${name}.xlsm`, fixtureBytes(name));
      expect(e.buttons, name).toEqual([]);
      expect(e.buttonProblems, name).toEqual([]);
    }
  });

  it("a plain .xlsx gives no buttons and no problems", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[1, 2]]), "S");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const e = exhume("plain.xlsx", bytes);
    expect(e.buttons).toEqual([]);
    expect(e.buttonProblems).toEqual([]);
  });

  it("a .xls (compound file) gives no buttons and does not throw", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[1, 2]]), "S");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "biff8" }) as ArrayBuffer);
    expect(sniffKind(bytes)).toBe("cfb");
    const e = exhume("old.xls", bytes);
    expect(e.buttons).toEqual([]);
    expect(e.buttonProblems).toEqual([]);
  });
});
