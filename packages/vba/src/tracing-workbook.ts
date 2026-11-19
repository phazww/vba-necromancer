/**
 * Decorator that records every cell read and write of the wrapped workbook.
 * The interpreter sets `current` to the statement being executed.
 */

import type { RangeHandle, SheetHandle, VBAValue, WorkbookHandle, XlDirection } from "./host.js";
import type { SourceRef, TraceEvent } from "./trace.js";

class TracingRange implements RangeHandle {
  constructor(
    private readonly inner: RangeHandle,
    readonly sheet: TracingSheet,
  ) {}

  get topRow(): number {
    return this.inner.topRow;
  }
  get leftCol(): number {
    return this.inner.leftCol;
  }
  get bottomRow(): number {
    return this.inner.bottomRow;
  }
  get rightCol(): number {
    return this.inner.rightCol;
  }

  getValue(): VBAValue {
    if (this.topRow === this.bottomRow && this.leftCol === this.rightCol) {
      return this.sheet.getCellValue(this.topRow, this.leftCol);
    }
    const rows: VBAValue[][] = [];
    for (let r = this.topRow; r <= this.bottomRow; r++) {
      const row: VBAValue[] = [];
      for (let c = this.leftCol; c <= this.rightCol; c++) row.push(this.sheet.getCellValue(r, c));
      rows.push(row);
    }
    return rows;
  }

  setValue(v: VBAValue): void {
    for (let r = this.topRow; r <= this.bottomRow; r++) {
      for (let c = this.leftCol; c <= this.rightCol; c++) {
        let cell: VBAValue = v;
        if (Array.isArray(v)) {
          const row = v[r - this.topRow];
          cell = Array.isArray(row) ? (row[c - this.leftCol] ?? null) : null;
        }
        this.sheet.setCellValue(r, c, cell);
      }
    }
  }

  /** The search for the end of a block is not a read the macro asked for, so it is not traced. */
  end(direction: XlDirection): RangeHandle {
    return new TracingRange(this.inner.end(direction), this.sheet);
  }
}

class TracingSheet implements SheetHandle {
  constructor(
    private readonly inner: SheetHandle,
    private readonly owner: TracingWorkbook,
  ) {}

  get name(): string {
    return this.inner.name;
  }
  get index(): number {
    return this.inner.index;
  }

  getCellValue(row: number, col: number): VBAValue {
    const value = this.inner.getCellValue(row, col);
    this.owner.record({ kind: "read", sheet: this.name, row, col, value, statement: this.owner.current });
    return value;
  }

  setCellValue(row: number, col: number, value: VBAValue): void {
    const before = this.inner.getCellValue(row, col);
    this.inner.setCellValue(row, col, value);
    const after = this.inner.getCellValue(row, col);
    this.owner.record({ kind: "write", sheet: this.name, row, col, before, after, statement: this.owner.current });
  }

  getCellFormula(row: number, col: number): string | null {
    return this.inner.getCellFormula(row, col);
  }

  getRange(ref: string): RangeHandle {
    return new TracingRange(this.inner.getRange(ref), this);
  }

  usedRowCount(): number {
    return this.inner.usedRowCount();
  }

  usedColCount(): number {
    return this.inner.usedColCount();
  }
}

export class TracingWorkbook implements WorkbookHandle {
  /** Statement being executed; stamped on every event. */
  current: SourceRef = { module: "", line: 0 };
  private readonly sheetCache = new Map<SheetHandle, TracingSheet>();

  constructor(
    private readonly inner: WorkbookHandle,
    public events: TraceEvent[],
    public enabled = true,
  ) {}

  record(event: TraceEvent): void {
    if (this.enabled) this.events.push(event);
  }

  private wrap(sheet: SheetHandle): TracingSheet {
    let wrapped = this.sheetCache.get(sheet);
    if (!wrapped) {
      wrapped = new TracingSheet(sheet, this);
      this.sheetCache.set(sheet, wrapped);
    }
    return wrapped;
  }

  get sheets(): Array<{ name: string; index: number }> {
    return this.inner.sheets;
  }

  get activeSheet(): SheetHandle {
    return this.wrap(this.inner.activeSheet);
  }

  getSheet(nameOrIndex: string | number): SheetHandle {
    return this.wrap(this.inner.getSheet(nameOrIndex));
  }
}
