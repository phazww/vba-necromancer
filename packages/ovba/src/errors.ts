export class CFBFormatError extends Error {
  byteOffset: number;
  constructor(message: string, byteOffset: number) {
    super(message);
    this.name = "CFBFormatError";
    this.byteOffset = byteOffset;
  }
}

export class OVBADecompressError extends Error {
  byteOffset: number;
  constructor(message: string, byteOffset: number) {
    super(message);
    this.name = "OVBADecompressError";
    this.byteOffset = byteOffset;
  }
}

export class NoVBAProjectError extends Error {
  constructor(message = "No VBA project found in workbook") {
    super(message);
    this.name = "NoVBAProjectError";
  }
}
