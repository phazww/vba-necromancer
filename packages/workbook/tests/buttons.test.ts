import { describe, it, expect } from "vitest";
import { strToU8, zipSync } from "fflate";
import { readButtons } from "../src/index.js";

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (items: Array<[string, string]>): string =>
  `<Relationships>${items.map(([type, target], i) => `<Relationship Id="rId${i + 1}" Type="${REL}/${type}" Target="${target}"/>`).join("")}</Relationships>`;
const workbook = (names: string[]): string =>
  `<workbook xmlns:r="${REL}"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
const workbookRels = (n: number): string =>
  rels(
    Array.from(
      { length: n },
      (_, i) => ["worksheet", `worksheets/sheet${i + 1}.xml`] as [string, string],
    ),
  );

const vmlButton = (caption: string, macro: string, anchor: string): string =>
  `<xml xmlns:v="urn:v" xmlns:o="urn:o" xmlns:x="urn:x"><v:shape id="b" o:spid="_x0000_s1025"><v:textbox><div>${caption}</div></v:textbox><x:ClientData ObjectType="Button"><x:Anchor>${anchor}</x:Anchor><x:FmlaMacro>${macro}</x:FmlaMacro></x:ClientData></v:shape></xml>`;
const drawing = (macro: string, text: string, col = 0, row = 0): string =>
  `<xdr:wsDr xmlns:xdr="urn:xdr" xmlns:a="urn:a"><xdr:twoCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:row>${row}</xdr:row></xdr:from><xdr:to><xdr:col>9</xdr:col><xdr:row>9</xdr:row></xdr:to><xdr:sp macro="${macro}"><xdr:nvSpPr><xdr:cNvPr id="2" name="Shape"/></xdr:nvSpPr><xdr:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></xdr:txBody></xdr:sp></xdr:twoCellAnchor></xdr:wsDr>`;

function zip(parts: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(parts)) entries[k] = typeof v === "string" ? strToU8(v) : v;
  return zipSync(entries);
}

/** Overwrites the start of the compressed body of one entry, so inflating it fails. */
function corrupt(zipped: Uint8Array, name: string): Uint8Array {
  const bytes = zipped.slice();
  const marker = strToU8(name);
  for (let i = 30; i + marker.length < bytes.length; i++) {
    const isLocalHeader =
      bytes[i - 30] === 0x50 &&
      bytes[i - 29] === 0x4b &&
      bytes[i - 28] === 3 &&
      bytes[i - 27] === 4;
    if (isLocalHeader && marker.every((m, k) => bytes[i + k] === m)) {
      for (let k = 0; k < 8; k++) bytes[i + marker.length + k] = 0xff;
      return bytes;
    }
  }
  throw new Error(`entry not found: ${name}`);
}

describe("readButtons", () => {
  it("lists a VML button and a DrawingML shape on different sheets, in sheet order, with sheet names (BTN-01, BTN-02, BTN-04)", () => {
    const bytes = zip({
      "xl/workbook.xml": workbook(["Log", "Акты"]),
      "xl/_rels/workbook.xml.rels": workbookRels(2),
      "xl/worksheets/_rels/sheet2.xml.rels": rels([["vmlDrawing", "../drawings/vmlDrawing1.vml"]]),
      "xl/worksheets/_rels/sheet1.xml.rels": rels([["drawing", "../drawings/drawing1.xml"]]),
      "xl/drawings/vmlDrawing1.vml": vmlButton(
        "Build",
        "[0]!Module1.Build",
        "7, 15, 1, 4, 9, 15, 3, 4",
      ),
      "xl/drawings/drawing1.xml": drawing("Module1.Go", "Go", 2, 2),
    });
    expect(readButtons(bytes)).toEqual({
      buttons: [
        { sheet: "Log", caption: "Go", anchor: "C3", macroRef: "Module1.Go", source: "shape" },
        {
          sheet: "Акты",
          caption: "Build",
          anchor: "H2",
          macroRef: "[0]!Module1.Build",
          source: "form-control",
        },
      ],
      problems: [],
    });
  });

  it("gives nothing for no drawings or drawings without macros (BTN-08)", () => {
    const plain = zip({
      "xl/workbook.xml": workbook(["A"]),
      "xl/_rels/workbook.xml.rels": workbookRels(1),
    });
    expect(readButtons(plain)).toEqual({ buttons: [], problems: [] });
    const noMacro = zip({
      "xl/workbook.xml": workbook(["A"]),
      "xl/_rels/workbook.xml.rels": workbookRels(1),
      "xl/worksheets/_rels/sheet1.xml.rels": rels([["drawing", "../drawings/drawing1.xml"]]),
      "xl/drawings/drawing1.xml": drawing("", "x"),
    });
    expect(readButtons(noMacro)).toEqual({ buttons: [], problems: [] });
  });

  it("gives nothing for bytes that are not a ZIP, without throwing", () => {
    const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const random = Uint8Array.from({ length: 200 }, (_, i) => (i * 37 + 11) & 0xff);
    const brokenZip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const bytes of [cfb, random, new Uint8Array(0), brokenZip]) {
      expect(readButtons(bytes)).toEqual({ buttons: [], problems: [] });
    }
  });

  it("reports a broken part by name and still reads the other drawing", () => {
    const bytes = corrupt(
      zip({
        "xl/workbook.xml": workbook(["A"]),
        "xl/_rels/workbook.xml.rels": workbookRels(1),
        "xl/worksheets/_rels/sheet1.xml.rels": rels([
          ["vmlDrawing", "../drawings/vmlDrawing1.vml"],
          ["drawing", "../drawings/drawing1.xml"],
        ]),
        "xl/drawings/vmlDrawing1.vml": "<xml><v:shape>".repeat(200),
        "xl/drawings/drawing1.xml": drawing("Module1.Go", "Go"),
      }),
      "xl/drawings/vmlDrawing1.vml",
    );
    const out = readButtons(bytes);
    expect(out.buttons.map((b) => b.caption)).toEqual(["Go"]);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toContain("xl/drawings/vmlDrawing1.vml");
  });

  it("reports a relationship that names a part missing from the ZIP", () => {
    const bytes = zip({
      "xl/workbook.xml": workbook(["A"]),
      "xl/_rels/workbook.xml.rels": workbookRels(1),
      "xl/worksheets/_rels/sheet1.xml.rels": rels([
        ["vmlDrawing", "../drawings/vmlDrawing9.vml"],
        ["drawing", "../drawings/drawing1.xml"],
      ]),
      "xl/drawings/drawing1.xml": drawing("Module1.Go", "Go"),
    });
    const out = readButtons(bytes);
    expect(out.buttons).toHaveLength(1);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toContain("xl/drawings/vmlDrawing9.vml");
  });

  it("orders by anchor on one sheet, form controls before shapes at the same cell, no anchor last", () => {
    const vml = `<xml xmlns:v="urn:v" xmlns:x="urn:x">${[
      ["F-late", "7, 0, 5, 0"],
      ["F-same", "2, 0, 2, 0"],
    ]
      .map(
        ([c, a]) =>
          `<v:shape id="${c}"><v:textbox>${c}</v:textbox><x:ClientData ObjectType="Button"><x:Anchor>${a}</x:Anchor><x:FmlaMacro>M</x:FmlaMacro></x:ClientData></v:shape>`,
      )
      .join("")}</xml>`;
    const shapes = (text: string, col: number, row: number): string =>
      drawing("M", text, col, row)
        .replace("</xdr:wsDr>", "")
        .replace(/^<xdr:wsDr[^>]*>/, "");
    const drawingXml = `<xdr:wsDr xmlns:xdr="urn:xdr" xmlns:a="urn:a">${shapes("S-same", 2, 2)}${shapes("S-first", 0, 0)}<xdr:absoluteAnchor><xdr:sp macro="M"><xdr:nvSpPr><xdr:cNvPr id="3" name="Abs"/></xdr:nvSpPr></xdr:sp></xdr:absoluteAnchor></xdr:wsDr>`;
    const bytes = zip({
      "xl/workbook.xml": workbook(["A"]),
      "xl/_rels/workbook.xml.rels": workbookRels(1),
      "xl/worksheets/_rels/sheet1.xml.rels": rels([
        ["drawing", "../drawings/drawing1.xml"],
        ["vmlDrawing", "../drawings/vmlDrawing1.vml"],
      ]),
      "xl/drawings/vmlDrawing1.vml": vml,
      "xl/drawings/drawing1.xml": drawingXml,
    });
    expect(readButtons(bytes).buttons.map((b) => b.caption)).toEqual([
      "S-first",
      "F-same",
      "S-same",
      "F-late",
      "Abs",
    ]);
  });

  it("inflates only the listed parts: a corrupt unrelated entry does not matter", () => {
    const good = zip({
      "xl/workbook.xml": workbook(["A"]),
      "xl/_rels/workbook.xml.rels": workbookRels(1),
      "xl/worksheets/_rels/sheet1.xml.rels": rels([["drawing", "../drawings/drawing1.xml"]]),
      "xl/drawings/drawing1.xml": drawing("Module1.Go", "Go"),
      "xl/worksheets/sheet1.xml": "<worksheet>".repeat(200),
    });
    const bytes = corrupt(good, "xl/worksheets/sheet1.xml");
    expect(readButtons(bytes).buttons.map((b) => b.caption)).toEqual(["Go"]);
  });
});
