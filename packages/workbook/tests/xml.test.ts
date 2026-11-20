import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { decodeEntities, scanXml } from "../src/xml.js";

describe("scanXml", () => {
  it("reads open, close, self-closing and text tokens", () => {
    expect(scanXml("<a><b/>hi</a>")).toEqual([
      { kind: "open", name: "a", attrs: {}, selfClosing: false },
      { kind: "open", name: "b", attrs: {}, selfClosing: true },
      { kind: "text", text: "hi" },
      { kind: "close", name: "a" },
    ]);
  });

  it("turns prefixed names into lower-cased local names", () => {
    const t = scanXml('<x:ClientData ObjectType="Button" r:Id="rId1"></x:ClientData>');
    expect(t[0]).toEqual({
      kind: "open",
      name: "clientdata",
      attrs: { objecttype: "Button", id: "rId1" },
      selfClosing: false,
    });
    expect(t[1]).toEqual({ kind: "close", name: "clientdata" });
  });

  it("reads attributes quoted with double quotes, single quotes or none", () => {
    const t = scanXml("<a p=\"1\" q='two words' r=3 s/>");
    expect(t[0]).toEqual({
      kind: "open",
      name: "a",
      attrs: { p: "1", q: "two words", r: "3", s: "" },
      selfClosing: true,
    });
  });

  it("keeps going after a <br> that is never closed", () => {
    const t = scanXml("<font>one<br>two</font><x:Row>1</x:Row>");
    expect(t.map((x) => (x.kind === "text" ? x.text : `${x.kind}:${x.name}`))).toEqual([
      "open:font",
      "one",
      "open:br",
      "two",
      "close:font",
      "open:row",
      "1",
      "close:row",
    ]);
  });

  it("skips comments and processing instructions, and returns CDATA as text", () => {
    const t = scanXml('<?xml version="1.0"?><!-- note --><a><![CDATA[1 < 2 &amp;]]></a>');
    expect(t).toEqual([
      { kind: "open", name: "a", attrs: {}, selfClosing: false },
      { kind: "text", text: "1 < 2 &amp;" },
      { kind: "close", name: "a" },
    ]);
  });

  it("decodes entities in text and attributes", () => {
    const t = scanXml('<a t="x &amp; y">&lt;&#1044;&#x414;&gt;</a>');
    expect(t[0]).toMatchObject({ attrs: { t: "x & y" } });
    expect(t[1]).toEqual({ kind: "text", text: "<ДД>" });
  });

  it("returns the earlier tokens when a tag is unterminated at the end", () => {
    const t = scanXml('<a><b x="1"');
    expect(t).toEqual([{ kind: "open", name: "a", attrs: {}, selfClosing: false }]);
    expect(scanXml("<a>text<").slice(0, 2)).toEqual([
      { kind: "open", name: "a", attrs: {}, selfClosing: false },
      { kind: "text", text: "text" },
    ]);
  });

  it("never throws on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string(), (s) => Array.isArray(scanXml(s))),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(
        fc
          .array(fc.constantFrom("<", ">", "/", "=", '"', "'", "a", " ", "&", "!", "-", "?", "["))
          .map((a) => a.join("")),
        (s) => Array.isArray(scanXml(s)),
      ),
      { numRuns: 300 },
    );
  });
});

describe("decodeEntities", () => {
  it("decodes the five named entities", () => {
    expect(decodeEntities("&amp;&lt;&gt;&quot;&apos;")).toBe("&<>\"'");
  });
  it("decodes decimal and hex references", () => {
    expect(decodeEntities("&#1044;&#x414;")).toBe("ДД");
  });
  it("leaves an unknown entity as written", () => {
    expect(decodeEntities("a &nbsp; b &#xZZ; &#99999999;")).toBe("a &nbsp; b &#xZZ; &#99999999;");
  });
});
