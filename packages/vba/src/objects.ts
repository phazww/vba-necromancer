/**
 * Host objects exposed to VBA: Err, Workbook, Worksheet, Range.
 *
 * Members that are not implemented throw UnsupportedError("", 0, "<Type>.<Member>");
 * the interpreter fills in module and line. Nothing is silently ignored.
 */

import { RuntimeError, UnsupportedError } from "./errors.js";
import type { RangeHandle, SheetHandle, VBAValue, WorkbookHandle, XlDirection } from "./host.js";
import { MAX_COLS, MAX_ROWS, cellRef, colLetters } from "./host.js";
import {
  IntValue,
  NOTHING,
  VbArray,
  isNothing,
  isObject,
  mkLong,
  toLongArg,
  toStr,
  type Value,
  type VbObject,
} from "./values.js";

export { DictionaryObject } from "./dictionary.js";

function unsupported(type: string, member: string): never {
  throw new UnsupportedError("", 0, `${type}.${member}`);
}

// ─── Excel constants ────────────────────────────────────────────────────────

const XL_DIRECTIONS = new Map<number, XlDirection>([
  [-4162, "xlUp"],
  [-4121, "xlDown"],
  [-4159, "xlLeft"],
  [-4161, "xlRight"],
]);

// ─── Value conversion between the interpreter and the workbook ──────────────

export function fromWorkbook(v: VBAValue): Value {
  if (!Array.isArray(v)) return v;
  const rows = v.length;
  const cols = rows > 0 ? v[0].length : 0;
  const arr = VbArray.allocate([1, 1], [rows, cols], "Variant");
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) arr.set([r + 1, c + 1], fromWorkbook(v[r][c]));
  }
  return arr;
}

