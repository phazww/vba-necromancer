export type FileKind = "zip" | "cfb" | "unknown";

/** Largest file the app accepts. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);
}

/** Looks at the first bytes only: a ZIP (.xlsx, .xlsm), a compound file (.xls) or something else. */
export function sniffKind(bytes: Uint8Array): FileKind {
  if (startsWith(bytes, ZIP_MAGIC)) return "zip";
  if (startsWith(bytes, CFB_MAGIC)) return "cfb";
  return "unknown";
}

export class NotAWorkbookError extends Error {
  constructor(readonly fileName: string) {
    super(`${fileName} is not an Excel workbook (it does not start with a ZIP or Excel signature).`);
    this.name = "NotAWorkbookError";
  }
}

export class FileTooLargeError extends Error {
  constructor(
    readonly size: number,
    readonly limit: number,
    readonly fileName?: string,
  ) {
    super(
      `${fileName ? `${fileName} is` : "The file is"} too large: ${size.toLocaleString("en-US")} bytes, the limit is ${limit.toLocaleString("en-US")} bytes (50 MB).`,
    );
    this.name = "FileTooLargeError";
  }
}

export class WorkbookReadError extends Error {
  constructor(
    readonly fileName: string,
    detail: string,
  ) {
    super(`Could not read ${fileName}: ${detail}`);
    this.name = "WorkbookReadError";
  }
}

/** Throws FileTooLargeError when `size` is above the limit. */
export function checkSize(size: number, fileName?: string): void {
  if (size > MAX_FILE_BYTES) throw new FileTooLargeError(size, MAX_FILE_BYTES, fileName);
}
