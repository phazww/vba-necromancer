import { describe, it, expect } from "vitest";
import { decompress } from "../src/index.js";

// Known-answer tests from the MS-OVBA specification, section 3.2.2 "Normal Compression Example".
// Source: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ovba/b6b8c482-a6bb-45e5-a476-098897a334cb
// Unlike the round-trip property test (whose reference compressor emits literals only),
// this container contains CopyTokens, so it exercises the back-reference path that real
// Excel files rely on.

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.trim().split(/\s+/).map((b) => parseInt(b, 16)));
}

describe("MS-OVBA spec examples", () => {
  it("3.2.2 Normal Compression Example decompresses to the documented string", () => {
    const compressed = hex(`
      01 2F B0 00 23 61 61 61 62 63 64 65 82 66 00 70
      61 67 68 69 6A 01 38 08 61 6B 6C 00 20 6D 6E 6F
      70 06 71 02 70 04 00 72 73 74 75 76 10 77 78 79
      7A 00 2C`);
    const expected = "#aaabcdefaaaaghijaaaaaklaaamnopqaaaaaaaaaaaarstuvwxyzaaa";
    const out = decompress(compressed);
    expect(new TextDecoder("latin1").decode(out)).toBe(expected);
  });
});