export function toWorkbook(v: Value): VBAValue {
  if (v === null || typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (v instanceof IntValue) return v.n;
  if (v instanceof VbArray) {
    if (v.dims === 2) {
      const rows: VBAValue[][] = [];
      for (let r = v.lbounds[0]; r <= v.ubounds[0]; r++) {
        const row: VBAValue[] = [];
        for (let c = v.lbounds[1]; c <= v.ubounds[1]; c++) row.push(toWorkbook(v.get([r, c])));
        rows.push(row);
      }
      return rows;
    }
    if (v.dims === 1) {
      const row: VBAValue[] = [];
      for (let i = v.lbounds[0]; i <= v.ubounds[0]; i++) row.push(toWorkbook(v.get([i])));
      return [row];
    }
    throw new RuntimeError(13, "Type mismatch");
  }
  if (isNothing(v)) throw new RuntimeError(91, "Object variable or With block variable not set");
  if (isObject(v) && v.defaultValue) return toWorkbook(v.defaultValue());
  throw new RuntimeError(438, "Object doesn't support this property or method");
}

// ─── Err ────────────────────────────────────────────────────────────────────

export class ErrObject implements VbObject {
  readonly typeName = "ErrObject";
  number = 0;
  description = "";
  source = "";

  clear(): void {
    this.number = 0;
    this.description = "";
    this.source = "";
  }

  setError(e: RuntimeError): void {
    this.number = e.code;
    this.description = e.message;
    this.source = "VBAProject";
  }

  get(member: string, args: Value[]): Value {
    switch (member.toLowerCase()) {
      case "number":
        return new IntValue(this.number, true);
      case "description":
        return this.description;
      case "source":
        return this.source;
      case "clear":
        this.clear();
        return null;
      case "raise": {
        if (args.length === 0) throw new RuntimeError(5, "Invalid procedure call or argument");
        const code = toLongArg(args[0]);
        const given = args[2];
        const description =
          given !== undefined && given !== null && !isNothing(given)
            ? toStr(given)
            : "Application-defined or object-defined error";
        throw new RuntimeError(code, description);
      }
      default:
        return unsupported("Err", member);
    }
  }

  set(member: string, _args: Value[], value: Value): void {
    switch (member.toLowerCase()) {
      case "number":
        this.number = toLongArg(value);
        return;
      case "description":
        this.description = toStr(value);
        return;
      case "source":
        this.source = toStr(value);
        return;
      default:
        unsupported("Err", member);
    }
  }

  defaultValue(): Value {
    return new IntValue(this.number, true);
  }
}

// ─── Range ──────────────────────────────────────────────────────────────────

export class RangeObject implements VbObject {
  readonly typeName = "Range";

  constructor(readonly handle: RangeHandle) {}

  get(member: string, args: Value[]): Value {
    switch (member.toLowerCase()) {
      case "value":
      case "value2":
        return fromWorkbook(this.handle.getValue());
      case "row":
        return mkLong(this.handle.topRow);
      case "column":
        return mkLong(this.handle.leftCol);
      case "formula": {
        if (args.length !== 0) throw new RuntimeError(450, "Wrong number of arguments or invalid property assignment");
        const sheet = this.handle.sheet;
        const cell = (r: number, c: number): VBAValue => sheet.getCellFormula(r, c) ?? sheet.getCellValue(r, c);
        const { topRow, leftCol, bottomRow, rightCol } = this.handle;
        if (topRow === bottomRow && leftCol === rightCol) return fromWorkbook(cell(topRow, leftCol));
        const rows: VBAValue[][] = [];
        for (let r = topRow; r <= bottomRow; r++) {
          const row: VBAValue[] = [];
          for (let c = leftCol; c <= rightCol; c++) row.push(cell(r, c));
          rows.push(row);
        }
        return fromWorkbook(rows);
      }
      case "address":
        if (args.length !== 0) return unsupported("Range", "Address with arguments");
        return this.address();
      case "rows":
        if (args.length !== 0) return unsupported("Range", "Rows(index)");
        return new CountObject(this.handle.bottomRow - this.handle.topRow + 1);
      case "columns":
        if (args.length !== 0) return unsupported("Range", "Columns(index)");
        return new CountObject(this.handle.rightCol - this.handle.leftCol + 1);
      case "count":
        return mkLong(
          (this.handle.bottomRow - this.handle.topRow + 1) * (this.handle.rightCol - this.handle.leftCol + 1),
        );
      case "offset": {
        const dr = args.length > 0 && args[0] !== null ? toLongArg(args[0]) : 0;
        const dc = args.length > 1 && args[1] !== null ? toLongArg(args[1]) : 0;
        const h = this.handle;
        return this.sub(h.topRow + dr, h.leftCol + dc, h.bottomRow + dr, h.rightCol + dc);
      }
      case "resize": {
        const h = this.handle;
        const rows = args.length > 0 && args[0] !== null ? toLongArg(args[0]) : h.bottomRow - h.topRow + 1;
        const cols = args.length > 1 && args[1] !== null ? toLongArg(args[1]) : h.rightCol - h.leftCol + 1;
        if (rows < 1 || cols < 1) throw new RuntimeError(1004, "Application-defined or object-defined error");
        return this.sub(h.topRow, h.leftCol, h.topRow + rows - 1, h.leftCol + cols - 1);
      }
      case "end": {
        const dir = args.length === 1 ? XL_DIRECTIONS.get(toLongArg(args[0])) : undefined;
        if (!dir) throw new RuntimeError(1004, "Application-defined or object-defined error");
        return new RangeObject(this.handle.end(dir));
      }
      default:
        return unsupported("Range", member);
    }
  }

  set(member: string, _args: Value[], value: Value): void {
    switch (member.toLowerCase()) {
      case "value":
      case "value2":
        this.handle.setValue(toWorkbook(value));
        return;
      default:
        unsupported("Range", member);
    }
  }

  defaultValue(): Value {
    return fromWorkbook(this.handle.getValue());
  }

  private address(): string {
    const h = this.handle;
    const first = `$${colLetters(h.leftCol)}$${h.topRow}`;
    if (h.topRow === h.bottomRow && h.leftCol === h.rightCol) return first;
    return `${first}:$${colLetters(h.rightCol)}$${h.bottomRow}`;
  }

  /** A range on the same sheet; outside the sheet is error 1004, as in Excel. */
  private sub(top: number, left: number, bottom: number, right: number): RangeObject {
    if (top < 1 || left < 1 || bottom > MAX_ROWS || right > MAX_COLS) {
      throw new RuntimeError(1004, "Application-defined or object-defined error");
    }
    return new RangeObject(this.handle.sheet.getRange(`${cellRef(top, left)}:${cellRef(bottom, right)}`));
  }
}

/** `Range.Rows` / `Range.Columns`: only `.Count` is supported. */
class CountObject implements VbObject {
  readonly typeName = "Range";

  constructor(private readonly count: number) {}

  get(member: string, args: Value[]): Value {
    if (member.toLowerCase() === "count" && args.length === 0) return mkLong(this.count);
    return unsupported("Range.Rows/Columns", member);
  }

  set(member: string): void {
    unsupported("Range.Rows/Columns", member);
  }
}

// ─── Worksheet ──────────────────────────────────────────────────────────────

/** `Rows` / `Columns` of a sheet. Only `.Count` is supported. */
class DimensionObject implements VbObject {
  readonly typeName: string;

  constructor(
    private readonly kind: "Rows" | "Columns",
  ) {
    this.typeName = kind === "Rows" ? "Range" : "Range";
  }

  get(member: string, args: Value[]): Value {
    if (member.toLowerCase() === "count" && args.length === 0) {
      return mkLong(this.kind === "Rows" ? MAX_ROWS : MAX_COLS);
    }
    return unsupported(this.kind, member);
  }

  set(member: string): void {
    unsupported(this.kind, member);
  }
}

export class WorksheetObject implements VbObject {
  readonly typeName = "Worksheet";

  constructor(readonly sheet: SheetHandle) {}

  private range(ref: string): RangeObject {
    try {
      return new RangeObject(this.sheet.getRange(ref));
    } catch {
      throw new RuntimeError(1004, "Application-defined or object-defined error");
    }
  }

  get(member: string, args: Value[]): Value {
    switch (member.toLowerCase()) {
      case "cells": {
        if (args.length !== 2) return unsupported("Worksheet", "Cells with " + args.length + " argument(s)");
        const row = toLongArg(args[0]);
        const col = toLongArg(args[1]);
        if (row < 1 || row > MAX_ROWS || col < 1 || col > MAX_COLS) {
          throw new RuntimeError(1004, "Application-defined or object-defined error");
        }
        return this.range(cellRef(row, col));
      }
      case "range": {
        if (args.length === 2) {
          // Range(Cells(r1, c1), Cells(r2, c2)): the rectangle spanned by the two cells.
          const [a, b] = args;
          if (!(a instanceof RangeObject) || !(b instanceof RangeObject) || a.handle.sheet.name !== this.sheet.name) {
            throw new RuntimeError(1004, "Application-defined or object-defined error");
          }
          const top = Math.min(a.handle.topRow, b.handle.topRow);
          const left = Math.min(a.handle.leftCol, b.handle.leftCol);
          const bottom = Math.max(a.handle.bottomRow, b.handle.bottomRow);
          const right = Math.max(a.handle.rightCol, b.handle.rightCol);
          return this.range(`${cellRef(top, left)}:${cellRef(bottom, right)}`);
        }
        if (args.length !== 1) return unsupported("Worksheet", "Range with " + args.length + " argument(s)");
        return this.range(toStr(args[0]));
      }
      case "rows":
        if (args.length !== 0) return unsupported("Worksheet", "Rows(index)");
        return new DimensionObject("Rows");
      case "columns":
        if (args.length !== 0) return unsupported("Worksheet", "Columns(index)");
        return new DimensionObject("Columns");
      case "name":
        return this.sheet.name;
      default:
        return unsupported("Worksheet", member);
    }
  }

  set(member: string): void {
    unsupported("Worksheet", member);
  }
}

// ─── Workbook ───────────────────────────────────────────────────────────────

export class WorkbookObject implements VbObject {
  readonly typeName = "Workbook";

  constructor(readonly workbook: WorkbookHandle) {}

  sheet(arg: Value): WorksheetObject {
    try {
      const key = typeof arg === "string" ? arg : toLongArg(arg);
      return new WorksheetObject(this.workbook.getSheet(key));
    } catch (e) {
      if (e instanceof RuntimeError) throw e;
      throw new RuntimeError(9, "Subscript out of range");
    }
  }

  get activeSheet(): WorksheetObject {
    return new WorksheetObject(this.workbook.activeSheet);
  }

  get(member: string, args: Value[]): Value {
    switch (member.toLowerCase()) {
      case "worksheets":
      case "sheets":
        if (args.length !== 1) return unsupported("Workbook", member + " with " + args.length + " argument(s)");
        return this.sheet(args[0]);
      case "activesheet":
        return this.activeSheet;
      default:
        return unsupported("Workbook", member);
    }
  }

  set(member: string): void {
    unsupported("Workbook", member);
  }
}

export { NOTHING };
