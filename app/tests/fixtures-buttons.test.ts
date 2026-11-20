// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { readButtons } from "@vba-necromancer/workbook";
import { ROOT } from "./helpers";

const built = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ROOT, "fixtures", "build", `${name}.xlsm`)));
const parts = (name: string): Record<string, Uint8Array> => unzipSync(built(name));

describe("fixture builder writes Form Control buttons (BTN-07)", () => {
  it("demo_invoice.xlsm has the VML part, the sheet rels, legacyDrawing and the vml content type", () => {
    const files = parts("demo_invoice");
    const vml = strFromU8(files["xl/drawings/vmlDrawing1.vml"]);
    expect(vml).toContain('<x:ClientData ObjectType="Button">');
    expect(vml).toContain("<x:FmlaMacro>Module1.BuildInvoice</x:FmlaMacro>");
    expect(vml).toContain("<x:Anchor>7, 15, 1, 4, 9, 15, 3, 4</x:Anchor>");
    expect(vml).toContain(">Build invoice</font>");
    expect(strFromU8(files["xl/worksheets/_rels/sheet1.xml.rels"])).toContain(
      'Target="../drawings/vmlDrawing1.vml"',
    );
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('<legacyDrawing r:id="rId1"/>');
    expect(sheet).toContain(
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    );
    expect(strFromU8(files["[Content_Types].xml"])).toContain(
      '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>',
    );
  });

  it("demo_acts.xlsm carries the Cyrillic caption as UTF-8 text", () => {
    const vml = strFromU8(parts("demo_acts")["xl/drawings/vmlDrawing1.vml"]);
    expect(vml).toContain('<?xml version="1.0" encoding="UTF-8"');
    expect(vml).toContain(">Сформировать акты</font>");
    expect(vml).toContain("<x:FmlaMacro>Module1.BuildActs</x:FmlaMacro>");
  });

  it("readButtons lists exactly one button in each demo workbook", () => {
    expect(readButtons(built("demo_invoice"))).toEqual({
      buttons: [
        {
          sheet: "Log",
          caption: "Build invoice",
          anchor: "H2",
          macroRef: "Module1.BuildInvoice",
          source: "form-control",
        },
      ],
      problems: [],
    });
    expect(readButtons(built("demo_acts"))).toEqual({
      buttons: [
        {
          sheet: "Журнал",
          caption: "Сформировать акты",
          anchor: "H2",
          macroRef: "Module1.BuildActs",
          source: "form-control",
        },
      ],
      problems: [],
    });
  });

  it("every other fixture has no drawing parts and no buttons (BTN-08)", () => {
    const others = readdirSync(join(ROOT, "fixtures", "build"))
      .filter((f) => f.endsWith(".xlsm"))
      .map((f) => f.replace(/\.xlsm$/, ""))
      .filter((n) => n !== "demo_acts" && n !== "demo_invoice");
    expect(others.length).toBeGreaterThan(0);
    for (const name of others) {
      expect(
        Object.keys(parts(name)).filter(
          (n) => n.startsWith("xl/drawings/") || n.includes("_rels/sheet"),
        ),
      ).toEqual([]);
      expect(readButtons(built(name))).toEqual({ buttons: [], problems: [] });
    }
  });

  it("building twice gives identical bytes", () => {
    const run = (): string => {
      const dir = mkdtempSync(join(tmpdir(), "necromancer-fixtures-"));
      execFileSync(
        join(ROOT, "node_modules", ".bin", "vite-node"),
        [join(ROOT, "fixtures", "build", "build.ts")],
        {
          cwd: ROOT,
          env: { ...process.env, FIXTURES_OUT_DIR: dir },
          stdio: "pipe",
        },
      );
      return dir;
    };
    const a = run();
    const b = run();
    try {
      const names = readdirSync(a).filter((f) => f.endsWith(".xlsm"));
      expect(names.length).toBeGreaterThan(5);
      for (const n of names)
        expect(Buffer.compare(readFileSync(join(a, n)), readFileSync(join(b, n)))).toBe(0);
      // The two demos are the committed bytes too (app/tests/model/demo.test.ts bundles them).
      for (const n of ["demo_acts.xlsm", "demo_invoice.xlsm"]) {
        expect(
          Buffer.compare(
            readFileSync(join(a, n)),
            readFileSync(join(ROOT, "fixtures", "build", n)),
          ),
        ).toBe(0);
      }
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  }, 60_000);
});
