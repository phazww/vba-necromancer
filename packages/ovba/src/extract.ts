import { parseCFB } from "./cfb.js";
import { decompress } from "./decompress.js";
import { parseDirStream, type ModuleType } from "./dir.js";
import { NoVBAProjectError } from "./errors.js";

export interface VBAModule {
  name: string;
  type: ModuleType;
  source: string;
}

/**
 * Extract all VBA modules from a .xlsm (or .xls) file.
 * The file must contain a VBA project; throws NoVBAProjectError otherwise.
 */
export function extractModules(xlsmBytes: Uint8Array): VBAModule[] {
  const cfb = parseCFB(xlsmBytes);

  // Locate the VBA/dir stream (case-insensitive search since Excel may vary case)
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

  // Decompress the dir stream
  const decompressedDir = decompress(dirStream);
  const dirInfo = parseDirStream(decompressedDir);

  // Determine the VBA storage prefix from the dir stream key
  const vbaPrefix = dirKey.substring(0, dirKey.lastIndexOf("/") + 1); // e.g. "VBA/"

  // Build a case-insensitive lookup for CFB streams
  const streamMap = new Map<string, Uint8Array>();
  for (const [key, value] of cfb.streams) {
    streamMap.set(key.toLowerCase(), value);
  }

  // Build a TextDecoder for the code page
  function makeDecoder(codePage: number): TextDecoder {
    if (codePage === 1200 || codePage === 1201) {
      // UTF-16
      return new TextDecoder("utf-16le");
    }
    // Windows-1252 (also covers ISO-8859-1 / Latin-1 for practical purposes)
    // Browser TextDecoder accepts "windows-1252" but not all environments do
    try {
      return new TextDecoder("windows-1252");
    } catch {
      return new TextDecoder("latin1");
    }
  }

  const decoder = makeDecoder(dirInfo.codePage);

  const modules: VBAModule[] = [];

  for (const dirMod of dirInfo.modules) {
    const streamPath = `${vbaPrefix}${dirMod.streamName}`;
    const streamData = streamMap.get(streamPath.toLowerCase());

    if (!streamData) {
      // Try without prefix
      const altData = streamMap.get(dirMod.streamName.toLowerCase());
      if (!altData) continue;
      const decompressed = decompress(altData);
      const sourceBytes = decompressed.subarray(dirMod.textOffset);
      const source = decoder.decode(sourceBytes);
      modules.push({ name: dirMod.name, type: dirMod.type, source });
      continue;
    }

    // Module streams are compressed; decompress and slice from textOffset
    const decompressed = decompress(streamData);
    const sourceBytes = decompressed.subarray(dirMod.textOffset);
    const source = decoder.decode(sourceBytes);
    modules.push({ name: dirMod.name, type: dirMod.type, source });
  }

  return modules;
}
