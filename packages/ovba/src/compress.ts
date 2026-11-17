/**
 * MS-OVBA compressor (MS-OVBA §2.4.1).
 *
 * Emits a proper compressed stream with CopyTokens for repeated byte sequences,
 * matching the token encoding described in §2.4.1.3.6–2.4.1.3.9.
 *
 * Strategy: greedy LZ77 — for each position find the longest match in the
 * already-written part of the current chunk, emit a CopyToken if the match
 * is 3 bytes or longer (the minimum that benefits from a 2-byte token vs a
 * literal), otherwise emit a LiteralToken.
 *
 * Raw (uncompressed) chunks are used for full 4096-byte chunks when the
 * literal-only size would exceed the 4098-byte chunk limit AND no copy tokens
 * would help.  In practice the size check below is conservative; a fully
 * random 4096-byte source still produces a raw chunk.
 */

/** Return the CopyToken masks/bitCount for the current chunk position. */
function copyTokenHelp(decompressedSize: number): {
  lengthMask: number;
  offsetMask: number;
  bitCount: number;
  maxLength: number;
  maxOffset: number;
} {
  // MS-OVBA §2.4.1.3.6
  // bitCount = bits allocated to the OFFSET field (high bits of the 16-bit token).
  // The length field occupies the remaining low bits.
  // As the chunk grows, the window widens so offset needs more bits.
  let bitCount: number;
  if (decompressedSize <= 16) {
    bitCount = 4;
  } else if (decompressedSize <= 32) {
    bitCount = 5;
  } else if (decompressedSize <= 64) {
    bitCount = 6;
  } else if (decompressedSize <= 128) {
    bitCount = 7;
  } else if (decompressedSize <= 256) {
    bitCount = 8;
  } else if (decompressedSize <= 512) {
    bitCount = 9;
  } else if (decompressedSize <= 1024) {
    bitCount = 10;
  } else if (decompressedSize <= 2048) {
    bitCount = 11;
  } else {
    bitCount = 12;
  }

  const lengthBits = 16 - bitCount;
  const offsetMask = ((1 << bitCount) - 1) << lengthBits;
  const lengthMask = (1 << lengthBits) - 1;
  const maxOffset = 1 << bitCount; // offset field encodes offset-1, so max offset = 2^bitCount
  const maxLength = (1 << lengthBits) - 1 + 3; // length field encodes length-3

  return { lengthMask, offsetMask, bitCount, maxLength, maxOffset };
}

/** Encode one CopyToken (§2.4.1.3.7–3.9) given offset ≥ 1 and length ≥ 3. */
function encodeCopyToken(offset: number, length: number, decompressedSize: number): number {
  const { bitCount } = copyTokenHelp(decompressedSize);
  const lengthBits = 16 - bitCount;
  return ((offset - 1) << lengthBits) | (length - 3);
}

/**
 * Find the longest match for src[i..] within src[chunkStart..i].
 * Returns { offset, length } where offset ≥ 1 (distance back from i),
 * or null if no match of length ≥ 3 fits within constraints.
 */
function findMatch(
  src: Uint8Array,
  chunkStart: number,
  i: number,
  decompressedSize: number,
): { offset: number; length: number } | null {
  const { maxLength, maxOffset } = copyTokenHelp(decompressedSize);
  const windowStart = Math.max(chunkStart, i - maxOffset);
  const remaining = src.length - i;

  if (remaining < 3) return null;

  let bestOffset = 0;
  let bestLength = 0;

  for (let j = windowStart; j < i; j++) {
    const maxMatchLen = Math.min(maxLength, remaining);
    let len = 0;
    while (len < maxMatchLen && src[j + len] === src[i + len]) {
      len++;
    }
    if (len >= 3 && len > bestLength) {
      bestLength = len;
      bestOffset = i - j;
    }
  }

  return bestLength >= 3 ? { offset: bestOffset, length: bestLength } : null;
}

export function compress(input: Uint8Array): Uint8Array {
  const output: number[] = [0x01]; // SignatureByte

  if (input.length === 0) {
    return new Uint8Array(output);
  }

  let ip = 0;
  while (ip < input.length) {
    const chunkStart = ip;
    const chunkEnd = Math.min(ip + 4096, input.length);
    const chunkSize = chunkEnd - chunkStart;

    // For a full 4096-byte chunk use a raw chunk (literal encoding costs
    // ceil(4096/8)*9 = 4608 bytes which exceeds the 4098-byte chunk limit).
    if (chunkSize === 4096) {
      // Raw chunk header: isCompressed=0 (bit 15=0), size field = (4096-3)&0x0FFF = 0x0FFD
      output.push(0xfd);
      output.push(0x0f);
      for (let i = 0; i < 4096; i++) {
        output.push(input[chunkStart + i]!);
      }
      ip = chunkEnd;
      continue;
    }

    // Compressed chunk with LZ77 copy tokens.
    const chunkData: number[] = [];
    let i = chunkStart;

    while (i < chunkEnd) {
      // Build a group of up to 8 tokens.
      let flagByte = 0;
      const groupTokens: Array<{ isLiteral: true; byte: number } | { isLiteral: false; token: number }> = [];

      for (let bit = 0; bit < 8 && i < chunkEnd; bit++) {
        const decompressedSize = i - chunkStart;
        const match = findMatch(input, chunkStart, i, decompressedSize);

        if (match !== null) {
          // Emit CopyToken
          flagByte |= 1 << bit;
          const tokenWord = encodeCopyToken(match.offset, match.length, decompressedSize);
          groupTokens.push({ isLiteral: false, token: tokenWord });
          i += match.length;
        } else {
          // Emit LiteralToken
          groupTokens.push({ isLiteral: true, byte: input[i]! });
          i++;
        }
      }

      chunkData.push(flagByte);
      for (const t of groupTokens) {
        if (t.isLiteral) {
          chunkData.push(t.byte);
        } else {
          chunkData.push(t.token & 0xff);
          chunkData.push((t.token >> 8) & 0xff);
        }
      }
    }

    // Header: bits[0:11] = (chunkDataSize - 3) & 0x0FFF, bit[15] = 1 (isCompressed)
    const chunkDataSize = chunkData.length;
    const header = ((chunkDataSize - 3) & 0x0fff) | 0xb000;
    output.push(header & 0xff);
    output.push((header >> 8) & 0xff);
    for (const b of chunkData) {
      output.push(b);
    }

    ip = chunkEnd;
  }

  return new Uint8Array(output);
}
