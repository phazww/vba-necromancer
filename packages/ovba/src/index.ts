// packages/ovba — public barrel
export { parseCFB } from "./cfb.js";
export type { CFBFile } from "./cfb.js";
export { decompress } from "./decompress.js";
export { compress } from "./compress.js";
export { parseDirStream } from "./dir.js";
export type { DirStream, DirModule, ModuleType } from "./dir.js";
export { extractModules } from "./extract.js";
export type { VBAModule } from "./extract.js";
export { CFBFormatError, OVBADecompressError, NoVBAProjectError } from "./errors.js";
