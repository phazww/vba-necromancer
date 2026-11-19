import * as XLSX from "xlsx";
import { SheetRange, parseRef, type RangeSheet } from "./range.js";
import type { RangeHandle, SaveableWorkbook, SheetHandle, VBAValue } from "./types.js";

/** Days between the Excel epoch (1899-12-30) and the Unix epoch. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function cellToValue(cell: XLSX.CellObject | undefined): VBAValue {
  if (!cell) return null;
  switch (cell.t) {
    case "n":
      return typeof cell.v === "number" ? cell.v : null;
    case "s":
      return cell.v === undefined || cell.v === null ? null : String(cell.v);
    case "b":
      return Boolean(cell.v);
    case "d":
      return cell.v instanceof Date ? (cell.v.getTime() - EXCEL_EPOCH_MS) / 86_400_000 : null;
    case "e":
      // Error cells (#N/A, #DIV/0!) come back as their text; VBA's CVErr values are not modelled.
      return cell.w ?? (cell.v === undefined ? null : String(cell.v));
    default:
      return null; // "z" stub: empty
  }
}

export class SheetJSSheet implements RangeSheet {
  constructor(
    readonly name: string,
    readonly index: number,
    private readonly ws: XLSX.WorkSheet,
  ) {}

  getCellValue(row: number, col: number): VBAValue {
    return cellToValue(this.ws[XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })]);
  }

  /** The formula text of a cell with a leading "=", or null when the cell holds no formula. */
  getCellFormula(row: number, col: number): string | null {
    const f = (this.ws[XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })] as XLSX.CellObject | undefined)?.f;
    return f ? `=${f}` : null;
  }

  setCellValue(row: number, col: number, value: VBAValue): void {
    const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
    if (value === null) {
      delete this.ws[addr];
      return;
    }
    if (Array.isArray(value)) throw new Error("Cannot store an array in a single cell");
    const cell: XLSX.CellObject =
      typeof value === "number"
        ? { t: "n", v: value }
        : typeof value === "boolean"
          ? { t: "b", v: value }
          : { t: "s", v: value };
    this.ws[addr] = cell;
    this.growRef(row, col);
  }

  private growRef(row: number, col: number): void {
    const ref = this.ws["!ref"];
    if (!ref) {
      this.ws["!ref"] = XLSX.utils.encode_range({ s: { r: row - 1, c: col - 1 }, e: { r: row - 1, c: col - 1 } });
      return;
    }
    const r = XLSX.utils.decode_range(ref);
    r.s.r = Math.min(r.s.r, row - 1);
    r.s.c = Math.min(r.s.c, col - 1);
    r.e.r = Math.max(r.e.r, row - 1);
    r.e.c = Math.max(r.e.c, col - 1);
    this.ws["!ref"] = XLSX.utils.encode_range(r);
  }

  getRange(ref: string): RangeHandle {
    const p = parseRef(ref);
    return new SheetRange(this, p.top, p.left, p.bottom, p.right);
  }

  usedRowCount(): number {
    const ref = this.ws["!ref"];
    return ref ? XLSX.utils.decode_range(ref).e.r + 1 : 0;
  }

  usedColCount(): number {
    const ref = this.ws["!ref"];
    return ref ? XLSX.utils.decode_range(ref).e.c + 1 : 0;
  }
}

export class SheetJSWorkbook implements SaveableWorkbook {
  private readonly all: SheetJSSheet[];

  constructor(private readonly wb: XLSX.WorkBook) {
    this.all = wb.SheetNames.map((name, i) => new SheetJSSheet(name, i + 1, wb.Sheets[name]));
  }

  get sheets(): Array<{ name: string; index: number }> {
    return this.all.map((s) => ({ name: s.name, index: s.index }));
  }

  get activeSheet(): SheetHandle {
    const view = this.wb.Workbook?.Views?.[0] as { activeTab?: number } | undefined;
    const tab = view?.activeTab ?? 0;
    return this.all[tab] ?? this.all[0];
  }

  getSheet(nameOrIndex: string | number): SheetHandle {
    const found =
      typeof nameOrIndex === "number"
        ? this.all[nameOrIndex - 1]
        : this.all.find((s) => s.name.toLowerCase() === nameOrIndex.toLowerCase());
    if (!found) throw new Error(`No sheet: ${String(nameOrIndex)}`);
    return found;
  }

  save(): Uint8Array {
    const out = XLSX.write(this.wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    return new Uint8Array(out);
  }
}

/** Reads .xlsx / .xlsm / .xls bytes. VBA is not read here (see packages/ovba). */
export function openWorkbook(bytes: Uint8Array): SaveableWorkbook {
  return new SheetJSWorkbook(XLSX.read(bytes, { type: "array", cellFormula: true, cellNF: true }));
}
