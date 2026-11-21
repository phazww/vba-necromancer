/** VBS-01: the static VBScript readiness scan. */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { scanVbscript, VBSCRIPT_TEXTS } from "../src/index.js";

const scan = (source: string) => scanVbscript([{ name: "M", source }], []);
const kinds = (source: string) => scan(source).map((f) => `${f.kind}@${f.line}`);
const sub = (...body: string[]) => ["Sub Run()", ...body.map((b) => `    ${b}`), "End Sub"].join("\n");

const GUID_LIBID = "*\\G{3F4DACA0-160D-11D2-A8E9-00104B365C9F}#5.5#0#C:\\x\\other.dll\\3#Microsoft VBScript Regular Expressions 5.5";
const DLL_LIBID = "*\\G{00000000-0000-0000-0000-000000000000}#1.0#0#C:\\Windows\\SysWOW64\\VBScript.DLL#x";

describe("VBS-01 vbscript-reference", () => {
  const refs = (list: Array<[string, string, string]>) =>
    scanVbscript([], list.map(([name, kind, libid]) => ({ name, kind, libid })));

  it("matches vbscript.dll in any case", () => {
    expect(refs([["R", "registered", DLL_LIBID]])).toMatchObject([
      { kind: "vbscript-reference", module: null, line: null, reference: { name: "R", libid: DLL_LIBID } },
    ]);
  });
  it("matches the RegExp 5.5 GUID alone, in lower case too", () => {
    expect(refs([["R", "registered", GUID_LIBID]])).toHaveLength(1);
    expect(refs([["R", "registered", GUID_LIBID.toLowerCase()]])).toHaveLength(1);
  });
  it("ignores project and control references and unrelated libraries", () => {
    expect(refs([["R", "project", DLL_LIBID], ["C", "control", GUID_LIBID]])).toEqual([]);
    expect(refs([["stdole", "registered", "*\\G{00020430-0000-0000-C000-000000000046}#2.0#0#C:\\Windows\\System32\\stdole2.tlb#OLE Automation"]])).toEqual([]);
  });
  it("carries the VBS-01 text and keeps file order", () => {
    const f = refs([["A", "registered", DLL_LIBID], ["B", "registered", GUID_LIBID]]);
    expect(f.map((x) => x.reference?.name)).toEqual(["A", "B"]);
    expect(f[0]!.text).toBe(VBSCRIPT_TEXTS["vbscript-reference"]);
    expect(VBSCRIPT_TEXTS["vbscript-reference"]).toBe(
      "References the VBScript RegExp library. Breaks when VBScript is disabled, unless Office is version 2508 or later (RegExp is built into VBA from 2508).",
    );
  });
});

describe("VBS-01 vbscript-createobject", () => {
  it("finds the call in any case, with blanks, with VBA. and with a second argument", () => {
    expect(kinds(sub('Set re = CreateObject("VBScript.RegExp")'))).toEqual(["vbscript-createobject@2"]);
    expect(kinds(sub('Set re = createobject( "vbscript.REGEXP" )'))).toEqual(["vbscript-createobject@2"]);
    expect(kinds(sub('Set re = VBA.CreateObject("VBScript.RegExp")'))).toEqual(["vbscript-createobject@2"]);
    expect(kinds(sub('Set re = CreateObject("VBScript.RegExp", "srv")'))).toEqual(["vbscript-createobject@2"]);
  });
  it("reports the line of the call after earlier lines and continuations", () => {
    const src = ["Option Explicit", "", "Sub A()", "    x = 1 + _", "        2", '    Set re = CreateObject("VBScript.RegExp")', "End Sub"].join("\n");
    expect(kinds(src)).toEqual(["vbscript-createobject@6"]);
  });
  it("carries the VBS-01 text", () => {
    expect(scan(sub('Set re = CreateObject("VBScript.RegExp")'))[0]!.text).toBe(
      "Late-bound VBScript RegExp. Microsoft's guidance says this runs on Office 2508 and later, and on older builds only while VBScript is enabled.",
    );
  });
  it("does not see a name held in a variable or built by concatenation", () => {
    expect(scan(sub('p = "VBScript.RegExp"', "Set re = CreateObject(p)"))).toEqual([]);
    expect(scan(sub('Set re = CreateObject("VBScript." & "RegExp")'))).toEqual([]);
  });
  it("ignores a call on another object", () => {
    expect(scan(sub('Set re = obj.CreateObject("VBScript.RegExp")'))).toEqual([]);
  });
});

