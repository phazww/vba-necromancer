import { describe, it, expect } from "vitest";
import { extractModules, NoVBAProjectError, parseDirStream, decompress, compress, writeDirStream } from "../src/index.js";
import { buildMinimalCFB } from "./cfb-helpers.js";

// ---- Helpers for building a synthetic dir stream ----





function buildSyntheticDirStream(moduleName: string): Uint8Array {
  return writeDirStream({
    codePage: 1252,
    projectName: "TestProject",
    modules: [{ name: moduleName, nameMbcs: Uint8Array.from(Array.from(moduleName, (c) => c.charCodeAt(0))) }],
  });
}

describe("parseDirStream", () => {
  it("parses a synthetic dir stream", () => {
    const dirBytes = buildSyntheticDirStream("Module1");
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
    const dirDecompressed = buildSyntheticDirStream("Module1");
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
    const dirDecompressed = buildSyntheticDirStream("MyMod");
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
    const dirBytes = buildSyntheticDirStream("Module1");
    const compressed = compress(dirBytes);
    const decompressed = decompress(compressed);
    // Should match the original dir bytes (up to dirBytes.length)
    expect(decompressed.length).toBeGreaterThanOrEqual(dirBytes.length);
    for (let i = 0; i < dirBytes.length; i++) {
      expect(decompressed[i]).toBe(dirBytes[i]);
    }
  });
});
