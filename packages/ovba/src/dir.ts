export type ModuleType = "procedural" | "class" | "document" | "designer";

export interface DirModule {
  name: string;
  streamName: string;
  textOffset: number;
  type: ModuleType;
}

export interface DirStream {
  codePage: number;
  projectName: string;
  modules: DirModule[];
}

// Record IDs from MS-OVBA 2.3.4.2 (dir stream).
const ID = {
  SYSKIND: 0x0001,
  LCID: 0x0002,
  CODEPAGE: 0x0003,
  NAME: 0x0004,
  VERSION: 0x0009,
  MODULES: 0x000f,
  MODULES_TERMINATOR: 0x0010,
  COOKIE: 0x0013,
  MODULE_NAME: 0x0019,
  MODULE_STREAM_NAME: 0x001a,
  MODULE_OFFSET: 0x0031,
  MODULE_STREAM_NAME_UNICODE: 0x0032,
  MODULE_NAME_UNICODE: 0x0047,
  MODULE_TYPE_PROCEDURAL: 0x0021,
  MODULE_TYPE_DOCUMENT: 0x0022,
  MODULE_TERMINATOR: 0x002b,
} as const;

export class DirStreamError extends Error {
  constructor(
    message: string,
    public readonly byteOffset: number,
  ) {
    super(`${message} (dir stream offset ${byteOffset})`);
    this.name = "DirStreamError";
  }
}

function decodeMbcs(bytes: Uint8Array, codePage: number): string {
  const label = codePage === 65001 ? "utf-8" : `windows-${codePage}`;
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/**
 * Parse a decompressed dir stream (MS-OVBA 2.3.4.2).
 *
 * Almost every record is `Id (2) | Size (4) | Data (Size)`, including the "Reserved" parts of
 * DocString, HelpFilePath, Constants, Reference and Module records (their reserved Ids such as
 * 0x0040, 0x003D, 0x003C, 0x003E, 0x0032, 0x0048 are followed by a 4-byte size too), so a single
 * record loop can walk the whole stream. The one exception is PROJECTVERSION (0x0009):
 * `Id | Reserved = 4 (4) | VersionMajor (4) | VersionMinor (2)`, i.e. 6 data bytes after a
 * Reserved field that looks like a size of 4.
 *
 * Module type 0x0022 marks document and class modules; the dir stream does not distinguish them.
 */
export function parseDirStream(decompressed: Uint8Array): DirStream {
  const view = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
  let pos = 0;
  let codePage = 1252;
  let projectName = "";
  const modules: DirModule[] = [];
  let current: DirModule | null = null;
  let sawModules = false;

  while (pos < decompressed.length) {
    if (pos + 6 > decompressed.length) throw new DirStreamError("Truncated record header", pos);
    const id = view.getUint16(pos, true);
    const recordStart = pos;
    pos += 2;

    if (id === ID.VERSION) {
      const reserved = view.getUint32(pos, true);
      if (reserved !== 4) throw new DirStreamError(`PROJECTVERSION.Reserved must be 4, got ${reserved}`, pos);
      pos += 4 + 6;
      continue;
    }

    const size = view.getUint32(pos, true);
    pos += 4;
    if (pos + size > decompressed.length) {
      throw new DirStreamError(`Record 0x${id.toString(16)} of ${size} bytes runs past the end`, recordStart);
    }
    const data = decompressed.subarray(pos, pos + size);
    pos += size;

    switch (id) {
      case ID.CODEPAGE:
        if (size !== 2) throw new DirStreamError("PROJECTCODEPAGE.Size must be 2", recordStart);
        codePage = new DataView(data.buffer, data.byteOffset, 2).getUint16(0, true);
        break;
      case ID.NAME:
        projectName = decodeMbcs(data, codePage);
        break;
      case ID.MODULES:
        sawModules = true;
        break;
      case ID.MODULE_NAME:
        current = { name: decodeMbcs(data, codePage), streamName: "", textOffset: 0, type: "procedural" };
        break;
      case ID.MODULE_NAME_UNICODE:
        if (current) current.name = new TextDecoder("utf-16le").decode(data);
        break;
      case ID.MODULE_STREAM_NAME:
        if (current && !current.streamName) current.streamName = decodeMbcs(data, codePage);
        break;
      case ID.MODULE_STREAM_NAME_UNICODE:
        if (current) current.streamName = new TextDecoder("utf-16le").decode(data);
        break;
      case ID.MODULE_OFFSET:
        if (current) current.textOffset = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true);
        break;
      case ID.MODULE_TYPE_PROCEDURAL:
        if (current) current.type = "procedural";
        break;
      case ID.MODULE_TYPE_DOCUMENT:
        if (current) current.type = "document";
        break;
      case ID.MODULE_TERMINATOR:
        if (current) {
          if (!current.streamName) current.streamName = current.name;
          modules.push(current);
          current = null;
        }
        break;
      case ID.MODULES_TERMINATOR:
        return { codePage, projectName, modules };
      default:
        // SYSKIND, LCID, LCIDINVOKE, DOCSTRING (+0x0040), HELPFILEPATH (+0x003D), HELPCONTEXT,
        // LIBFLAGS, CONSTANTS (+0x003C), REFERENCE* records, COOKIE, module DocString/HelpContext/
        // Cookie/ReadOnly/Private: nothing we need.
        break;
    }
  }

  if (!sawModules) throw new DirStreamError("No PROJECTMODULES record", pos);
  return { codePage, projectName, modules };
}
