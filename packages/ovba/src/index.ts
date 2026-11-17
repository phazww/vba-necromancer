// packages/ovba — public barrel
export { parseCFB } from "./cfb.js";
export type { CFBFile } from "./cfb.js";
export { decompress } from "./decompress.js";
export { compress } from "./compress.js";
export { parseDirStream, DirStreamError } from "./dir.js";
export { writeDirStream } from "./dirWriter.js";
export type { DirWriterOptions, DirWriterModule } from "./dirWriter.js";
export type { DirStream, DirModule, ModuleType } from "./dir.js";
export { extractModules, initZlibInflate } from "./extract.js";
export type { VBAModule } from "./extract.js";
export { readZip } from "./zip.js";
export { CFBFormatError, OVBADecompressError, NoVBAProjectError } from "./errors.js";
