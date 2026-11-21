/**
 * REF-01: PROJECTREFERENCES records of the dir stream (MS-OVBA 2.3.4.2.2).
 * The byte builders here are written from the specification and do not use dirWriter.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extractModules, extractProject, parseDirStream, readZip, writeDirStream } from "../src/index.js";

const REPO_ROOT = join(import.meta.dirname, "../../..");

const u16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
const utf16 = (s: string): number[] => Array.from(s).flatMap((c) => u16(c.charCodeAt(0)));
const cp1251 = (s: string): number[] =>
  Array.from(s, (c) => {
    const code = c.charCodeAt(0);
    if (code < 0x80) return code;
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0; // А..я
    throw new Error(`cp1251 helper: unsupported ${c}`);
  });
const rec = (id: number, data: number[]): number[] => [...u16(id), ...u32(data.length), ...data];

/** REFERENCENAME: Id | SizeOfName | Name | Reserved 0x003E | SizeOfNameUnicode | NameUnicode */
function nameRecord(name: string, mbcs: number[] = ascii(name)): number[] {
  return [...rec(0x0016, mbcs), ...rec(0x003e, utf16(name))];
}
/** REFERENCEREGISTERED: Id | Size | SizeOfLibid | Libid | Reserved1 (4) | Reserved2 (2) */
function registered(libid: string): number[] {
  return rec(0x000d, [...u32(libid.length), ...ascii(libid), ...u32(0), ...u16(0)]);
}
/** REFERENCEPROJECT: Id | Size | SizeOfLibidAbsolute | LibidAbsolute | SizeOfLibidRelative | LibidRelative | Major (4) | Minor (2) */
function project(absolute: string, relative: string): number[] {
  return rec(0x000e, [
    ...u32(absolute.length),
    ...ascii(absolute),
    ...u32(relative.length),
    ...ascii(relative),
    ...u32(1),
    ...u16(0),
  ]);
}
const NULL_LIBID = "*\\G{00000000-0000-0000-0000-000000000000}#0.0#0##";
/** REFERENCECONTROL, split into the records of the generic walk: 0x002F, [name], 0x0030. */
function control(extended: string, extendedName?: string): number[] {
  const twiddled = [...u32(NULL_LIBID.length), ...ascii(NULL_LIBID), ...u32(0), ...u16(0)];
  const tail = [...u32(extended.length), ...ascii(extended), ...u32(0), ...u16(0), ...new Array<number>(16).fill(7), ...u32(5)];
  return [...rec(0x002f, twiddled), ...(extendedName ? nameRecord(extendedName) : []), ...rec(0x0030, tail)];
}
/** REFERENCEORIGINAL: Id | SizeOfLibidOriginal | LibidOriginal (a CONTROL follows) */
function original(libid: string): number[] {
  return rec(0x0033, ascii(libid));
}

/** A complete dir stream with the given reference bytes between the project info and the modules. */
function dir(refs: number[], moduleNames: string[] = ["Module1"], codePage = 1252): Uint8Array {
  const out: number[] = [
    ...rec(0x0001, u32(1)),
    ...rec(0x0002, u32(0x409)),
    ...rec(0x0014, u32(0x409)),
    ...rec(0x0003, u16(codePage)),
    ...rec(0x0004, ascii("VBAProject")),
    ...rec(0x0005, []),
    ...rec(0x0040, []),
    ...rec(0x0006, []),
    ...rec(0x003d, []),
    ...rec(0x0007, u32(0)),
    ...rec(0x0008, u32(0)),
    ...u16(0x0009),
    ...u32(4),
    ...u32(1),
    ...u16(0),
    ...rec(0x000c, []),
    ...rec(0x003c, []),
    ...refs,
    ...rec(0x000f, u16(moduleNames.length)),
    ...rec(0x0013, [0xff, 0xff]),
  ];
  for (const m of moduleNames) {
    out.push(
      ...rec(0x0019, ascii(m)),
      ...rec(0x0047, utf16(m)),
      ...rec(0x001a, ascii(m)),
      ...rec(0x0032, utf16(m)),
      ...rec(0x0031, u32(0)),
      ...rec(0x0021, []),
      ...rec(0x002b, []),
    );
  }
  out.push(...rec(0x0010, []));
  return Uint8Array.from(out);
}

