/**
 * Fixture builder — reads fixtures/src/<name>/ and writes fixtures/build/<name>.xlsm.
 *
 * Each .xlsm is a ZIP archive containing:
 *   [Content_Types].xml
 *   _rels/.rels
 *   xl/workbook.xml
 *   xl/_rels/workbook.xml.rels
 *   xl/sharedStrings.xml
 *   xl/worksheets/sheet<n>.xml  (one per sheet)
 *   xl/worksheets/_rels/sheet<n>.xml.rels, xl/drawings/vmlDrawing<k>.vml
 *                               (only for sheets with `buttons` in cells.json: Form Control buttons)
 *   xl/vbaProject.bin            (CFB with VBA project)
 *
 * xl/vbaProject.bin is a Compound File Binary whose VBA/ storage contains:
 *   VBA/_VBA_PROJECT   (p-code placeholder, 7 bytes)
 *   VBA/dir            (compressed dir stream)
 *   VBA/Module1        (compressed module source, encoded in the project code page)
 *   VBA/PROJECT        (plain-text project summary)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { zipSync } from "fflate";
import * as CFB from "cfb";
import { compress } from "../../packages/ovba/src/compress.js";
import { writeDirStream } from "../../packages/ovba/src/dirWriter.js";

// ---------------------------------------------------------------------------
// CP1251 encoding table (Unicode → byte).  Only needed when codePage === 1251.
// Generated from the Windows-1251 code page (characters at 0x80–0xFF).
// ---------------------------------------------------------------------------
const CP1251_HIGH: Readonly<number[]> = [
  0x0402, 0x0403, 0x201a, 0x0453, 0x201e, 0x2026, 0x2020, 0x2021, 0x20ac, 0x2030, 0x0409, 0x2039, 0x040a, 0x040c,
  0x040b, 0x040f, 0x0452, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0xfffd, 0x2122, 0x0459, 0x203a,
  0x045a, 0x045c, 0x045b, 0x045f, 0x00a0, 0x040e, 0x045e, 0x0408, 0x00a4, 0x0490, 0x00a6, 0x00a7, 0x0401, 0x00a9,
  0x0404, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x0407, 0x00b0, 0x00b1, 0x0406, 0x0456, 0x0491, 0x00b5, 0x00b6, 0x00b7,
  0x0451, 0x2116, 0x0454, 0x00bb, 0x0458, 0x0405, 0x0455, 0x0457,
  // Cyrillic А–я + ё:
  0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417, 0x0418, 0x0419, 0x041a, 0x041b, 0x041c, 0x041d,
  0x041e, 0x041f, 0x0420, 0x0421, 0x0422, 0x0423, 0x0424, 0x0425, 0x0426, 0x0427, 0x0428, 0x0429, 0x042a, 0x042b,
  0x042c, 0x042d, 0x042e, 0x042f, 0x0430, 0x0431, 0x0432, 0x0433, 0x0434, 0x0435, 0x0436, 0x0437, 0x0438, 0x0439,
  0x043a, 0x043b, 0x043c, 0x043d, 0x043e, 0x043f, 0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447,
  0x0448, 0x0449, 0x044a, 0x044b, 0x044c, 0x044d, 0x044e, 0x044f,
];

/** Build a lookup map from Unicode code point → CP1251 byte. */
function buildCp1251EncodeMap(): Map<number, number> {
  const map = new Map<number, number>();
  // 0x00–0x7F are identity
  for (let i = 0; i < 0x80; i++) map.set(i, i);
  // 0x80–0xFF from table
  for (let i = 0; i < CP1251_HIGH.length; i++) {
    const cp = CP1251_HIGH[i];
    if (cp !== undefined && cp !== 0xfffd) map.set(cp, 0x80 + i);
  }
  return map;
}

const CP1251_ENCODE_MAP = buildCp1251EncodeMap();

