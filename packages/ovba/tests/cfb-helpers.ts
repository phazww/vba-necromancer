/**
 * Helpers for building minimal valid CFB (Compound File Binary) structures in tests.
 * Produces version-3 (512-byte sector) CFBs.
 */

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;

/** Build a minimal CFB with one stream entry under the root directory. */
export interface StreamDef {
  /** Slash-separated path like "VBA/dir" or "Module1" */
  path: string;
  data: Uint8Array;
}

/**
 * Build a minimal valid CFB with the given streams.
 * Uses 512-byte sectors (version 3).
 */
export function buildMinimalCFB(streams: StreamDef[]): Uint8Array {
  const SECTOR_SIZE = 512;
  const MINI_STREAM_CUTOFF = 4096;

  // ---- Plan the layout ----
  // We'll use the regular FAT for all streams (even small ones, to keep it simple).
  // Layout:
  //   Header (512 bytes)
  //   Sector 0: FAT sector
  //   Sector 1: Directory sector
  //   Sectors 2+: stream data sectors

  // We need to build directory entries for all paths.
  // For simplicity, only support single-level paths (name) or two-level (storage/name).
  // We build a flat list of storage+stream entries.

  interface DirEntrySpec {
    name: string;
    objectType: number; // 1=storage, 2=stream, 5=root
    startSector: number;
    size: number;
    childIdx: number; // index into dirEntries, or -1
    leftSiblingIdx: number;
    rightSiblingIdx: number;
    color: number; // 0=red, 1=black
  }

  // Parse paths and build a tree
  // We'll use a simple approach: root → storages → streams
  // Build a directory tree
  const storages = new Map<string, number>(); // storage name → dir entry index
  const dirEntries: DirEntrySpec[] = [];

  // Entry 0 is always root
  dirEntries.push({
    name: "Root Entry",
    objectType: 5,
    startSector: ENDOFCHAIN,
    size: 0,
    childIdx: -1,
    leftSiblingIdx: -1,
    rightSiblingIdx: -1,
    color: 1,
  });

  // Group streams by storage
  const streamsByStorage = new Map<string, { name: string; data: Uint8Array }[]>();
  streamsByStorage.set("", []);

  for (const s of streams) {
    const slashIdx = s.path.indexOf("/");
    if (slashIdx === -1) {
      streamsByStorage.get("")!.push({ name: s.path, data: s.data });
    } else {
      const storageName = s.path.substring(0, slashIdx);
      const streamName = s.path.substring(slashIdx + 1);
      if (!streamsByStorage.has(storageName)) {
        streamsByStorage.set(storageName, []);
      }
      streamsByStorage.get(storageName)!.push({ name: streamName, data: s.data });
    }
  }

  // We'll lay out sectors after the directory sector.
  // First compute all sector assignments.
  // Sector layout: 0 = FAT, 1 = Directory, then data sectors
  let nextSector = 2;

  // For each storage and its streams, assign sectors
  interface DataRegion {
    dirIdx: number;
    sectors: number[];
    data: Uint8Array;
  }
  const dataRegions: DataRegion[] = [];

  // Add storages and their streams
  const rootChildren: number[] = [];

  for (const [storageName, streamList] of streamsByStorage) {
    if (storageName === "") {
      // Root-level streams
      for (const { name, data } of streamList) {
        const numSectors = Math.ceil(data.length / SECTOR_SIZE);
        const sectors: number[] = [];
        for (let i = 0; i < numSectors; i++) sectors.push(nextSector++);
        const idx = dirEntries.length;
        dirEntries.push({
          name,
          objectType: 2,
          startSector: sectors.length > 0 ? sectors[0]! : ENDOFCHAIN,
          size: data.length,
          childIdx: -1,
          leftSiblingIdx: -1,
          rightSiblingIdx: -1,
          color: 1,
        });
        dataRegions.push({ dirIdx: idx, sectors, data });
        rootChildren.push(idx);
      }
    } else {
      // Storage entry
      const storageIdx = dirEntries.length;
      dirEntries.push({
        name: storageName,
        objectType: 1,
        startSector: ENDOFCHAIN,
        size: 0,
        childIdx: -1,
        leftSiblingIdx: -1,
        rightSiblingIdx: -1,
        color: 1,
      });
      storages.set(storageName, storageIdx);
      rootChildren.push(storageIdx);

      const storageChildren: number[] = [];
      for (const { name, data } of streamList) {
        const numSectors = Math.ceil(data.length / SECTOR_SIZE);
        const sectors: number[] = [];
        for (let i = 0; i < numSectors; i++) sectors.push(nextSector++);
        const idx = dirEntries.length;
        dirEntries.push({
          name,
          objectType: 2,
          startSector: sectors.length > 0 ? sectors[0]! : ENDOFCHAIN,
          size: data.length,
          childIdx: -1,
          leftSiblingIdx: -1,
          rightSiblingIdx: -1,
          color: 1,
        });
        dataRegions.push({ dirIdx: idx, sectors, data });
        storageChildren.push(idx);
      }

      // Link storage children as a simple left-skewed chain
      if (storageChildren.length > 0) {
        dirEntries[storageIdx]!.childIdx = storageChildren[0]!;
        for (let i = 0; i < storageChildren.length - 1; i++) {
          dirEntries[storageChildren[i]!]!.rightSiblingIdx = storageChildren[i + 1]!;
        }
      }
    }
  }

  // Link root children
  if (rootChildren.length > 0) {
    dirEntries[0]!.childIdx = rootChildren[0]!;
    for (let i = 0; i < rootChildren.length - 1; i++) {
      dirEntries[rootChildren[i]!]!.rightSiblingIdx = rootChildren[i + 1]!;
    }
  }

  const totalSectors = nextSector;
  // FAT at sector 0, directory at sector 1, data at sectors 2+

  // ---- Build FAT ----
  const fatEntries = new Uint32Array(SECTOR_SIZE / 4).fill(FREESECT);
  fatEntries[0] = FATSECT; // sector 0 = FAT sector itself
  fatEntries[1] = ENDOFCHAIN; // sector 1 = Directory (single sector)

  for (const region of dataRegions) {
    for (let i = 0; i < region.sectors.length; i++) {
      const s = region.sectors[i]!;
      fatEntries[s] = i + 1 < region.sectors.length ? region.sectors[i + 1]! : ENDOFCHAIN;
    }
  }

  // ---- Build directory sector ----
  const entriesPerSector = SECTOR_SIZE / 128;
  const numDirSectors = Math.ceil(dirEntries.length / entriesPerSector);
  if (numDirSectors > 1) {
    // For simplicity we don't support multi-sector directories in this test helper
    throw new Error("Too many directory entries for this test helper");
  }

  const dirSector = new Uint8Array(SECTOR_SIZE).fill(0);
  const dirView = new DataView(dirSector.buffer);

  function writeDirEntry(entryIdx: number, entry: DirEntrySpec): void {
    const base = entryIdx * 128;
    // Name (UTF-16LE)
    const nameUtf16 = new Uint16Array(32).fill(0);
    for (let i = 0; i < Math.min(entry.name.length, 31); i++) {
      nameUtf16[i] = entry.name.charCodeAt(i);
    }
    for (let i = 0; i < 32; i++) {
      dirView.setUint16(base + i * 2, nameUtf16[i]!, true);
    }
    // Name length (bytes, includes null)
    const nameLen = entry.name.length > 0 ? (entry.name.length + 1) * 2 : 0;
    dirView.setUint16(base + 64, nameLen, true);
    // Object type
    dirSector[base + 66] = entry.objectType;
    // Color (0=red, 1=black)
    dirSector[base + 67] = entry.color;
    // Left/right sibling and child
    dirView.setUint32(base + 68, entry.leftSiblingIdx === -1 ? FREESECT : entry.leftSiblingIdx, true);
    dirView.setUint32(base + 72, entry.rightSiblingIdx === -1 ? FREESECT : entry.rightSiblingIdx, true);
    dirView.setUint32(base + 76, entry.childIdx === -1 ? FREESECT : entry.childIdx, true);
    // CLSID (16 bytes, offset 80) — zeroes
    // State bits (offset 96) — 0
    // Created/modified times (offset 100, 108) — 0
    // Start sector
    dirView.setUint32(base + 116, entry.startSector, true);
    // Size
    dirView.setUint32(base + 120, entry.size, true);
  }

  for (let i = 0; i < dirEntries.length; i++) {
    writeDirEntry(i, dirEntries[i]!);
  }
  // Fill remaining entries as unused (objectType=0)
  for (let i = dirEntries.length; i < entriesPerSector; i++) {
    const base = i * 128;
    dirView.setUint32(base + 68, FREESECT, true);
    dirView.setUint32(base + 72, FREESECT, true);
    dirView.setUint32(base + 76, FREESECT, true);
    dirView.setUint32(base + 116, ENDOFCHAIN, true);
  }

  // ---- Build output buffer ----
  const fileSize = 512 + totalSectors * SECTOR_SIZE; // header + sectors
  const fileBuffer = new Uint8Array(fileSize);
  const headerView = new DataView(fileBuffer.buffer);

  // Magic
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  for (let i = 0; i < 8; i++) fileBuffer[i] = magic[i]!;

  // Minor version = 0x003E, Major version = 0x0003
  headerView.setUint16(24, 0x003e, true);
  headerView.setUint16(26, 0x0003, true);

  // Byte order = 0xFFFE (little-endian)
  headerView.setUint16(28, 0xfffe, true);

  // Sector size power (9 = 512 bytes)
  headerView.setUint16(30, 9, true);

  // Mini sector size power (6 = 64 bytes)
  headerView.setUint16(32, 6, true);

  // Reserved (6 bytes at offset 34) — zeroes

  // Number of directory sectors: 0 for version 3
  headerView.setUint32(40, 0, true);

  // Number of FAT sectors: 1
  headerView.setUint32(44, 1, true);

  // First directory sector: 1
  headerView.setUint32(48, 1, true);

  // Transaction signature: 0
  headerView.setUint32(52, 0, true);

  // Mini stream cutoff: 4096
  headerView.setUint32(56, MINI_STREAM_CUTOFF, true);

  // First MiniFAT sector: ENDOFCHAIN
  headerView.setUint32(60, ENDOFCHAIN, true);

  // Number of MiniFAT sectors: 0
  headerView.setUint32(64, 0, true);

  // First DIFAT sector: ENDOFCHAIN
  headerView.setUint32(68, ENDOFCHAIN, true);

  // Number of DIFAT sectors: 0
  headerView.setUint32(72, 0, true);

  // DIFAT array: first entry = sector 0 (the FAT sector), rest = FREESECT
  headerView.setUint32(76, 0, true); // FAT sector 0
  for (let i = 1; i < 109; i++) {
    headerView.setUint32(76 + i * 4, FREESECT, true);
  }

  // Write FAT sector at offset 512 (sector 0)
  const fatBytes = new Uint8Array(fatEntries.buffer);
  fileBuffer.set(fatBytes, 512);

  // Write directory sector at offset 512 + 512 = 1024 (sector 1)
  fileBuffer.set(dirSector, 512 + SECTOR_SIZE);

  // Write data sectors
  for (const region of dataRegions) {
    for (let i = 0; i < region.sectors.length; i++) {
      const sectorId = region.sectors[i]!;
      const fileOffset = 512 + sectorId * SECTOR_SIZE;
      const dataOffset = i * SECTOR_SIZE;
      const slice = region.data.subarray(dataOffset, dataOffset + SECTOR_SIZE);
      fileBuffer.set(slice, fileOffset);
    }
  }

  return fileBuffer;
}