const VBSCRIPT_LIBID =
  "*\\G{3F4DACA0-160D-11D2-A8E9-00104B365C9F}#5.5#0#C:\\Windows\\System32\\vbscript.dll\\3#Microsoft VBScript Regular Expressions 5.5";
const STDOLE_LIBID = "*\\G{00020430-0000-0000-C000-000000000046}#2.0#0#C:\\Windows\\System32\\stdole2.tlb#OLE Automation";

describe("REF-01 parseDirStream: references", () => {
  it("a dir stream without references has none", () => {
    const r = parseDirStream(dir([]));
    expect(r.references).toEqual([]);
    expect(r.referenceProblems).toEqual([]);
    expect(r.modules.map((m) => m.name)).toEqual(["Module1"]);
  });

  it("REFERENCENAME + REFERENCEREGISTERED", () => {
    const r = parseDirStream(dir([...nameRecord("VBScript_RegExp_55"), ...registered(VBSCRIPT_LIBID)]));
    expect(r.references).toEqual([{ name: "VBScript_RegExp_55", kind: "registered", libid: VBSCRIPT_LIBID }]);
  });

  it("REFERENCEPROJECT reports LibidAbsolute", () => {
    const r = parseDirStream(dir([...nameRecord("Helper"), ...project("*\\CC:\\libs\\helper.xlam", "*\\H..\\libs\\helper.xlam")]));
    expect(r.references).toEqual([{ name: "Helper", kind: "project", libid: "*\\CC:\\libs\\helper.xlam" }]);
  });

  it("REFERENCECONTROL reports LibidExtended and the leading name", () => {
    const ext = "*\\wC:\\Windows\\System32\\mscomctl.ocx#MSComctlLib";
    const r = parseDirStream(dir([...nameRecord("MSComctlLib"), ...control(ext)]));
    expect(r.references).toEqual([{ name: "MSComctlLib", kind: "control", libid: ext }]);
  });

  it("REFERENCECONTROL with a NameRecordExtended: the leading name wins", () => {
    const ext = "*\\wC:\\x\\ctl.ocx#Ctl";
    const r = parseDirStream(dir([...nameRecord("Leading"), ...control(ext, "Extended")]));
    expect(r.references).toEqual([{ name: "Leading", kind: "control", libid: ext }]);
    expect(r.modules).toHaveLength(1);
  });

  it("REFERENCECONTROL with only an extended name uses it", () => {
    const ext = "*\\wC:\\x\\ctl.ocx#Ctl";
    const r = parseDirStream(dir([...control(ext, "OnlyExtended")]));
    expect(r.references).toEqual([{ name: "OnlyExtended", kind: "control", libid: ext }]);
  });

  it("the extended name does not leak into the next reference", () => {
    const r = parseDirStream(dir([...nameRecord("A"), ...control("*\\wA", "ExtA"), ...registered(STDOLE_LIBID)]));
    expect(r.references.map((x) => [x.name, x.kind])).toEqual([
      ["A", "control"],
      ["", "registered"],
    ]);
  });

  it("REFERENCEORIGINAL followed by its CONTROL is one control reference", () => {
    const ext = "*\\wC:\\x\\ctl.ocx#Ctl";
    const r = parseDirStream(dir([...nameRecord("Ctl"), ...original("*\\G{1}#1.0#0#c:\\orig.tlb#Orig"), ...control(ext)]));
    expect(r.references).toEqual([{ name: "Ctl", kind: "control", libid: ext }]);
  });

  it("several references come in file order", () => {
    const r = parseDirStream(
      dir([
        ...nameRecord("stdole"),
        ...registered(STDOLE_LIBID),
        ...nameRecord("VBScript_RegExp_55"),
        ...registered(VBSCRIPT_LIBID),
        ...nameRecord("Helper"),
        ...project("*\\CC:\\h.xlam", "*\\H.\\h.xlam"),
      ]),
    );
    expect(r.references.map((x) => `${x.kind}:${x.name}`)).toEqual([
      "registered:stdole",
      "registered:VBScript_RegExp_55",
      "project:Helper",
    ]);
  });

  it("a reference without a name record has an empty name", () => {
    const r = parseDirStream(dir([...registered(STDOLE_LIBID)]));
    expect(r.references).toEqual([{ name: "", kind: "registered", libid: STDOLE_LIBID }]);
  });

  it("the Unicode part replaces the MBCS name (Cyrillic, code page 1251)", () => {
    const name = "Библиотека";
    const r = parseDirStream(dir([...nameRecord(name, cp1251(name)), ...registered(STDOLE_LIBID)], ["Module1"], 1251));
    expect(r.references[0]!.name).toBe(name);
  });

  it("the MBCS name is decoded in the project code page when there is no Unicode part", () => {
    const name = "Библиотека";
    const r = parseDirStream(dir([...rec(0x0016, cp1251(name)), ...registered(STDOLE_LIBID)], ["Module1"], 1251));
    expect(r.references[0]!.name).toBe(name);
  });

  it("a damaged reference is left out, reported, and the modules are intact", () => {
    // SizeOfLibid says 200 but the record has 10 bytes.
    const bad = rec(0x000d, [...u32(200), ...ascii("short")]);
    const r = parseDirStream(dir([...nameRecord("Bad"), ...bad, ...nameRecord("Good"), ...registered(STDOLE_LIBID)], ["A", "B"]));
    expect(r.references).toEqual([{ name: "Good", kind: "registered", libid: STDOLE_LIBID }]);
    expect(r.referenceProblems).toHaveLength(1);
    expect(r.referenceProblems[0]).toMatch(/0x000d.*offset \d+/);
    expect(r.modules.map((m) => m.name)).toEqual(["A", "B"]);
  });

  it("a control that is never closed is reported", () => {
    const head = control("*\\wX").slice(0, rec(0x002f, [...u32(NULL_LIBID.length), ...ascii(NULL_LIBID), ...u32(0), ...u16(0)]).length);
    const r = parseDirStream(dir([...nameRecord("Open"), ...head]));
    expect(r.references).toEqual([]);
    expect(r.referenceProblems).toHaveLength(1);
    expect(r.modules).toHaveLength(1);
  });

  it("property: well-framed reference records with random contents never change the modules", () => {
    const refRecord = fc
      .tuple(
        fc.constantFrom(0x0016, 0x003e, 0x000d, 0x000e, 0x002f, 0x0030, 0x0033),
        fc.uint8Array({ maxLength: 40 }),
      )
      .map(([id, data]) => rec(id, Array.from(data)));
    fc.assert(
      fc.property(fc.array(refRecord, { maxLength: 8 }), (records) => {
        const r = parseDirStream(dir(records.flat(), ["A", "B"]));
        expect(r.modules.map((m) => m.name)).toEqual(["A", "B"]);
        for (const ref of r.references) expect(["registered", "project", "control"]).toContain(ref.kind);
      }),
      { numRuns: 300 },
    );
  });
});

