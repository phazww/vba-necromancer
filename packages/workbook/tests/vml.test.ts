import { describe, it, expect } from "vitest";
import { parseVmlButtons } from "../src/vml.js";

const HEAD = `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>
<v:shapetype id="_x0000_t201" coordsize="21600,21600" o:spt="201" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/></v:shapetype>`;

function shape(opts: {
  id?: string;
  caption?: string;
  type?: string;
  macro?: string | null;
  client?: string;
}): string {
  const macro =
    opts.macro === null
      ? ""
      : `<x:FmlaMacro>${opts.macro ?? "[0]!Module1.BuildActs"}</x:FmlaMacro>`;
  return `<v:shape id="${opts.id ?? "Button 1"}" o:spid="_x0000_s1025" type="#_x0000_t201" style="position:absolute" o:button="t" fillcolor="buttonFace [67]">
<v:textbox style="mso-direction-alt:auto" o:singleclick="f"><div style="text-align:center">${opts.caption ?? '<font face="Calibri" size="220" color="auto">Build</font>'}</div></v:textbox>
<x:ClientData ObjectType="${opts.type ?? "Button"}">${opts.client ?? "<x:Anchor>7, 15, 1, 4, 9, 15, 3, 4</x:Anchor><x:PrintObject>False</x:PrintObject><x:AutoFill>False</x:AutoFill><x:Row>1</x:Row><x:Column>7</x:Column>"}${macro}<x:TextHAlign>Center</x:TextHAlign></x:ClientData></v:shape>`;
}
const doc = (...shapes: string[]): string => `${HEAD}${shapes.join("\n")}</xml>`;

describe("parseVmlButtons (BTN-01)", () => {
  it("reads a button as Excel writes it", () => {
    expect(parseVmlButtons(doc(shape({})))).toEqual([
      { caption: "Build", anchor: "H2", macroRef: "[0]!Module1.BuildActs" },
    ]);
  });

  it("falls back to x:Row and x:Column, and to null", () => {
    const withRow = shape({ client: "<x:Row>4</x:Row><x:Column>2</x:Column>" });
    const none = shape({ client: "<x:AutoFill>False</x:AutoFill>" });
    const out = parseVmlButtons(doc(withRow, none));
    expect(out.map((b) => b.anchor)).toEqual(["C5", null]);
  });

  it("reads a caption with nested font, an unclosed <br>, entities and extra whitespace", () => {
    const caption =
      '<font face="Calibri">  Build\n   <font color="red">the</font><br>invoice &amp; log</font>';
    expect(parseVmlButtons(doc(shape({ caption })))[0].caption).toBe("Build the invoice & log");
  });

  it("reads a Cyrillic caption", () => {
    expect(
      parseVmlButtons(
        doc(shape({ caption: "<font>Сформировать акты</font>", macro: "Module1.BuildActs" })),
      )[0],
    ).toMatchObject({
      caption: "Сформировать акты",
      macroRef: "Module1.BuildActs",
    });
  });

  it("uses the shape id when there is no caption", () => {
    expect(parseVmlButtons(doc(shape({ caption: "" })))[0].caption).toBe("_x0000_s1025");
  });

  it("ignores other object types and buttons without a macro (BTN-08)", () => {
    const out = parseVmlButtons(
      doc(
        shape({ type: "Drop" }),
        shape({ type: "Checkbox" }),
        shape({ macro: null }),
        shape({ macro: "  " }),
        shape({ caption: "Real" }),
      ),
    );
    expect(out.map((b) => b.caption)).toEqual(["Real"]);
  });

  it("keeps document order for two buttons and returns the macro text untouched", () => {
    const out = parseVmlButtons(
      doc(
        shape({ caption: "One", macro: "[0]!Module1.A" }),
        shape({ caption: "Two", macro: "'Book.xlsm'!B" }),
      ),
    );
    expect(out.map((b) => [b.caption, b.macroRef])).toEqual([
      ["One", "[0]!Module1.A"],
      ["Two", "'Book.xlsm'!B"],
    ]);
  });
});
