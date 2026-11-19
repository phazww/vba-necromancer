import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import * as XLSX from "xlsx";
import { openWorkbook } from "@vba-necromancer/workbook";
import { App } from "../../src/App";
import { exhume, exhumeParts } from "../../src/model/exhume";
import { initialState, reduce } from "../../src/state/reducer";
import { Grid, gridSize } from "../../src/ui/Grid";
import { fixtureBytes } from "../helpers";

type Cell = string | number | boolean | null;

function bookBytes(rows: Cell[][], extra?: (ws: XLSX.WorkSheet) => void): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  extra?.(ws);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

const sheetOf = (rows: Cell[][]) => openWorkbook(bookBytes(rows)).getSheet("Data");

function layout(el: HTMLElement, scrollTop: number, clientHeight = 480): void {
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: scrollTop, configurable: true, writable: true });
  fireEvent.scroll(el);
}

const noop = () => {};
const cells = (container: Element) => container.querySelectorAll('[role="gridcell"]');
const stops = (container: Element) => container.querySelectorAll('[role="gridcell"][tabindex="0"]');
const cellAt = (container: Element, row: number, col: number) =>
  container.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);

describe("Grid", () => {
  it("is a grid whose counts match the sheet size and has A, B, 1, 2 headers", () => {
    const sheet = sheetOf([["a", 1], ["b", 2]]);
    const size = gridSize(sheet);
    const { container } = render(<Grid sheet={sheet} selected={null} onSelectCell={noop} />);
    const grid = screen.getByRole("grid");
    // Counts include the header row and the header column.
    expect(grid.getAttribute("aria-rowcount")).toBe(String(size.rows + 1));
    expect(grid.getAttribute("aria-colcount")).toBe(String(size.cols + 1));
    expect(size).toEqual({ rows: 21, cols: 9 });
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent).slice(1, 3)).toEqual(["A", "B"]);
    expect(screen.getAllByRole("rowheader").map((h) => h.textContent).slice(0, 2)).toEqual(["1", "2"]);
    expect(cellAt(container, 1, 1)?.textContent).toBe("a");
    expect(cellAt(container, 2, 2)?.textContent).toBe("2");
  });

  it("renders a window of a 5000 x 12 sheet: at most 400 cells, row 101 present, row 1 absent", () => {
    const rows: Cell[][] = Array.from({ length: 5000 }, (_, r) => Array.from({ length: 12 }, (_, c) => r * 100 + c));
    const sheet = sheetOf(rows);
    const { container } = render(<Grid sheet={sheet} selected={null} onSelectCell={noop} />);
    layout(screen.getByRole("grid"), 2400);
    expect(cells(container).length).toBeLessThanOrEqual(400);
    expect(cellAt(container, 101, 1)).not.toBeNull();
    expect(cellAt(container, 1, 1)).toBeNull();
    expect(cellAt(container, 101, 1)?.textContent).toBe(String(100 * 100));
  });

  it("marks a changed cell with the old value and a class; unchanged cells have neither", () => {
    const sheet = sheetOf([["new", "same"]]);
    const changes = new Map([[1 * 16385 + 1, { before: "old" as string | null }]]);
    const { container } = render(<Grid sheet={sheet} changes={changes} selected={null} onSelectCell={noop} />);
    const changed = cellAt(container, 1, 1);
    expect(changed?.getAttribute("aria-label")).toBe("new, changed, was old");
    expect(changed?.className).toContain("cell--changed");
    const same = cellAt(container, 1, 2);
    expect(same?.getAttribute("aria-label")).toBeNull();
    expect(same?.className).not.toContain("cell--changed");
  });

  it("says 'was empty' for a cell that had no value", () => {
    const sheet = sheetOf([["x"]]);
    const { container } = render(
      <Grid sheet={sheet} changes={new Map([[16386, { before: null }]])} selected={null} onSelectCell={noop} />,
    );
    expect(cellAt(container, 1, 1)?.getAttribute("aria-label")).toBe("x, changed, was empty");
  });

  it("shows booleans as TRUE and FALSE and truncates a long string, keeping the full text accessible", () => {
    const long = "ж".repeat(300);
    const sheet = sheetOf([[true, false, long]]);
    const { container } = render(<Grid sheet={sheet} selected={null} onSelectCell={noop} />);
    expect(cellAt(container, 1, 1)?.textContent).toBe("TRUE");
    expect(cellAt(container, 1, 2)?.textContent).toBe("FALSE");
    const c = cellAt(container, 1, 3);
    expect(c?.textContent?.length).toBeLessThan(300);
    expect(c?.getAttribute("aria-label")).toBe(long);
  });

  it("marks a formula cell with fx and a description", () => {
    const bytes = bookBytes([[1, 2]], (ws) => {
      ws["C1"] = { t: "n", v: 3, f: "A1+B1" };
      ws["!ref"] = "A1:C1";
    });
    const sheet = openWorkbook(bytes).getSheet("Data");
    const { container } = render(<Grid sheet={sheet} selected={null} onSelectCell={noop} />);
    const c = cellAt(container, 1, 3);
    expect(c?.textContent).toBe("fx3");
    expect(c?.querySelector(".fx")?.textContent).toBe("fx");
    expect(c?.getAttribute("aria-description")).toBe("formula, value not recalculated");
    expect(cellAt(container, 1, 1)?.getAttribute("aria-description")).toBeNull();
  });
});

