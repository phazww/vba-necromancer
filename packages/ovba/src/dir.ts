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

// Record IDs from MS-OVBA §2.3.4
const PROJECTSYSKIND = 0x0001;
const PROJECTCODEPAGE = 0x0003;
const PROJECTNAME = 0x0004;
const PROJECTMODULES = 0x000f;
const PROJECTMODULES_COUNT = 0x0014; // sub-record inside PROJECTMODULES
const MODULENAME = 0x0019;
const MODULESTREAM = 0x001a; // stream name record
const MODULETEXTOFFSET = 0x0031; // offset of compressed source within the module stream
const MODULETYPE_PROCEDURAL = 0x0021;
const MODULETYPE_CLASS = 0x0022;
const MODULE_TERMINATOR = 0x002b;
const PROJECTMODULES_TERMINATOR = 0x0010;

/**
 * Parse a decompressed dir stream into project and module metadata.
 * See MS-OVBA §2.3.4 PROJECTINFORMATION Record.
 */
export function parseDirStream(decompressed: Uint8Array): DirStream {
  const view = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
  let pos = 0;

  function readWord(): number {
    if (pos + 2 > decompressed.length) throw new Error("dir stream truncated reading WORD");
    const v = view.getUint16(pos, true);
    pos += 2;
    return v;
  }

  function readDword(): number {
    if (pos + 4 > decompressed.length) throw new Error("dir stream truncated reading DWORD");
    const v = view.getUint32(pos, true);
    pos += 4;
    return v;
  }

  function readBytes(n: number): Uint8Array {
    if (pos + n > decompressed.length) throw new Error(`dir stream truncated reading ${n} bytes`);
    const slice = decompressed.subarray(pos, pos + n);
    pos += n;
    return slice;
  }

  function decodeCP1252(bytes: Uint8Array): string {
    // Most module names are ASCII; use windows-1252 decoder
    try {
      const dec = new TextDecoder("windows-1252");
      return dec.decode(bytes);
    } catch {
      return new TextDecoder("latin1").decode(bytes);
    }
  }

  let codePage = 1252;
  let projectName = "";
  const modules: DirModule[] = [];

  // Read records until we hit PROJECTMODULES
  outer: while (pos < decompressed.length) {
    const id = readWord();
    const size = readDword();

    switch (id) {
      case PROJECTSYSKIND: {
        readBytes(size); // skip: SYSKIND value
        break;
      }
      case PROJECTCODEPAGE: {
        if (size >= 2) {
          const data = readBytes(size);
          codePage = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(0, true);
        } else {
          readBytes(size);
        }
        break;
      }
      case PROJECTNAME: {
        const data = readBytes(size);
        projectName = decodeCP1252(data);
        break;
      }
      case PROJECTMODULES: {
        // PROJECTMODULES header: contains count sub-record and then MODULE records
        // The size of PROJECTMODULES record itself is a fixed-size count WORD
        // But per spec §2.3.4.2, PROJECTMODULES is a container; its "size" is 4 bytes (PROJECTMODULES.Reserved)
        // We skip the Reserved field (should be 0x0002) but it's already read as `size`
        // Actually: the record structure is RECORD(id=0x000F, size=4, data=reserved(4bytes))
        // Then sub-records follow directly after.
        readBytes(size); // skip reserved

        // Read PROJECTMODULES.Count sub-record
        const countId = readWord();
        if (countId !== PROJECTMODULES_COUNT) {
          // Some implementations don't have count; skip
          pos -= 2;
        } else {
          const countSize = readDword();
          readBytes(countSize); // skip count value (we enumerate until terminator)
        }

        // Read MODULE records
        while (pos < decompressed.length) {
          const modStartId = readWord();
          if (modStartId === PROJECTMODULES_TERMINATOR) {
            const termSize = readDword();
            readBytes(termSize);
            break outer;
          }
          // MODULENAME record id = 0x0019; size; name bytes
          if (modStartId !== MODULENAME) {
            // unexpected; skip
            const s = readDword();
            readBytes(s);
            continue;
          }
          const nameSize = readDword();
          const nameData = readBytes(nameSize);
          const moduleName = decodeCP1252(nameData);

          let streamName = moduleName;
          let textOffset = 0;
          let moduleType: ModuleType = "procedural";

          // Read sub-records until MODULE_TERMINATOR
          let inModule = true;
          while (inModule && pos < decompressed.length) {
            const subId = readWord();
            const subSize = readDword();

            switch (subId) {
              case MODULESTREAM: {
                const data = readBytes(subSize);
                streamName = decodeCP1252(data);
                break;
              }
              case MODULETEXTOFFSET: {
                // textOffset is a DWORD
                const data = readBytes(subSize);
                if (subSize >= 4) {
                  textOffset = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
                }
                break;
              }
              case MODULETYPE_PROCEDURAL: {
                moduleType = "procedural";
                readBytes(subSize);
                break;
              }
              case MODULETYPE_CLASS: {
                moduleType = "class";
                readBytes(subSize);
                break;
              }
              case MODULE_TERMINATOR: {
                readBytes(subSize);
                inModule = false;
                break;
              }
              default: {
                readBytes(subSize);
                break;
              }
            }
          }

          modules.push({ name: moduleName, streamName, textOffset, type: moduleType });
        }
        break;
      }
      default: {
        readBytes(size);
        break;
      }
    }
  }

  return { codePage, projectName, modules };
}