/** Encode a JS string to a Uint8Array using CP1251 or UTF-8 for other code pages. */
function encodeString(s: string, codePage: number): Uint8Array {
  if (codePage === 1252) {
    // windows-1252: identity in 0x00–0xFF range; JS charCodeAt gives the right byte for ASCII
    // For the VBA source (which is ASCII or Latin-1 range), this is fine.
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
    return bytes;
  }
  if (codePage === 1251) {
    const result: number[] = [];
    for (const ch of s) {
      const cp = ch.codePointAt(0) ?? 0x3f;
      const byte = CP1251_ENCODE_MAP.get(cp);
      result.push(byte !== undefined ? byte : 0x3f); // '?' for unmapped
    }
    return new Uint8Array(result);
  }
  // Fallback: UTF-8
  return new TextEncoder().encode(s);
}

// ---------------------------------------------------------------------------
// MS-OVBA compress/decompress (re-export from packages/ovba via direct import)
// We need to import the compress function.  Because this script runs with tsx
// (or via vite-node / node --loader ts) from the repo root, we use a relative
// path import.
// ---------------------------------------------------------------------------
// We inline a copy of the compress logic here to avoid any module resolution
// issues when running the script standalone with `tsx`.
// (The packages/ovba source is used by the library; for the build script we
//  just need the bytes.)

// MS-OVBA compression: the same implementation the extractor is tested against.

/** Build a decompressed dir stream for one procedural module. */
function buildCFB(streams: StreamEntry[]): Uint8Array {
  // Compound File Binary written by SheetJS cfb, a widely used implementation,
  // so the container is valid for third-party readers (olefile/olevba, Excel),
  // not only for our own parser.
  const cfb = CFB.utils.cfb_new();
  for (const s of streams) CFB.utils.cfb_add(cfb, "/" + s.path, s.data);
  CFB.utils.cfb_del(cfb, "/\u0001Sh33tJ5");
  const out = CFB.write(cfb, { type: "array" }) as number[] | Uint8Array;
  return out instanceof Uint8Array ? out : Uint8Array.from(out);
}

// ---------------------------------------------------------------------------

function buildProjectStream(projectName: string, moduleName: string, codePage: number): Uint8Array {
  const lines = [
    `ID="{00000000-0000-0000-0000-000000000000}"`,
    `Document=ThisWorkbook/&H00000000`,
    `Module=${moduleName}`,
    `Name=${projectName}`,
    `HelpContextID="0"`,
    `VersionCompatible32="393222000"`,
    `CMG="AAAAAAAA"`,
    `DPB="AAAAAAAA"`,
    `GC="AAAA"`,
  ];
  return encodeString(lines.join("\r\n") + "\r\n", codePage);
}

// ---------------------------------------------------------------------------
// ZIP container: fflate (a proven, dependency-free implementation) instead of a hand-written writer
// ---------------------------------------------------------------------------

function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = f.data;
  // A fixed modification time (local-time constructor, so the DOS fields are the same in every time zone):
  // building twice gives identical bytes.
  return zipSync(entries, { level: 6, mtime: new Date(2026, 0, 1, 0, 0, 0) });
}

// ---------------------------------------------------------------------------
// XLSM content builders
// ---------------------------------------------------------------------------

interface CellDef {
  row: number;
  col: number;
  value: string | number | boolean;
}

interface SheetDef {
  name: string;
  cells: CellDef[];
}

