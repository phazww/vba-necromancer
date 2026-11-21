// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { hasCellFormats, openWorkbook } from "@vba-necromancer/workbook";
import { FIXTURE_NAMES, ROOT, fixtureBytes } from "./helpers";

interface Row {
  row: number;
  col: number;
  value: number;
  z: string;
}
const rows = (
  JSON.parse(readFileSync(join(ROOT, "fixtures/src/number_formats/cells.json"), "utf8")) as {
    sheets: Array<{ cells: Row[] }>;
  }
).sheets[0].cells;

const OLD = FIXTURE_NAMES.filter((n) => n !== "number_formats");

describe("fixture builder writes number formats (FMT-06)", () => {
  it("FMT-06 there are eight old fixtures and the new one", () => {
    expect(OLD).toHaveLength(8);
    expect(FIXTURE_NAMES).toContain("number_formats");
  });

  it("FMT-06 number_formats.xlsm has styles.xml with one numFmt per distinct format", () => {
    const files = unzipSync(fixtureBytes("number_formats"));
    const styles = strFromU8(files["xl/styles.xml"]);
    const distinct = [...new Set(rows.map((r) => r.z))];
    expect(distinct.length).toBeGreaterThan(10);
    expect(styles.match(/<numFmt /g)).toHaveLength(distinct.length);
    expect(styles).toContain('formatCode="#,##0.00 &quot;₽&quot;"');
    expect(strFromU8(files["[Content_Types].xml"])).toContain("/xl/styles.xml");
    expect(strFromU8(files["xl/_rels/workbook.xml.rels"])).toContain('Target="styles.xml"');
  });

  it("FMT-06 the file reads back with every stored value next to its format string", () => {
    const sheet = openWorkbook(fixtureBytes("number_formats")).getSheet("Formats");
    if (!hasCellFormats(sheet)) throw new Error("no formats");
    for (const r of rows) {
      expect(sheet.getCellValue(r.row, r.col), `A${r.row}`).toBe(r.value);
      const want = r.z.toLowerCase() === "general" ? null : r.z;
      expect(sheet.getCellFormat(r.row, r.col), `A${r.row}`).toBe(want);
    }
  });

  it("FMT-06 the old fixtures have no styles.xml and no style attributes", () => {
    for (const name of OLD) {
      const files = unzipSync(fixtureBytes(name));
      expect(files["xl/styles.xml"], name).toBeUndefined();
      for (const [part, data] of Object.entries(files)) {
        if (part.startsWith("xl/worksheets/sheet")) expect(strFromU8(data), `${name} ${part}`).not.toMatch(/<c [^>]* s="/);
      }
      expect(strFromU8(files["xl/_rels/workbook.xml.rels"]), name).not.toContain("styles");
    }
  });

  it("FMT-06 rebuilding gives the same parts for the eight old fixtures as the committed files", () => {
    const dir = mkdtempSync(join(tmpdir(), "necromancer-numfmt-"));
    try {
      execFileSync(join(ROOT, "node_modules", ".bin", "vite-node"), [join(ROOT, "fixtures", "build", "build.ts")], {
        cwd: ROOT,
        env: { ...process.env, FIXTURES_OUT_DIR: dir },
        stdio: "pipe",
      });
      expect(readdirSync(dir).sort()).toEqual(FIXTURE_NAMES.map((n) => `${n}.xlsm`).sort());
      for (const name of OLD) {
        const fresh = unzipSync(new Uint8Array(readFileSync(join(dir, `${name}.xlsm`))));
        const committed = unzipSync(fixtureBytes(name));
        expect(Object.keys(fresh).sort(), name).toEqual(Object.keys(committed).sort());
        for (const part of Object.keys(committed)) {
          expect(Buffer.from(fresh[part]).equals(Buffer.from(committed[part])), `${name} ${part}`).toBe(true);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
