import { describe, it, expect } from "vitest";
import { parseCFB, CFBFormatError } from "../src/index.js";
import { buildMinimalCFB } from "./cfb-helpers.js";

describe("parseCFB", () => {
  it("throws CFBFormatError for wrong magic bytes", () => {
    const badBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, ...new Uint8Array(512)]);
    expect(() => parseCFB(badBytes)).toThrow(CFBFormatError);
  });

  it("throws CFBFormatError for file that is too small", () => {
    const tiny = new Uint8Array(16);
    expect(() => parseCFB(tiny)).toThrow(CFBFormatError);
  });

  it("parses a minimal CFB with a single stream", () => {
    const streamData = new Uint8Array([1, 2, 3, 4, 5]);
    const cfb = buildMinimalCFB([{ path: "TestStream", data: streamData }]);
    const result = parseCFB(cfb);
    expect(result.streams.has("TestStream")).toBe(true);
    const data = result.streams.get("TestStream")!;
    expect(Array.from(data)).toEqual([1, 2, 3, 4, 5]);
  });

  it("parses a minimal CFB with a stream inside a storage", () => {
    const streamData = new Uint8Array([10, 20, 30]);
    const cfb = buildMinimalCFB([{ path: "VBA/dir", data: streamData }]);
    const result = parseCFB(cfb);
    expect(result.streams.has("VBA/dir")).toBe(true);
    const data = result.streams.get("VBA/dir")!;
    expect(Array.from(data)).toEqual([10, 20, 30]);
  });

  it("parses a stream split across multiple FAT sectors", () => {
    // 3 sectors worth of data (512 * 3 = 1536 bytes)
    const bigData = new Uint8Array(1536);
    for (let i = 0; i < bigData.length; i++) bigData[i] = i & 0xff;
    const cfb = buildMinimalCFB([{ path: "BigStream", data: bigData }]);
    const result = parseCFB(cfb);
    expect(result.streams.has("BigStream")).toBe(true);
    const data = result.streams.get("BigStream")!;
    expect(data.length).toBe(1536);
    for (let i = 0; i < 1536; i++) {
      expect(data[i]).toBe(i & 0xff);
    }
  });

  it("parses CFB with multiple streams in a storage", () => {
    const cfb = buildMinimalCFB([
      { path: "VBA/dir", data: new Uint8Array([1, 2]) },
      { path: "VBA/Module1", data: new Uint8Array([3, 4, 5]) },
    ]);
    const result = parseCFB(cfb);
    expect(result.streams.has("VBA/dir")).toBe(true);
    expect(result.streams.has("VBA/Module1")).toBe(true);
    expect(Array.from(result.streams.get("VBA/dir")!)).toEqual([1, 2]);
    expect(Array.from(result.streams.get("VBA/Module1")!)).toEqual([3, 4, 5]);
  });
});