function colLetter(col: number): string {
  let s = "";
  while (col > 0) {
    const rem = (col - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

function cellRef(row: number, col: number): string {
  return `${colLetter(col)}${row}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildWorksheetXml(
  sheet: SheetDef,
  sharedStrings: string[],
  hasLegacyDrawing = false,
): string {
  // Map string values to shared string indices
  const ssIndex = new Map<string, number>();
  for (const c of sheet.cells) {
    if (typeof c.value === "string") {
      if (!ssIndex.has(c.value)) {
        ssIndex.set(c.value, sharedStrings.length);
        sharedStrings.push(c.value);
      }
    }
  }

  const rows = new Map<number, CellDef[]>();
  for (const c of sheet.cells) {
    if (!rows.has(c.row)) rows.set(c.row, []);
    rows.get(c.row)!.push(c);
  }

  let xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    (hasLegacyDrawing
      ? ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
      : "") +
    `>\n` +
    `  <sheetData>\n`;

  for (const [rowNum, cells] of Array.from(rows.entries()).sort(([a], [b]) => a - b)) {
    xml += `    <row r="${rowNum}">\n`;
    for (const c of cells.sort((a, b) => a.col - b.col)) {
      const ref = cellRef(c.row, c.col);
      if (typeof c.value === "number") {
        xml += `      <c r="${ref}"><v>${c.value}</v></c>\n`;
      } else if (typeof c.value === "boolean") {
        xml += `      <c r="${ref}" t="b"><v>${c.value ? 1 : 0}</v></c>\n`;
      } else {
        const idx = ssIndex.get(c.value)!;
        xml += `      <c r="${ref}" t="s"><v>${idx}</v></c>\n`;
      }
    }
    xml += `    </row>\n`;
  }

  xml += `  </sheetData>\n`;
  if (hasLegacyDrawing) xml += `  <legacyDrawing r:id="rId1"/>\n`;
  xml += `</worksheet>\n`;
  return xml;
}

function buildSharedStringsXml(strings: string[]): string {
  let xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">\n`;
  for (const s of strings) {
    xml += `  <si><t xml:space="preserve">${escapeXml(s)}</t></si>\n`;
  }
  xml += `</sst>\n`;
  return xml;
}

function buildWorkbookXml(sheets: SheetDef[]): string {
  let xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n` +
    `  <sheets>\n`;
  for (let i = 0; i < sheets.length; i++) {
    xml += `    <sheet name="${escapeXml(sheets[i]!.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>\n`;
  }
  xml += `  </sheets>\n</workbook>\n`;
  return xml;
}

function buildWorkbookRels(sheets: SheetDef[]): string {
  let xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n`;
  for (let i = 0; i < sheets.length; i++) {
    xml +=
      `  <Relationship Id="rId${i + 1}" ` +
      `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ` +
      `Target="worksheets/sheet${i + 1}.xml"/>\n`;
  }
  const vbaId = sheets.length + 1;
  xml +=
    `  <Relationship Id="rId${vbaId}" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vbaProject" ` +
    `Target="vbaProject.bin"/>\n`;
  const ssId = vbaId + 1;
  xml +=
    `  <Relationship Id="rId${ssId}" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" ` +
    `Target="sharedStrings.xml"/>\n`;
  xml += `</Relationships>\n`;
  return xml;
}

function buildRootRels(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    `  <Relationship Id="rId1" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ` +
    `Target="xl/workbook.xml"/>\n` +
    `</Relationships>\n`
  );
}

function buildContentTypes(sheets: SheetDef[], withVml: boolean): string {
  let xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
    `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
    `  <Default Extension="xml" ContentType="application/xml"/>\n` +
    `  <Default Extension="bin" ContentType="application/vnd.ms-office.activeX+xml"/>\n` +
    (withVml
      ? `  <Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>\n`
      : "") +
    `  <Override PartName="/xl/workbook.xml" ` +
    `ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>\n` +
    `  <Override PartName="/xl/vbaProject.bin" ` +
    `ContentType="application/vnd.ms-office.vbaProject"/>\n` +
    `  <Override PartName="/xl/sharedStrings.xml" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>\n`;
  for (let i = 0; i < sheets.length; i++) {
    xml +=
      `  <Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
      `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n`;
  }
  xml += `</Types>\n`;
  return xml;
}

// ---------------------------------------------------------------------------
// Form Control buttons (BTN-07): VML drawing, sheet relationships, legacyDrawing
// ---------------------------------------------------------------------------

interface ButtonDef {
  sheet: string;
  text: string;
  macro: string;
  /** Top-left cell, e.g. "H2". */
  anchor: string;
}

function parseAnchor(anchor: string): { row0: number; col0: number } {
  const m = /^([A-Z]{1,3})([1-9]\d*)$/.exec(anchor);
  if (!m) throw new Error(`Bad button anchor: ${anchor}`);
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row0: Number(m[2]) - 1, col0: col - 1 };
}

