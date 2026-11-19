export class ParseError extends Error {
  module: string;
  line: number;
  col: number;

  constructor(message: string, module: string, line: number, col: number) {
    super(`[${module}:${line}:${col}] ${message}`);
    this.name = "ParseError";
    this.module = module;
    this.line = line;
    this.col = col;
  }
}

export class UnsupportedError extends Error {
  module: string;
  line: number;
  construct: string;
  /** Extra text shown after the construct, e.g. the ProgID of CreateObject. */
  detail?: string;

  constructor(module: string, line: number, construct: string, detail?: string) {
    super(
      `[${module}:${line}] Unsupported construct: ${construct}${detail === undefined ? "" : ` ("${detail}")`}`,
    );
    this.name = "UnsupportedError";
    this.module = module;
    this.line = line;
    this.construct = construct;
    this.detail = detail;
  }
}

export class RuntimeError extends Error {
  code: number;
  module: string;
  line: number;

  constructor(code: number, message?: string, module = "", line = 0) {
    super(message ?? `Runtime error ${code}`);
    this.name = "RuntimeError";
    this.code = code;
    this.module = module;
    this.line = line;
  }
}
