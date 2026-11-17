import { CFBFormatError } from "./errors.js";

export interface CFBFile {
  streams: Map<string, Uint8Array>;
}

// Sector IDs with special meanings
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;

const CFB_MAGIC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Parse a Compound File Binary (CFB/OLE2) file and return all streams. */
export function parseCFB(bytes: Uint8Array): CFBFile {
  if (bytes.length < 512) {
    throw new CFBFormatError("File too small to be a valid CFB", 0);
  }

  // Validate magic bytes
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== CFB_MAGIC[i]) {
      throw new CFBFormatError(
        `Invalid CFB magic bytes at offset ${i}: expected 0x${CFB_MAGIC[i]!.toString(16)}, got 0x${bytes[i]!.toString(16)}`,
        i,
      );
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Minor version at offset 24, major version at offset 26
  // const minorVersion = view.getUint16(24, true);
  const majorVersion = view.getUint16(26, true);

  // Sector size: offset 30 = power-of-2 exponent
  const sectorSizePow2 = view.getUint16(30, true);
  const sectorSize = 1 << sectorSizePow2;

  // Mini sector size: offset 32
  const miniSectorSizePow2 = view.getUint16(32, true);
  const miniSectorSize = 1 << miniSectorSizePow2;

  // Number of FAT sectors: offset 44
  const numFatSectors = view.getUint32(44, true);

  // First directory sector: offset 48
  const firstDirSector = view.getUint32(48, true);

  // Mini stream cutoff size: offset 56
  const miniStreamCutoff = view.getUint32(56, true);

  // First MiniFAT sector: offset 60
  const firstMiniFatSector = view.getUint32(60, true);

  // Number of MiniFAT sectors: offset 64
  const numMiniFatSectors = view.getUint32(64, true);

  // First DIFAT sector: offset 68
  const firstDifatSector = view.getUint32(68, true);

  // Number of DIFAT sectors: offset 72
  const numDifatSectors = view.getUint32(72, true);

  // DIFAT array in header: offsets 76-511 = 109 entries
  const headerDifat: number[] = [];
  for (let i = 0; i < 109; i++) {
    const v = view.getUint32(76 + i * 4, true);
    if (v === FREESECT) break;
    headerDifat.push(v);
  }

  // Helper: read sector data (sector 0 = bytes at offset sectorSize)
  const headerSize = majorVersion === 4 ? 4096 : 512;
  function sectorOffset(sectorId: number): number {
    return headerSize + sectorId * sectorSize;
  }

  // Build FAT from DIFAT
  // First collect all FAT sector IDs
  const fatSectorIds: number[] = [...headerDifat];

  if (numDifatSectors > 0) {
    let difatSector = firstDifatSector;
    while (difatSector !== ENDOFCHAIN && difatSector !== FREESECT) {
      const off = sectorOffset(difatSector);
      const entriesPerDifat = sectorSize / 4 - 1; // last entry is next DIFAT sector
      for (let i = 0; i < entriesPerDifat; i++) {
        const v = view.getUint32(off + i * 4, true);
        if (v === FREESECT) break;
        fatSectorIds.push(v);
      }
      // Next DIFAT sector is the last 4 bytes of this sector
      difatSector = view.getUint32(off + sectorSize - 4, true);
    }
  }

  // Validate we have the right number of FAT sectors
  if (fatSectorIds.length < numFatSectors) {
    // Some implementations write fewer DIFAT entries; use what we have
  }

  // Build FAT table
  const fatEntriesPerSector = sectorSize / 4;
  const fat: number[] = [];
  for (const fatSectorId of fatSectorIds.slice(0, numFatSectors)) {
    const off = sectorOffset(fatSectorId);
    for (let i = 0; i < fatEntriesPerSector; i++) {
      fat.push(view.getUint32(off + i * 4, true));
    }
  }

  // Follow a FAT chain starting at startSector
  function followChain(startSector: number): number[] {
    const chain: number[] = [];
    let sector = startSector;
    const visited = new Set<number>();
    while (sector !== ENDOFCHAIN && sector !== FREESECT) {
      if (sector === FATSECT || sector === DIFSECT) break;
      if (visited.has(sector)) break; // cycle guard
      visited.add(sector);
      chain.push(sector);
      sector = fat[sector] ?? ENDOFCHAIN;
    }
    return chain;
  }

  // Read bytes for a chain of sectors
  function readChain(chain: number[]): Uint8Array {
    const totalSize = chain.length * sectorSize;
    const result = new Uint8Array(totalSize);
    let pos = 0;
    for (const sector of chain) {
      const off = sectorOffset(sector);
      result.set(bytes.subarray(off, off + sectorSize), pos);
      pos += sectorSize;
    }
    return result;
  }

  // Build MiniFAT
  const miniFat: number[] = [];
  if (numMiniFatSectors > 0 && firstMiniFatSector !== ENDOFCHAIN && firstMiniFatSector !== FREESECT) {
    const miniFatChain = followChain(firstMiniFatSector);
    const miniFatData = readChain(miniFatChain);
    const miniFatView = new DataView(miniFatData.buffer, miniFatData.byteOffset, miniFatData.byteLength);
    for (let i = 0; i < miniFatData.length / 4; i++) {
      miniFat.push(miniFatView.getUint32(i * 4, true));
    }
  }

  // Parse directory entries
  // Each entry is 128 bytes; multiple entries per sector
  const dirChain = followChain(firstDirSector);
  const dirData = readChain(dirChain);
  const dirView = new DataView(dirData.buffer, dirData.byteOffset, dirData.byteLength);

  const entriesPerSector = sectorSize / 128;
  const totalEntries = dirChain.length * entriesPerSector;

  // Directory entry structure
  interface DirEntry {
    name: string;
    objectType: number; // 0=unused, 1=storage, 2=stream, 5=root
    startSector: number;
    size: number;
    childId: number;
    siblingLeftId: number;
    siblingRightId: number;
  }

  function readDirEntry(entryIndex: number): DirEntry {
    const base = entryIndex * 128;
    // Name: 64 bytes UTF-16LE, length at offset 64 (in bytes, includes null terminator)
    const nameLen = dirView.getUint16(base + 64, true);
    let name = "";
    if (nameLen > 2) {
      const chars = Math.min((nameLen - 2) / 2, 32);
      for (let i = 0; i < chars; i++) {
        name += String.fromCharCode(dirView.getUint16(base + i * 2, true));
      }
    }
    const objectType = dirView.getUint8(base + 66);
    const childId = dirView.getUint32(base + 76, true);
    const siblingLeftId = dirView.getUint32(base + 68, true);
    const siblingRightId = dirView.getUint32(base + 72, true);
    const startSector = dirView.getUint32(base + 116, true);
    // Size is 32-bit for version 3, 64-bit for version 4
    const size = dirView.getUint32(base + 120, true);
    return { name, objectType, startSector, size, childId, siblingLeftId, siblingRightId };
  }

  // Find root entry (entry 0)
  const rootEntry = readDirEntry(0);
  // The root entry's start sector is the start of the mini stream container
  const miniStreamStartSector = rootEntry.startSector;
  const miniStreamSize = rootEntry.size;

  // Read mini stream container
  let miniStreamData: Uint8Array | null = null;
  if (miniStreamStartSector !== ENDOFCHAIN && miniStreamStartSector !== FREESECT && miniStreamSize > 0) {
    const miniStreamChain = followChain(miniStreamStartSector);
    miniStreamData = readChain(miniStreamChain).subarray(0, miniStreamSize);
  }

  // Follow a mini FAT chain
  function followMiniChain(startSector: number): number[] {
    const chain: number[] = [];
    let sector = startSector;
    const visited = new Set<number>();
    while (sector !== ENDOFCHAIN && sector !== FREESECT) {
      if (visited.has(sector)) break;
      visited.add(sector);
      chain.push(sector);
      sector = miniFat[sector] ?? ENDOFCHAIN;
    }
    return chain;
  }

  // Read a stream's bytes (handles both regular and mini stream)
  function readStream(entry: DirEntry): Uint8Array {
    if (entry.size < miniStreamCutoff && miniStreamData !== null && entry.startSector !== ENDOFCHAIN && entry.startSector !== FREESECT) {
      // Read from mini stream
      const miniChain = followMiniChain(entry.startSector);
      const result = new Uint8Array(entry.size);
      let pos = 0;
      for (const miniSector of miniChain) {
        const off = miniSector * miniSectorSize;
        const bytesToCopy = Math.min(miniSectorSize, entry.size - pos);
        if (bytesToCopy <= 0) break;
        result.set(miniStreamData.subarray(off, off + bytesToCopy), pos);
        pos += bytesToCopy;
      }
      return result;
    } else {
      // Read from regular FAT
      if (entry.startSector === ENDOFCHAIN || entry.startSector === FREESECT) {
        return new Uint8Array(0);
      }
      const chain = followChain(entry.startSector);
      const raw = readChain(chain);
      return raw.subarray(0, entry.size);
    }
  }

  // Walk directory tree using Red-Black tree traversal (childId, siblingLeftId, siblingRightId)
  const streams = new Map<string, Uint8Array>();

  function walkDir(entryId: number, pathPrefix: string): void {
    if (entryId === 0xffffffff) return;
    if (entryId >= totalEntries) return;

    const entry = readDirEntry(entryId);

    // Traverse sibling tree (this is a Red-Black tree, we traverse all nodes)
    if (entry.siblingLeftId !== 0xffffffff) {
      walkDir(entry.siblingLeftId, pathPrefix);
    }

    if (entry.objectType === 2) {
      // Stream entry
      const fullPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
      streams.set(fullPath, readStream(entry));
    } else if (entry.objectType === 1) {
      // Storage entry
      const storagePath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
      if (entry.childId !== 0xffffffff) {
        walkDir(entry.childId, storagePath);
      }
    }

    if (entry.siblingRightId !== 0xffffffff) {
      walkDir(entry.siblingRightId, pathPrefix);
    }
  }

  // Start from root's child
  if (rootEntry.childId !== 0xffffffff) {
    walkDir(rootEntry.childId, "");
  }

  return { streams };
}