describe("REF-01 existing fixtures: module list unchanged", () => {
  const srcRoot = join(REPO_ROOT, "fixtures", "src");
  const names = readdirSync(srcRoot)
    .filter((n) => statSync(join(srcRoot, n)).isDirectory())
    .sort();

  for (const name of names) {
    it(`${name}: modules are the .bas files, references only when cells.json has them`, () => {
      const xlsm = join(REPO_ROOT, "fixtures", "build", `${name}.xlsm`);
      expect(existsSync(xlsm), `${name}.xlsm not found, run npm run fixtures:build`).toBe(true);
      const bytes = new Uint8Array(readFileSync(xlsm));
      const bas = readdirSync(join(srcRoot, name))
        .filter((f) => f.endsWith(".bas"))
        .map((f) => f.replace(/\.bas$/, ""))
        .sort();
      expect(extractModules(bytes).map((m) => m.name)).toEqual(bas);
      const cells = JSON.parse(readFileSync(join(srcRoot, name, "cells.json"), "utf8")) as {
        references?: Array<{ name: string; libid: string }>;
      };
      const project = extractProject(bytes);
      expect(project.referenceProblems).toEqual([]);
      expect(project.references.map((r) => ({ name: r.name, libid: r.libid }))).toEqual(cells.references ?? []);
    });
  }
});

