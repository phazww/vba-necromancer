import { parseCFB } from "./cfb.js";
import { decompress } from "./decompress.js";
import { parseDirStream, type DirReference, type ModuleType } from "./dir.js";
import { NoVBAProjectError } from "./errors.js";
import { readZip, initZlibInflate } from "./zip.js";

export interface VBAModule {
  name: string;
  type: ModuleType;
  source: string;
}

/** What a VBA project holds: its modules and its references to libraries. */
export interface ProjectInfo {
  modules: VBAModule[];
  references: DirReference[];
  /** One line per reference record that could not be read. */
  referenceProblems: string[];
}

/** ZIP local file header magic bytes: PK\x03\x04 */
function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/**
 * Extract all VBA modules from an .xlsm file or a raw vbaProject.bin CFB.
 *
 * Accepts:
 *  1. OOXML (.xlsm) — a ZIP archive. Extracts xl/vbaProject.bin, then parses as CFB.
 *     Call initZlibInflate(inflateRawSync) before using this path in Node.js.
 *  2. Raw CFB — an OLE2 Compound File Binary (vbaProject.bin directly), used in tests.
 *
 * Throws NoVBAProjectError if no VBA project is found.
 */
export function extractModules(fileBytes: Uint8Array): VBAModule[] {
  return extractProject(fileBytes).modules;
}

/** Like `extractModules`, and also returns the project references from the dir stream. */
export function extractProject(fileBytes: Uint8Array): ProjectInfo {
  let cfbBytes = fileBytes;

  if (isZip(fileBytes)) {
    const entries = readZip(fileBytes);
    let vbaBin: Uint8Array | undefined;
    for (const [name, data] of entries) {
      if (name.toLowerCase() === "xl/vbaproject.bin") {
        vbaBin = data;
        break;
      }
    }
    if (!vbaBin) {
      throw new NoVBAProjectError();
    }
    cfbBytes = vbaBin;
  }

  const cfb = parseCFB(cfbBytes);

  let dirStream: Uint8Array | undefined;
  let dirKey: string | undefined;
  for (const [key, value] of cfb.streams) {
    if (key.toLowerCase() === "vba/dir") {
      dirStream = value;
      dirKey = key;
      break;
    }
  }

  if (!dirStream || !dirKey) {
    throw new NoVBAProjectError();
  }

  const decompressedDir = decompress(dirStream);
  const dirInfo = parseDirStream(decompressedDir);

  const vbaPrefix = dirKey.substring(0, dirKey.lastIndexOf("/") + 1);

  const streamMap = new Map<string, Uint8Array>();
  for (const [key, value] of cfb.streams) {
    streamMap.set(key.toLowerCase(), value);
  }

  function makeDecoder(codePage: number): TextDecoder {
    if (codePage === 1200 || codePage === 1201) {
      return new TextDecoder("utf-16le");
    }
    const label = `windows-${codePage}`;
    try {
      return new TextDecoder(label);
    } catch {
      try {
        return new TextDecoder("windows-1252");
      } catch {
        return new TextDecoder("latin1");
      }
    }
  }

  const decoder = makeDecoder(dirInfo.codePage);
  const modules: VBAModule[] = [];

  for (const dirMod of dirInfo.modules) {
    const streamPath = `${vbaPrefix}${dirMod.streamName}`;
    const streamData = streamMap.get(streamPath.toLowerCase());

    if (!streamData) {
      const altData = streamMap.get(dirMod.streamName.toLowerCase());
      if (!altData) continue;
      const decompressed = decompress(altData);
      const sourceBytes = decompressed.subarray(dirMod.textOffset);
      const source = decoder.decode(sourceBytes);
      modules.push({ name: dirMod.name, type: dirMod.type, source });
      continue;
    }

    const decompressed = decompress(streamData);
    const sourceBytes = decompressed.subarray(dirMod.textOffset);
    const source = decoder.decode(sourceBytes);
    modules.push({ name: dirMod.name, type: dirMod.type, source });
  }

  return { modules, references: dirInfo.references, referenceProblems: dirInfo.referenceProblems };
}

export { initZlibInflate };