/** The VML drawing of one sheet, in the form Excel writes for legacy Form Control buttons. */
function buildVml(buttons: ButtonDef[], moduleName: string): string {
  let xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:x="urn:schemas-microsoft-com:office:excel">\n` +
    ` <o:shapelayout v:ext="edit">\n  <o:idmap v:ext="edit" data="1"/>\n </o:shapelayout>\n` +
    ` <v:shapetype id="_x0000_t201" coordsize="21600,21600" o:spt="201" path="m,l,21600r21600,l21600,xe">\n` +
    `  <v:stroke joinstyle="miter"/>\n  <v:path shadowok="f" o:extrusionok="f" strokeok="f" fillok="f" o:connecttype="rect"/>\n` +
    `  <o:lock v:ext="edit" shapetype="t"/>\n </v:shapetype>\n`;
  buttons.forEach((b, i) => {
    const { row0, col0 } = parseAnchor(b.anchor);
    const macro = b.macro.includes(".") ? b.macro : `${moduleName}.${b.macro}`;
    xml +=
      ` <v:shape id="_x0000_s${1025 + i}" type="#_x0000_t201" ` +
      `style="position:absolute;margin-left:0;margin-top:0;width:96pt;height:30pt;z-index:${i + 1};mso-wrap-style:tight" ` +
      `o:button="t" fillcolor="buttonFace [67]" strokecolor="windowText [64]" o:insetmode="auto">\n` +
      `  <v:fill color2="buttonFace [67]" o:detectmouseclick="t"/>\n` +
      `  <o:lock v:ext="edit" rotation="t"/>\n` +
      `  <v:textbox style="mso-direction-alt:auto" o:singleclick="f"><div style="text-align:center">` +
      `<font face="Calibri" size="220" color="auto">${escapeXml(b.text)}</font></div></v:textbox>\n` +
      `  <x:ClientData ObjectType="Button">\n` +
      `   <x:Anchor>${col0}, 15, ${row0}, 4, ${col0 + 2}, 15, ${row0 + 2}, 4</x:Anchor>\n` +
      `   <x:PrintObject>False</x:PrintObject>\n   <x:AutoFill>False</x:AutoFill>\n` +
      `   <x:FmlaMacro>${escapeXml(macro)}</x:FmlaMacro>\n` +
      `   <x:TextHAlign>Center</x:TextHAlign>\n   <x:TextVAlign>Center</x:TextVAlign>\n` +
      `   <x:Row>${row0}</x:Row>\n   <x:Column>${col0}</x:Column>\n` +
      `  </x:ClientData>\n </v:shape>\n`;
  });
  return xml + `</xml>\n`;
}

function buildSheetRels(vmlNumber: number): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    `  <Relationship Id="rId1" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" ` +
    `Target="../drawings/vmlDrawing${vmlNumber}.vml"/>\n` +
    `</Relationships>\n`
  );
}

// ---------------------------------------------------------------------------
// Main: build all fixtures
// ---------------------------------------------------------------------------

interface CellsJson {
  codePage?: number;
  sheets: SheetDef[];
  buttons?: ButtonDef[];
}