describe("REF-02 writeDirStream: references", () => {
  const bytes = (s: string): Uint8Array => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));
  const modules = [
    { name: "Module1", nameMbcs: bytes("Module1") },
    { name: "Two", nameMbcs: bytes("Two") },
  ];

  it("references written are read back with name and libid, modules unchanged", () => {
    const out = writeDirStream({
      codePage: 1252,
      projectName: "P",
      modules,
      references: [
        { name: "VBScript_RegExp_55", nameMbcs: bytes("VBScript_RegExp_55"), libidMbcs: bytes(VBSCRIPT_LIBID) },
        { name: "stdole", nameMbcs: bytes("stdole"), libidMbcs: bytes(STDOLE_LIBID) },
      ],
    });
    const r = parseDirStream(out);
    expect(r.references).toEqual([
      { name: "VBScript_RegExp_55", kind: "registered", libid: VBSCRIPT_LIBID },
      { name: "stdole", kind: "registered", libid: STDOLE_LIBID },
    ]);
    expect(r.referenceProblems).toEqual([]);
    expect(r.modules.map((m) => m.name)).toEqual(["Module1", "Two"]);
  });

  it("without references the bytes are those of the writer before this change", () => {
    // sha256 of the output of the previous writer for exactly these options (captured from HEAD).
    const out = writeDirStream({ codePage: 1252, projectName: "P", modules });
    expect(createHash("sha256").update(out).digest("hex")).toBe(
      "59bc4119010e37810f88df391679962284efd3c4a5da43e9bbb07683f6cf6bda",
    );
    expect(writeDirStream({ codePage: 1252, projectName: "P", modules, references: [] })).toEqual(out);
  });
});

describe("REF-02 builder: existing fixtures keep their content", () => {
  it("a fresh build has the same ZIP entries as fixtures/build for every fixture (and the same bytes for vbscript_deps)", () => {
    const out = mkdtempSync(join(tmpdir(), "necromancer-fixtures-"));
    try {
      execFileSync("npx", ["vite-node", "fixtures/build/build.ts"], {
        cwd: REPO_ROOT,
        env: { ...process.env, FIXTURES_OUT_DIR: out },
        stdio: "pipe",
      });
      const names = readdirSync(join(REPO_ROOT, "fixtures", "build")).filter((f) => f.endsWith(".xlsm"));
      expect(names).toContain("vbscript_deps.xlsm");
      for (const f of names) {
        const committed = new Uint8Array(readFileSync(join(REPO_ROOT, "fixtures", "build", f)));
        const fresh = new Uint8Array(readFileSync(join(out, f)));
        // The ZIP entry dates of older committed files differ; the content of every entry must not.
        const a = readZip(committed);
        const b = readZip(fresh);
        expect([...b.keys()].sort(), f).toEqual([...a.keys()].sort());
        for (const [entry, data] of a) expect(b.get(entry), `${f}:${entry}`).toEqual(data);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);

  it("vbscript_deps: three modules with the sources of the .bas files and the reference of the table", () => {
    const bytes = new Uint8Array(readFileSync(join(REPO_ROOT, "fixtures", "build", "vbscript_deps.xlsm")));
    const p = extractProject(bytes);
    expect(p.modules.map((m) => m.name)).toEqual(["EarlyBound", "LateBound", "Nightly"]);
    for (const m of p.modules) {
      const bas = readFileSync(join(REPO_ROOT, "fixtures", "src", "vbscript_deps", `${m.name}.bas`), "utf8");
      expect(m.source.replace(/\r\n/g, "\n")).toBe(bas.replace(/\r\n/g, "\n"));
    }
    expect(p.references).toEqual([{ name: "VBScript_RegExp_55", kind: "registered", libid: VBSCRIPT_LIBID }]);
  });
});
