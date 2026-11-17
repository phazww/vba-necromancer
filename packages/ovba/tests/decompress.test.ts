import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { decompress, compress, OVBADecompressError } from "../src/index.js";

function arrayEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

describe("decompress", () => {
  it("throws OVBADecompressError for wrong signature byte", () => {
    expect(() => decompress(new Uint8Array([0x02, 0x00, 0x00]))).toThrow(OVBADecompressError);
    expect(() => decompress(new Uint8Array([0x00]))).toThrow(OVBADecompressError);
    expect(() => decompress(new Uint8Array([]))).toThrow(OVBADecompressError);
  });

  it("throws OVBADecompressError for truncated chunk header", () => {
    // Signature byte present, then only 1 byte of chunk header (needs 2)
    expect(() => decompress(new Uint8Array([0x01, 0xab]))).toThrow(OVBADecompressError);
  });

  it("throws OVBADecompressError with numeric byteOffset for truncated copy token", () => {
    // Build a stream with a copy token flag (bit=1) but only 1 byte of the 2-byte copy token present.
    // header: isCompressed=1, size=10 (encodes 7, so chunkEnd = ip+10)
    // flagByte = 0x01 (bit 0 = copy token)
    // copy token: only 1 byte (truncated)
    // [sig, hdrLo, hdrHi, flagByte, copyTokenByte1] = 5 bytes
    const header = ((10 - 3) & 0x0fff) | 0xb000; // size=10
    const stream = new Uint8Array([
      0x01,            // signature
      header & 0xff,   // header low byte
      (header >> 8) & 0xff, // header high byte
      0x01,            // flagByte: bit 0 = copy token (1), rest = literals
      0x00,            // only 1 byte of copy token (need 2)
    ]);
    let err: OVBADecompressError | undefined;
    try {
      decompress(stream);
    } catch (e) {
      if (e instanceof OVBADecompressError) err = e;
    }
    expect(err).toBeInstanceOf(OVBADecompressError);
    expect(typeof err!.byteOffset).toBe("number");
  });

  it("decompresses an empty input after signature (no chunks)", () => {
    // Just the signature byte, no chunks — valid, produces empty output
    const result = decompress(new Uint8Array([0x01]));
    expect(result.length).toBe(0);
  });

  it("round-trips single byte", () => {
    const input = new Uint8Array([0x42]);
    const compressed = compress(input);
    const decompressed = decompress(compressed);
    expect(arrayEquals(decompressed, input)).toBe(true);
  });

  it("round-trips short byte sequences", () => {
    const cases: Uint8Array[] = [
      new Uint8Array([]),
      new Uint8Array([0]),
      new Uint8Array([0x41, 0x42, 0x43]),
      new Uint8Array(Array.from({ length: 100 }, (_, i) => i)),
      new Uint8Array(4096).fill(0xab),
    ];
    for (const input of cases) {
      const compressed = compress(input);
      const decompressed = decompress(compressed);
      expect(arrayEquals(decompressed, input)).toBe(true);
    }
  });

  it("property: round-trip compress/decompress for arbitrary byte arrays (10 000 runs)", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 65536 }), (bytes) => {
        const compressed = compress(bytes);
        const decompressed = decompress(compressed);
        return arrayEquals(decompressed, bytes);
      }),
      { numRuns: 10000 },
    );
  });

  it("property: compressed output is shorter than input for highly repetitive data", () => {
    // A compressor that only emits literals can never shrink the input (it adds overhead).
    // CopyTokens are the only way to achieve compression.  This property verifies that
    // the compressor emits back-references for inputs where repetition is obvious.
    fc.assert(
      fc.property(
        // Pick a short pattern (1–8 bytes) repeated many times — always fits in one chunk.
        fc.uint8Array({ minLength: 1, maxLength: 8 }),
        fc.integer({ min: 20, max: 100 }),
        (pattern, reps) => {
          const input = new Uint8Array(pattern.length * reps);
          for (let i = 0; i < reps; i++) {
            input.set(pattern, i * pattern.length);
          }
          const compressed = compress(input);
          // Compressed stream must round-trip correctly…
          const decompressed = decompress(compressed);
          if (!arrayEquals(decompressed, input)) return false;
          // …and must be strictly shorter than the input (CopyTokens were emitted).
          return compressed.length < input.length;
        },
      ),
      { numRuns: 1000 },
    );
  });
});
