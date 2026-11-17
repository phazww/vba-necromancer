import { OVBADecompressError } from "./errors.js";

/**
 * Decompress an MS-OVBA compressed stream (MS-OVBA §2.4.1).
 * Input must start with the signature byte 0x01.
 *
 * Notes on the CompressedChunkHeader size field:
 *   compressedSize = (header & 0x0FFF) + 3
 * The compressor may produce chunks whose actual data is fewer than 3 bytes
 * (e.g., 1 flag byte + 1 literal = 2 bytes) for the last chunk of a stream.
 * In that case the size field wraps to 0xFFD or similar, making compressedSize
 * much larger than the actual data. The inner loop therefore terminates by
 * exhausting input.length rather than by reaching chunkEnd.
 */
export function decompress(input: Uint8Array): Uint8Array {
  if (input.length === 0 || input[0] !== 0x01) {
    throw new OVBADecompressError(
      `Invalid signature byte: expected 0x01, got 0x${(input[0] ?? 0).toString(16)}`,
      0,
    );
  }

  const output: number[] = [];
  let ip = 1; // skip signature byte

  while (ip < input.length) {
    // Read 2-byte CompressedChunkHeader (little-endian)
    if (ip + 1 >= input.length) {
      // Only 1 byte left — not enough for a header; this is a truncation error
      // only if there's a byte present that looks like a chunk start
      throw new OVBADecompressError("Truncated chunk header", ip);
    }
    const header = input[ip]! | (input[ip + 1]! << 8);
    ip += 2;

    // CompressedChunkSize = bits[0:11] + 3; this is the size of CompressedChunkData (after the 2-byte header).
    // Note: for compressors that emit < 3 bytes of chunk data (last partial chunk),
    // this value will be large (e.g., 4098) due to unsigned wrapping. The actual
    // termination is controlled by input.length.
    // CompressedChunkSize counts the whole chunk including this 2-byte header (MS-OVBA 2.4.1.1.5).
    const compressedSize = (header & 0x0fff) + 3;
    const isCompressed = (header >> 15) & 1;
    if (((header >> 12) & 0b111) !== 0b011) {
      throw new OVBADecompressError(
        `Invalid CompressedChunkSignature 0b${((header >> 12) & 0b111).toString(2)} (expected 0b011)`,
        ip - 2,
      );
    }

    const chunkStart = output.length; // decompressed buffer start of this chunk

    if (isCompressed === 0) {
      // Raw (uncompressed) chunk: exactly 4096 bytes follow
      if (ip + 4096 > input.length) {
        throw new OVBADecompressError("Truncated raw chunk", ip);
      }
      for (let i = 0; i < 4096; i++) {
        output.push(input[ip++]!);
      }
    } else {
      // Compressed chunk: ip is now pointing at CompressedChunkData[0]
      // chunkEnd is the nominal exclusive end (may exceed input.length for last chunk)
      const chunkEnd = ip - 2 + compressedSize;

      outer: while (ip < chunkEnd && ip < input.length) {
        const flagByte = input[ip++]!;

        for (let bit = 0; bit < 8; bit++) {
          // Stop at nominal chunk end or actual input end
          if (ip >= chunkEnd || ip >= input.length) break outer;

          const flag = (flagByte >> bit) & 1;

          if (flag === 0) {
            // Literal byte
            output.push(input[ip++]!);
          } else {
            // CopyToken: 2 bytes
            if (ip + 2 > input.length) {
              // Mid-copy-token truncation: this IS an error (not a natural end)
              throw new OVBADecompressError("Truncated copy token", ip);
            }
            if (ip + 2 > chunkEnd) {
              // Copy token straddles chunk boundary — treat as truncation
              throw new OVBADecompressError("Copy token extends past chunk end", ip);
            }
            const token = input[ip]! | (input[ip + 1]! << 8);
            ip += 2;

            // Determine length/offset field sizes from MS-OVBA §2.4.1.3.6 (CopyToken Help).
            //
            // The offset field occupies the HIGH bits of the 16-bit token; the length
            // field occupies the LOW bits.  When the decompressed chunk is small the
            // offset only needs few bits (small window), leaving more bits for length.
            // As the chunk grows, the offset field widens and the length field shrinks.
            //
            // difference = bytes already written to the current chunk (output.length - chunkStart)
            // bitCount   = number of bits in the OFFSET field (= 16 - bits in length field)
            const decompressedSize = output.length - chunkStart;

            let lengthMask: number;
            let offsetMask: number;
            let bitCount: number;

            if (decompressedSize <= 16) {
              lengthMask = 0x0fff;
              offsetMask = 0xf000;
              bitCount = 4;
            } else if (decompressedSize <= 32) {
              lengthMask = 0x07ff;
              offsetMask = 0xf800;
              bitCount = 5;
            } else if (decompressedSize <= 64) {
              lengthMask = 0x03ff;
              offsetMask = 0xfc00;
              bitCount = 6;
            } else if (decompressedSize <= 128) {
              lengthMask = 0x01ff;
              offsetMask = 0xfe00;
              bitCount = 7;
            } else if (decompressedSize <= 256) {
              lengthMask = 0x00ff;
              offsetMask = 0xff00;
              bitCount = 8;
            } else if (decompressedSize <= 512) {
              lengthMask = 0x007f;
              offsetMask = 0xff80;
              bitCount = 9;
            } else if (decompressedSize <= 1024) {
              lengthMask = 0x003f;
              offsetMask = 0xffc0;
              bitCount = 10;
            } else if (decompressedSize <= 2048) {
              lengthMask = 0x001f;
              offsetMask = 0xffe0;
              bitCount = 11;
            } else {
              // decompressedSize in range 2049..4096
              lengthMask = 0x000f;
              offsetMask = 0xfff0;
              bitCount = 12;
            }

            const length = (token & lengthMask) + 3;
            const offset = ((token & offsetMask) >> (16 - bitCount)) + 1;

            const copyPos = output.length - offset;
            if (copyPos < 0) {
              throw new OVBADecompressError(
                `CopyToken offset ${offset} references beyond window (window size: ${output.length - chunkStart})`,
                ip - 2,
              );
            }

            // Copy byte by byte (source may overlap destination — this is intentional RLE)
            for (let i = 0; i < length; i++) {
              output.push(output[copyPos + i]!);
            }
          }
        }
      }

      // Advance ip to the nominal end of this chunk.
      // If chunkEnd > input.length (last partial chunk), this terminates the outer loop.
      if (ip < chunkEnd) {
        ip = chunkEnd;
      }
    }
  }

  return new Uint8Array(output);
}