describe("Grid keyboard", () => {
  const rows: Cell[][] = Array.from({ length: 100 }, (_, r) => Array.from({ length: 5 }, (_, c) => r * 10 + c));
  const key = (el: Element, k: string, init: object = {}) => fireEvent.keyDown(el, { key: k, ...init });
  const activeCell = () => {
    const el = document.activeElement as HTMLElement;
    return [Number(el.dataset.row), Number(el.dataset.col)];
  };

  it("has exactly one tab stop and moves it with the arrow keys", () => {
    const { container } = render(<Grid sheet={sheetOf(rows)} selected={null} onSelectCell={noop} />);
    expect(stops(container)).toHaveLength(1);
    const first = cellAt(container, 1, 1) as HTMLElement;
    first.focus();
    key(first, "ArrowDown");
    expect(activeCell()).toEqual([2, 1]);
    key(document.activeElement as Element, "ArrowRight");
    expect(activeCell()).toEqual([2, 2]);
    expect(stops(container)).toHaveLength(1);
    expect(stops(container)[0]).toBe(document.activeElement);
    key(document.activeElement as Element, "ArrowUp");
    key(document.activeElement as Element, "ArrowUp");
    expect(activeCell()).toEqual([1, 2]);
  });

  it("Home, End, Ctrl+Home and PageDown", () => {
    const { container } = render(<Grid sheet={sheetOf(rows)} selected={null} onSelectCell={noop} />);
    const first = cellAt(container, 1, 1) as HTMLElement;
    first.focus();
    key(first, "End");
    expect(activeCell()).toEqual([1, 5]);
    key(document.activeElement as Element, "Home");
    expect(activeCell()).toEqual([1, 1]);
    key(document.activeElement as Element, "PageDown");
    expect(activeCell()[0]).toBeGreaterThan(10);
    key(document.activeElement as Element, "ArrowRight");
    key(document.activeElement as Element, "Home", { ctrlKey: true });
    expect(activeCell()).toEqual([1, 1]);
    expect(stops(container)).toHaveLength(1);
  });

  it("stays inside the grid at the edges", () => {
    const { container } = render(<Grid sheet={sheetOf([["a"]])} selected={null} onSelectCell={noop} />);
    const first = cellAt(container, 1, 1) as HTMLElement;
    first.focus();
    key(first, "ArrowUp");
    key(document.activeElement as Element, "ArrowLeft");
    expect(activeCell()).toEqual([1, 1]);
  });

  it("Enter selects the focused cell", () => {
    const picked: number[][] = [];
    const { container } = render(<Grid sheet={sheetOf(rows)} selected={null} onSelectCell={(r, c) => picked.push([r, c])} />);
    const first = cellAt(container, 1, 1) as HTMLElement;
    first.focus();
    key(first, "ArrowDown");
    key(document.activeElement as Element, "Enter");
    expect(picked).toEqual([[2, 1]]);
  });

  it("scrolls a selection from outside into the window and marks it selected", () => {
    const big: Cell[][] = Array.from({ length: 500 }, (_, r) => [r]);
    const { container } = render(<Grid sheet={sheetOf(big)} selected={{ row: 300, col: 1 }} onSelectCell={noop} />);
    const c = cellAt(container, 300, 1);
    expect(c?.getAttribute("aria-selected")).toBe("true");
    expect(c?.className).toContain("cell--selected");
    expect(stops(container)[0]).toBe(c);
  });
});

describe("GridView in the app", () => {
  it("shows the formulas note only on a sheet that has a formula", () => {
    const withFormula = bookBytes([[1, 2]], (ws) => {
      ws["C1"] = { t: "n", v: 3, f: "A1+B1" };
      ws["!ref"] = "A1:C1";
    });
    const plain = bookBytes([[1, 2]]);
    const load = (name: string, bytes: Uint8Array) =>
      reduce(initialState(), { type: "load-ok", exhumed: exhumeParts(name, bytes, []), notice: null });
    const a = render(<App initial={load("f.xlsx", withFormula)} />);
    expect(screen.getByText("Formulas are not recalculated. Cached values from the file are shown.")).toBeTruthy();
    a.unmount();
    render(<App initial={load("p.xlsx", plain)} />);
    expect(screen.queryByText(/Formulas are not recalculated\. Cached/)).toBeNull();
  });

  it("before a run no cell has the changed class", () => {
    const state = reduce(initialState(), { type: "load-ok", exhumed: exhume("demo_acts.xlsm", fixtureBytes("demo_acts")), notice: null });
    const { container } = render(<App initial={state} />);
    expect(cells(container).length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".cell--changed")).toHaveLength(0);
    expect(screen.getByRole("tab", { name: "Журнал" }).getAttribute("aria-selected")).toBe("true");
  });
});