describe("VBS-01 external-vbs", () => {
  it("Shell with a .vbs literal, any case", () => {
    expect(kinds(sub('Shell "C:\\a\\b.vbs"'))).toEqual(["external-vbs@2"]);
    expect(kinds(sub('x = Shell("C:\\a\\B.VBS", 1)'))).toEqual(["external-vbs@2"]);
  });
  it("the fixture line: wscript.exe with a quoted .vbs path", () => {
    expect(kinds(sub('Shell "wscript.exe ""C:\\scripts\\nightly.vbs"""'))).toEqual(["external-vbs@2"]);
  });
  it("cscript as a word", () => {
    expect(kinds(sub('Shell "cscript //nologo run.js"'))).toEqual(["external-vbs@2"]);
  });
  it("a .vbs literal anywhere in a procedure that calls Shell", () => {
    expect(kinds(sub('p = "C:\\a.vbs"', "Shell p"))).toEqual(["external-vbs@2"]);
  });
  it("the same with CreateObject(\"WScript.Shell\")", () => {
    expect(kinds(sub('Set sh = CreateObject("WScript.Shell")', 'sh.Run "C:\\a.vbs"'))).toEqual(["external-vbs@3"]);
  });
  it("a .vbs literal in a procedure without Shell, or at module level, is not reported", () => {
    const src = ['Const S = "C:\\a.vbs"', "Sub A()", '    p = "C:\\b.vbs"', "End Sub", "Sub B()", '    Shell "notepad"', "End Sub"].join("\n");
    expect(scan(src)).toEqual([]);
  });
  it("two procedures are separate, even after Exit Sub and with a missing End Sub", () => {
    const src = ["Sub A()", "    If x Then Exit Sub", '    p = "a.vbs"', "End Sub", "Function F()", '    Shell "b.vbs"', "End Function"].join("\n");
    expect(kinds(src)).toEqual(["external-vbs@6"]);
    const noEnd = ["Sub A()", '    p = "a.vbs"', "Sub B()", "    Shell q", "End Sub"].join("\n");
    expect(scan(noEnd)).toEqual([]);
  });
  it("Property procedures count as procedures", () => {
    const src = ["Property Get P()", '    Shell "x.vbs"', "End Property"].join("\n");
    expect(kinds(src)).toEqual(["external-vbs@2"]);
  });
  it("carries the VBS-01 text", () => {
    expect(scan(sub('Shell "a.vbs"'))[0]!.text).toBe(
      "Runs an external VBScript file. This stops working once VBScript is disabled, on any Office version.",
    );
  });
});

describe("VBS-01 negatives", () => {
  it("Scripting.FileSystemObject and Scripting.Dictionary", () => {
    expect(scan(sub('Set f = CreateObject("Scripting.FileSystemObject")', 'Set d = CreateObject("Scripting.Dictionary")'))).toEqual([]);
  });
  it("WScript.Shell without a .vbs", () => {
    expect(scan(sub('Set sh = CreateObject("WScript.Shell")', 'sh.Run "notepad.exe"'))).toEqual([]);
  });
  it('a .vbs path followed by closing quotes is found (developer, 21 Nov)', () => {
    expect(kinds(sub('Shell "cmd /c ""C:\\a b\\nightly.vbs"""'))).toEqual(["external-vbs@2"]);
  });

  it('"report.vbsx" next to Shell', () => {
    expect(scan(sub('Shell "report.vbsx"'))).toEqual([]);
  });
  it("comments with ' and Rem that mention VBScript.RegExp and a .vbs file", () => {
    const src = [
      "Sub A()",
      "    ' Set re = CreateObject(\"VBScript.RegExp\")",
      "    Rem Shell \"a.vbs\"",
      '    Shell "notepad" \' was "x.vbs"',
      "End Sub",
    ].join("\n");
    expect(scan(src)).toEqual([]);
  });
  it("cscript inside a longer identifier or a longer word", () => {
    expect(scan(sub("mycscriptPath = 1", "Shell mycscriptPath"))).toEqual([]);
    expect(scan(sub('Shell "mycscript"'))).toEqual([]);
    expect(scan(sub('Shell "cscript2 x"'))).toEqual([]);
    expect(scan(sub('Shell "my_wscript"'))).toEqual([]);
  });
  it("Shell on another object", () => {
    expect(scan(sub('obj.Shell "a.vbs"'))).toEqual([]);
  });
});

describe("VBS-01 robustness", () => {
  it("scans a module that does not parse", () => {
    const src = "If If If\n" + sub('Set re = CreateObject("VBScript.RegExp")');
    expect(kinds(src)).toEqual(["vbscript-createobject@3"]);
  });
  it("Option Compare and Declare Function do not change lines or open procedures", () => {
    const src = ["Option Compare Text", 'Private Declare Function Sleep Lib "kernel32" (ByVal n As Long)', 'Const S = "a.vbs"', sub("Shell q")].join("\n");
    expect(scan(src)).toEqual([]);
  });
  it("modules come in input order, references first", () => {
    const out = scanVbscript(
      [
        { name: "B", source: sub('Shell "x.vbs"') },
        { name: "A", source: sub('Set re = CreateObject("VBScript.RegExp")') },
      ],
      [{ name: "R", kind: "registered", libid: DLL_LIBID }],
    );
    expect(out.map((f) => f.kind)).toEqual(["vbscript-reference", "external-vbs", "vbscript-createobject"]);
    expect(out.map((f) => f.module)).toEqual([null, "B", "A"]);
  });
  it("property: never throws on arbitrary source text", () => {
    fc.assert(fc.property(fc.string({ maxLength: 300 }), (s) => Array.isArray(scan(s))), { numRuns: 500 });
    fc.assert(
      fc.property(fc.array(fc.constantFrom("Sub ", "End ", "Shell ", '"a.vbs"', "CreateObject(", '"VBScript.RegExp"', ")", "\n", " ", "'", "Function ", "Exit "), { maxLength: 40 }), (parts) =>
        Array.isArray(scan(parts.join(""))),
      ),
      { numRuns: 500 },
    );
  });
});
