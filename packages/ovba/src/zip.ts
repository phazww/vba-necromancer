import { unzipSync } from "fflate";

/**
 * Read all entries of a ZIP archive (an .xlsm file is a ZIP).
 * Uses fflate, a small dependency-free inflater that works in the browser and in Node.
 * Returns a map from entry path to uncompressed bytes.
 */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const files = unzipSync(bytes);
  return new Map(Object.entries(files));
}

/** Kept for API compatibility with earlier code; fflate needs no initialisation. */
export function initZlibInflate(_inflate?: unknown): void {
  void _inflate;
}
