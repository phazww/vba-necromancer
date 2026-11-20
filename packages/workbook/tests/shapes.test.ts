import { describe, it, expect } from "vitest";
import { parseDrawingShapes } from "../src/shapes.js";

const NS = `xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"`;
const doc = (body: string): string => `<?xml version="1.0"?><xdr:wsDr ${NS}>${body}</xdr:wsDr>`;
const from = (col: number, row: number): string =>
  `<xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`;
const to = `<xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`;
const sp = (macro: string | null, text: string, name = "Rectangle 1"): string =>
  `<xdr:sp ${macro === null ? "" : `macro="${macro}"`} textlink=""><xdr:nvSpPr><xdr:cNvPr id="2" name="${name}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr/><xdr:txBody><a:bodyPr/>${text}</xdr:txBody></xdr:sp>`;
const para = (t: string): string => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${t}</a:t></a:r></a:p>`;

describe("parseDrawingShapes (BTN-02)", () => {
  it("reads a shape in a twoCellAnchor with two paragraphs", () => {
    const xml = doc(
      `<xdr:twoCellAnchor>${from(7, 1)}${to}${sp("Module1.BuildActs", para("Build") + para("invoice"))}<xdr:clientData/></xdr:twoCellAnchor>`,
    );
    expect(parseDrawingShapes(xml)).toEqual([
      { caption: "Build invoice", anchor: "H2", macroRef: "Module1.BuildActs" },
    ]);
  });

  it("uses the name of a picture without text", () => {
    const pic = `<xdr:pic macro="Module1.Go"><xdr:nvPicPr><xdr:cNvPr id="3" name="Picture 3"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill/><xdr:spPr/></xdr:pic>`;
    const xml = doc(
      `<xdr:twoCellAnchor>${from(0, 0)}${to}${pic}<xdr:clientData/></xdr:twoCellAnchor>`,
    );
    expect(parseDrawingShapes(xml)).toEqual([
      { caption: "Picture 3", anchor: "A1", macroRef: "Module1.Go" },
    ]);
  });

  it("handles oneCellAnchor and gives null for absoluteAnchor", () => {
    const xml = doc(
      `<xdr:oneCellAnchor>${from(2, 4)}<xdr:ext cx="1" cy="1"/>${sp("A", para("One"))}<xdr:clientData/></xdr:oneCellAnchor>` +
        `<xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="1" cy="1"/>${sp("B", para("Two"))}<xdr:clientData/></xdr:absoluteAnchor>`,
    );
    expect(parseDrawingShapes(xml).map((s) => s.anchor)).toEqual(["C5", null]);
  });

  it("finds a shape in a group and in mc:AlternateContent, once", () => {
    const grp = `<xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="9" name="Group 9"/></xdr:nvGrpSpPr><xdr:grpSpPr/>${sp("InGroup", para("G"))}</xdr:grpSp>`;
    const alt = `<mc:AlternateContent><mc:Choice Requires="a14">${sp("InAlt", para("Alt"))}</mc:Choice><mc:Fallback>${sp("InAlt", para("Alt"))}</mc:Fallback></mc:AlternateContent>`;
    const xml = doc(
      `<xdr:twoCellAnchor>${from(1, 1)}${to}${grp}<xdr:clientData/></xdr:twoCellAnchor><xdr:twoCellAnchor>${from(3, 3)}${to}${alt}<xdr:clientData/></xdr:twoCellAnchor>`,
    );
    expect(parseDrawingShapes(xml)).toEqual([
      { caption: "G", anchor: "B2", macroRef: "InGroup" },
      { caption: "Alt", anchor: "D4", macroRef: "InAlt" },
    ]);
  });

  it("skips empty or missing macro attributes and graphic frames (BTN-08)", () => {
    const frame = `<xdr:graphicFrame macro="Chart.Go"><xdr:nvGraphicFramePr><xdr:cNvPr id="4" name="Chart 4"/></xdr:nvGraphicFramePr></xdr:graphicFrame>`;
    const xml = doc(
      `<xdr:twoCellAnchor>${from(0, 0)}${to}${sp("", para("a"))}${sp(null, para("b"))}${frame}<xdr:clientData/></xdr:twoCellAnchor>`,
    );
    expect(parseDrawingShapes(xml)).toEqual([]);
  });

  it("decodes entities and reads Cyrillic text", () => {
    const xml = doc(
      `<xdr:twoCellAnchor>${from(0, 0)}${to}${sp("M", para("Акты &amp; счета"))}<xdr:clientData/></xdr:twoCellAnchor>`,
    );
    expect(parseDrawingShapes(xml)[0].caption).toBe("Акты & счета");
  });
});