function buildFixture(fixtureName: string, srcDir: string, outDir: string): void {
  const cellsJson: CellsJson = JSON.parse(
    fs.readFileSync(path.join(srcDir, "cells.json"), "utf-8"),
  );
  const codePage = cellsJson.codePage ?? 1252;

  // Collect all .bas files
  const basFiles = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith(".bas"))
    .sort();

  if (basFiles.length === 0) {
    console.warn(`[${fixtureName}] No .bas files found; skipping`);
    return;
  }

  // For now we build a single-module VBA project (Module1.bas mandatory)
  // If multiple modules exist, we still only embed Module1.bas per TASK-09 scope.
  const moduleBasName = "Module1.bas";
  if (!basFiles.includes(moduleBasName)) {
    console.warn(`[${fixtureName}] ${moduleBasName} not found; using first .bas: ${basFiles[0]}`);
  }

  const basFile = basFiles.includes(moduleBasName) ? moduleBasName : basFiles[0]!;
  const moduleName = basFile.replace(/\.bas$/, "");
  const sourceUtf8 = fs.readFileSync(path.join(srcDir, basFile), "utf-8");

  // Encode source text in the project code page
  const sourceBytes = encodeString(sourceUtf8, codePage);

  // Build the compressed module stream (textOffset = 0, so compress directly)
  const compressedModule = compress(sourceBytes);

  // Build the dir stream
  const dirDecompressed = writeDirStream({
    codePage,
    projectName: "VBAProject",
    modules: [{ name: moduleName, nameMbcs: encodeString(moduleName, codePage) }],
  });
  const compressedDir = compress(dirDecompressed);

  // _VBA_PROJECT placeholder (7 bytes: 0x61 0x61 0x00 0x00 0x00 0xFF 0x09)
  // This is the minimum p-code header required by some readers.
  const vbaProjectPlaceholder = new Uint8Array([0x61, 0x61, 0x00, 0x00, 0x00, 0xff, 0x09]);

  // PROJECT stream (plain text, encoded in code page)
  const projectStream = buildProjectStream("VBAProject", moduleName, codePage);

  // Build the vbaProject.bin CFB
  const vbaBin = buildCFB([
    { path: "VBA/_VBA_PROJECT", data: vbaProjectPlaceholder },
    { path: "VBA/dir", data: compressedDir },
    { path: `VBA/${moduleName}`, data: compressedModule },
    { path: "PROJECT", data: projectStream },
  ]);

  // Build XLSM ZIP contents
  const buttons = cellsJson.buttons ?? [];
  for (const b of buttons) {
    if (!cellsJson.sheets.some((sh) => sh.name === b.sheet)) {
      throw new Error(`[${fixtureName}] button "${b.text}" names an unknown sheet: ${b.sheet}`);
    }
  }
  const sharedStrings: string[] = [];
  const worksheetXmls: { name: string; xml: string }[] = [];
  const drawingFiles: { name: string; data: Uint8Array }[] = [];
  const enc = (s: string) => new TextEncoder().encode(s);
  let vmlCount = 0;
  for (let i = 0; i < cellsJson.sheets.length; i++) {
    const sheet = cellsJson.sheets[i]!;
    const own = buttons.filter((b) => b.sheet === sheet.name);
    if (own.length > 0) {
      vmlCount++;
      drawingFiles.push({
        name: `xl/drawings/vmlDrawing${vmlCount}.vml`,
        data: enc(buildVml(own, moduleName)),
      });
      drawingFiles.push({
        name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        data: enc(buildSheetRels(vmlCount)),
      });
    }
    worksheetXmls.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      xml: buildWorksheetXml(sheet, sharedStrings, own.length > 0),
    });
  }

  const zipFiles: { name: string; data: Uint8Array }[] = [
    { name: "[Content_Types].xml", data: enc(buildContentTypes(cellsJson.sheets, vmlCount > 0)) },
    { name: "_rels/.rels", data: enc(buildRootRels()) },
    { name: "xl/workbook.xml", data: enc(buildWorkbookXml(cellsJson.sheets)) },
    { name: "xl/_rels/workbook.xml.rels", data: enc(buildWorkbookRels(cellsJson.sheets)) },
    { name: "xl/sharedStrings.xml", data: enc(buildSharedStringsXml(sharedStrings)) },
    ...worksheetXmls.map((w) => ({ name: w.name, data: enc(w.xml) })),
    ...drawingFiles,
    { name: "xl/vbaProject.bin", data: vbaBin },
  ];

  const xlsmBytes = buildZip(zipFiles);
  const outPath = path.join(outDir, `${fixtureName}.xlsm`);
  fs.writeFileSync(outPath, xlsmBytes);
  console.log(`[${fixtureName}] → ${outPath} (${xlsmBytes.length} bytes)`);
}

function main(): void {
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const srcRoot = path.join(repoRoot, "fixtures", "src");
  // FIXTURES_OUT_DIR lets a test build into a temporary directory instead of fixtures/build.
  const buildDir = process.env.FIXTURES_OUT_DIR ?? path.join(repoRoot, "fixtures", "build");

  fs.mkdirSync(buildDir, { recursive: true });

  const fixtureDirs = fs
    .readdirSync(srcRoot)
    .filter((name) => fs.statSync(path.join(srcRoot, name)).isDirectory())
    .sort();

  if (fixtureDirs.length === 0) {
    console.log("No fixture directories found in fixtures/src/");
    return;
  }

  for (const name of fixtureDirs) {
    buildFixture(name, path.join(srcRoot, name), buildDir);
  }

  console.log(`\nBuilt ${fixtureDirs.length} fixture(s).`);
}

main();
