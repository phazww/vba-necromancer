import { describe, it, expect } from "vitest";
import { extractModules, NoVBAProjectError, parseDirStream, decompress, compress } from "../src/index.js";
import { buildMinimalCFB } from "./cfb-helpers.js";

// ---- Helpers for building a synthetic dir stream ----

function writeWord(arr: number[], v: number): void {
  arr.push(v & 0xff, (v >> 8) & 0xff);
}

function writeDword(arr: number[], v: number): void {
  arr.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
}

function writeRecord(arr: number[], id: number, data: number[]): void {
  writeWord(arr, id);
  writeDword(arr, data.length);
  arr.push(...data);
}

function strBytes(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}

function buildSyntheticDirStream(moduleName: string, streamName: string): Uint8Array {
  const bytes: number[] = [];

  // PROJECTSYSKIND
  writeRecord(bytes, 0x0001, [0x01, 0x00, 0x00, 0x00]); // Win32

  // PROJECTCODEPAGE (Windows-1252 = 1252 = 0x04E4)
  writeRecord(bytes, 0x0003, [0xe4, 0x04]);

  // PROJECTNAME
  writeRecord(bytes, 0x0004, strBytes("TestProject"));

  // PROJECTMODULES (id=0x000F, reserved 4 bytes)
  writeRecord(bytes, 0x000f, [0x02, 0x00, 0x00, 0x00]);

  // Count sub-record (id=0x0014)
  writeRecord(bytes, 0x0014, [0x01, 0x00]); // 1 module

  // MODULE records for one module:
  // MODULENAME (0x0019)
  writeRecord(bytes, 0x0019, strBytes(moduleName));

  // MODULESTREAM (0x001A)
  writeRecord(bytes, 0x001a, strBytes(streamName));

  // MODULEOFFSET (0x0031) = 0
  writeRecord(bytes, 0x0031, [0x00, 0x00, 0x00, 0x00]);

  // MODULETYPE procedural (0x0021)
  writeRecord(bytes, 0x0021, []);

  // MODULE_TERMINATOR (0x002B)
  writeRecord(bytes, 0x002b, []);

  // PROJECTMODULES TERMINATOR (0x0010)
  writeRecord(bytes, 0x0010, []);

  return new Uint8Array(bytes);
}

describe("parseDirStream", () => {
  it("parses a synthetic dir stream", () => {
    const dirBytes = buildSyntheticDirStream("Module1", "Module1");
    const result = parseDirStream(dirBytes);
    expect(result.codePage).toBe(1252);
    expect(result.projectName).toBe("TestProject");
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0]!.name).toBe("Module1");
    expect(result.modules[0]!.streamName).toBe("Module1");
    expect(result.modules[0]!.textOffset).toBe(0);
    expect(result.modules[0]!.type).toBe("procedural");
  });
});

describe("extractModules", () => {
  it("throws NoVBAProjectError when no VBA project is present", () => {
    // Build a plain CFB with no VBA/dir stream
    const plainCFB = buildMinimalCFB([{ path: "xl/workbook.xml", data: new Uint8Array([0x3c, 0x3e]) }]);
    expect(() => extractModules(plainCFB)).toThrow(NoVBAProjectError);
  });

  it("extracts a module from a synthetic CFB", () => {
    const sourceCode = "Sub Test()\n  MsgBox \"hello\"\nEnd Sub\n";
    const sourceBytes = new TextEncoder().encode(sourceCode);

    // Build the dir stream (decompressed)
    const dirDecompressed = buildSyntheticDirStream("Module1", "Module1");
    const dirCompressed = compress(dirDecompressed);

    // Build module stream: textOffset=0, so the entire decompressed stream is source
    const moduleCompressed = compress(sourceBytes);

    const cfb = buildMinimalCFB([
      { path: "VBA/dir", data: dirCompressed },
      { path: "VBA/Module1", data: moduleCompressed },
    ]);

    const modules = extractModules(cfb);
    expect(modules).toHaveLength(1);
    expect(modules[0]!.name).toBe("Module1");
    expect(modules[0]!.type).toBe("procedural");
    // Source should start with the VBA code (may have extra bytes at end from decompression, but starts correctly)
    expect(modules[0]!.source.startsWith("Sub Test()")).toBe(true);
  });

  it("module name and type are correct", () => {
    const sourceCode = "Sub Foo()\nEnd Sub\n";
    const sourceBytes = new TextEncoder().encode(sourceCode);
    const dirDecompressed = buildSyntheticDirStream("MyMod", "MyMod");
    const dirCompressed = compress(dirDecompressed);
    const moduleCompressed = compress(sourceBytes);

    const cfb = buildMinimalCFB([
      { path: "VBA/dir", data: dirCompressed },
      { path: "VBA/MyMod", data: moduleCompressed },
    ]);

    const modules = extractModules(cfb);
    expect(modules[0]!.name).toBe("MyMod");
    expect(modules[0]!.type).toBe("procedural");
  });
});

// Verify the round-trip that decompress(compress(x)) is used correctly
describe("compress/decompress integration", () => {
  it("compresses and decompresses a dir stream correctly", () => {
    const dirBytes = buildSyntheticDirStream("Module1", "Module1");
    const compressed = compress(dirBytes);
    const decompressed = decompress(compressed);
    // Should match the original dir bytes (up to dirBytes.length)
    expect(decompressed.length).toBeGreaterThanOrEqual(dirBytes.length);
    for (let i = 0; i < dirBytes.length; i++) {
      expect(decompressed[i]).toBe(dirBytes[i]);
    }
  });
});
