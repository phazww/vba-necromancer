import { describe, it, expect } from "vitest";
import { locateDrawings } from "../src/drawings.js";

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (items: Array<[string, string, string]>): string =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(
      ([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`,
    )
    .join("")}</Relationships>`;
const book = (sheets: Array<[string, string]>): string =>
  `<workbook xmlns:r="${REL}"><sheets>${sheets.map(([n, id], i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="${id}"/>`).join("")}</sheets></workbook>`;

describe("locateDrawings (BTN-04)", () => {
  it("finds the VML drawing of one sheet", () => {
    const out = locateDrawings(
      book([["Log", "rId1"]]),
      rels([["rId1", "worksheet", "worksheets/sheet1.xml"]]),
      new Map([
        ["xl/worksheets/sheet1.xml", rels([["rId1", "vmlDrawing", "../drawings/vmlDrawing1.vml"]])],
      ]),
    );
    expect(out).toEqual([{ sheet: "Log", part: "xl/drawings/vmlDrawing1.vml", kind: "vml" }]);
  });

  it("finds a VML and a DrawingML drawing on one sheet", () => {
    const out = locateDrawings(
      book([["Log", "rId1"]]),
      rels([["rId1", "worksheet", "worksheets/sheet1.xml"]]),
      new Map([
        [
          "xl/worksheets/sheet1.xml",
          rels([
            ["rId1", "vmlDrawing", "../drawings/vmlDrawing1.vml"],
            ["rId2", "drawing", "../drawings/drawing1.xml"],
          ]),
        ],
      ]),
    );
    expect(out).toEqual([
      { sheet: "Log", part: "xl/drawings/vmlDrawing1.vml", kind: "vml" },
      { sheet: "Log", part: "xl/drawings/drawing1.xml", kind: "drawingml" },
    ]);
  });

  it("names the right sheet when file numbers and sheet order disagree", () => {
    const out = locateDrawings(
      book([
        ["Second", "rId7"],
        ["First", "rId3"],
      ]),
      rels([
        ["rId3", "worksheet", "worksheets/sheet1.xml"],
        ["rId7", "worksheet", "worksheets/sheet2.xml"],
      ]),
      new Map([
        ["xl/worksheets/sheet1.xml", rels([["rId1", "vmlDrawing", "../drawings/vmlDrawing2.vml"]])],
        ["xl/worksheets/sheet2.xml", rels([["rId1", "vmlDrawing", "../drawings/vmlDrawing1.vml"]])],
      ]),
    );
    expect(out).toEqual([
      { sheet: "Second", part: "xl/drawings/vmlDrawing1.vml", kind: "vml" },
      { sheet: "First", part: "xl/drawings/vmlDrawing2.vml", kind: "vml" },
    ]);
  });

  it("resolves an absolute target and a target with ../", () => {
    const out = locateDrawings(
      book([["A", "rId1"]]),
      rels([["rId1", "worksheet", "/xl/worksheets/sheet1.xml"]]),
      new Map([
        [
          "xl/worksheets/sheet1.xml",
          rels([
            ["rId1", "drawing", "/xl/drawings/drawing1.xml"],
            ["rId2", "vmlDrawing", "../drawings/../drawings/vmlDrawing1.vml"],
          ]),
        ],
      ]),
    );
    expect(out.map((d) => d.part)).toEqual([
      "xl/drawings/drawing1.xml",
      "xl/drawings/vmlDrawing1.vml",
    ]);
  });

  it("gives nothing for a sheet without a rels file, and ignores other relationship types", () => {
    const out = locateDrawings(
      book([
        ["A", "rId1"],
        ["B", "rId2"],
      ]),
      rels([
        ["rId1", "worksheet", "worksheets/sheet1.xml"],
        ["rId2", "worksheet", "worksheets/sheet2.xml"],
      ]),
      new Map([
        [
          "xl/worksheets/sheet2.xml",
          rels([
            ["rId1", "hyperlink", "https://example.com"],
            ["rId2", "comments", "../comments1.xml"],
          ]),
        ],
      ]),
    );
    expect(out).toEqual([]);
  });

  it("reads a sheet name with &amp; and Cyrillic characters", () => {
    const out = locateDrawings(
      book([["Акты &amp; счета", "rId1"]]),
      rels([["rId1", "worksheet", "worksheets/sheet1.xml"]]),
      new Map([
        ["xl/worksheets/sheet1.xml", rels([["rId1", "drawing", "../drawings/drawing1.xml"]])],
      ]),
    );
    expect(out[0].sheet).toBe("Акты & счета");
  });
});
