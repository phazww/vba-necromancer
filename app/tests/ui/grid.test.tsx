import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import * as XLSX from "xlsx";
import { openWorkbook } from "@vba-necromancer/workbook";
import { parse, runMacro, tokenize } from "@vba-necromancer/vba";
import axe from "axe-core";
import { App } from "../../src/App";
import { cellKey, deriveChanges } from "../../src/model/changes";
import { resolveButtons } from "../../src/model/buttons";
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

describe("Button marks in the grid (BTN-06)", () => {
  const rows: Cell[][] = [
    ["a", 5],
    ["b", 6],
  ];
  const marks = new Map([
    [cellKey(1, 2), "Build"],
    [cellKey(5, 5), "Empty cell"],
  ]);

  it("shows the caption in the anchor cell, also when the cell is empty", () => {
    const { container } = render(
      <Grid sheet={sheetOf(rows)} selected={null} marks={marks} onSelectCell={noop} />,
    );
    expect(cellAt(container, 5, 5)?.querySelector(".grid-mark")?.textContent).toBe("Empty cell");
  });

  it("keeps the value as text and as accessible name; the mark is hidden and not focusable", () => {
    const { container } = render(
      <Grid sheet={sheetOf(rows)} selected={null} marks={marks} onSelectCell={noop} />,
    );
    const cell = cellAt(container, 1, 2) as HTMLElement;
    expect(cell.querySelector(".cell-value")?.textContent).toBe("5");
    expect(screen.getByRole("gridcell", { name: "5" })).toBe(cell);
    const mark = cell.querySelector(".grid-mark") as HTMLElement;
    expect(mark.textContent).toBe("Build");
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(mark.hasAttribute("tabindex")).toBe(false);
    expect(cell.querySelectorAll("[tabindex]")).toHaveLength(0);
    expect(cell.querySelectorAll("button, a, input")).toHaveLength(0);
  });

  it("leaves unmarked cells unchanged", () => {
    const plain = render(<Grid sheet={sheetOf(rows)} selected={null} onSelectCell={noop} />);
    const before = cellAt(plain.container, 1, 1)?.outerHTML;
    plain.unmount();
    const { container } = render(
      <Grid sheet={sheetOf(rows)} selected={null} marks={marks} onSelectCell={noop} />,
    );
    expect(cellAt(container, 1, 1)?.outerHTML).toBe(before);
    expect(cellAt(container, 1, 1)?.className).not.toContain("cell--marked");
    expect(container.querySelectorAll(".grid-mark")).toHaveLength(2);
  });

  it("does not render a mark for a cell outside the rendered window", () => {
    const far = new Map([[cellKey(900, 1), "Far away"]]);
    const { container } = render(
      <Grid sheet={sheetOf(rows)} selected={null} marks={far} onSelectCell={noop} />,
    );
    expect(container.querySelectorAll(".grid-mark")).toHaveLength(0);
    expect(container.textContent).not.toContain("Far away");
  });

  it("has no axe violations with a mark in the grid", async () => {
    const { container } = render(
      <Grid sheet={sheetOf(rows)} selected={null} marks={marks} onSelectCell={noop} />,
    );
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("marks appear only on the visible sheet", () => {
    const base = exhume("demo_acts.xlsm", fixtureBytes("demo_acts"));
    const buttons = resolveButtons(
      [
        {
          sheet: "Журнал",
          caption: "On journal",
          anchor: "H2",
          macroRef: "BuildActs",
          source: "form-control",
        },
        {
          sheet: "Акты",
          caption: "On acts",
          anchor: "H3",
          macroRef: "BuildActs",
          source: "form-control",
        },
      ],
      base.macros,
      base.fileName,
    );
    const state = reduce(initialState(), {
      type: "load-ok",
      exhumed: { ...base, buttons },
      notice: null,
    });
    const { container } = render(<App initial={state} />);
    expect(Array.from(container.querySelectorAll(".grid-mark")).map((m) => m.textContent)).toEqual([
      "On journal",
    ]);
    fireEvent.click(screen.getByRole("tab", { name: "Акты" }));
    expect(Array.from(container.querySelectorAll(".grid-mark")).map((m) => m.textContent)).toEqual([
      "On acts",
    ]);
  });

  it("end to end: demo_invoice.xlsm shows the mark Build invoice in H2 of Log", () => {
    const state = reduce(initialState(), {
      type: "load-ok",
      exhumed: exhume("demo_invoice.xlsm", fixtureBytes("demo_invoice")),
      notice: null,
    });
    const { container } = render(<App initial={state} />);
    const h2 = cellAt(container, 2, 8) as HTMLElement;
    expect(h2.querySelector(".grid-mark")?.textContent).toBe("Build invoice");
    expect(container.querySelectorAll(".grid-mark")).toHaveLength(1);
  });
});

describe("Grid number formats (FMT-01, FMT-04, FMT-05)", () => {
  function formatted(): Uint8Array {
    return bookBytes([[46296, 7, 1234.5, "text", 0.125]], (ws) => {
      ws["A1"] = { t: "n", v: 46296, z: "yyyy-mm-dd" };
      ws["B1"] = { t: "n", v: 7, z: "0" };
      ws["C1"] = { t: "n", v: 1234.5 };
      ws["E1"] = { t: "n", v: 0.125, z: "0.0%" };
    });
  }
  const gridOf = (sheet: ReturnType<typeof sheetOf>, changes?: ReadonlyMap<number, { before: number }>) =>
    render(<Grid sheet={sheet} changes={changes} selected={null} onSelectCell={noop} />).container;

  it("FMT-01 a numeric cell with a format shows the formatted text, others are unchanged", () => {
    const c = gridOf(openWorkbook(formatted()).getSheet("Data"));
    expect(cellAt(c, 1, 1)?.textContent).toBe("2026-10-01");
    expect(cellAt(c, 1, 3)?.textContent).toBe("1234.5");
    expect(cellAt(c, 1, 4)?.textContent).toBe("text");
    expect(cellAt(c, 1, 5)?.textContent).toBe("12.5%");
    expect(cellAt(c, 1, 1)?.className).toContain("cell--number");
  });

  it("FMT-01 a sheet without getCellFormat shows the plain number", () => {
    const sheet = openWorkbook(formatted()).getSheet("Data");
    const plain = new Proxy(sheet, {
      get: (target, prop) => (prop === "getCellFormat" ? undefined : Reflect.get(target, prop)),
    });
    const c = gridOf(plain);
    expect(cellAt(c, 1, 1)?.textContent).toBe("46296");
  });

  it("FMT-04 the accessible name and the hover text give the stored value next to the formatted one", () => {
    const c = gridOf(openWorkbook(formatted()).getSheet("Data"));
    const cell = cellAt(c, 1, 1);
    expect(cell?.getAttribute("aria-label")).toBe("2026-10-01, stored 46296");
    expect(cell?.getAttribute("title")).toBe("stored 46296");
    expect(cellAt(c, 1, 5)?.getAttribute("aria-label")).toBe("12.5%, stored 0.125");
  });

  it("FMT-04 no stored suffix when the formatted text equals the plain text", () => {
    const c = gridOf(openWorkbook(formatted()).getSheet("Data"));
    expect(cellAt(c, 1, 2)?.getAttribute("aria-label")).toBeNull();
    expect(cellAt(c, 1, 2)?.getAttribute("title")).toBeNull();
    expect(cellAt(c, 1, 3)?.getAttribute("aria-label")).toBeNull();
  });

  it("FMT-05 FMT-04 a macro write keeps the format; a changed cell says what was stored before", () => {
    const wb = openWorkbook(formatted());
    const asts = [parse(tokenize('Sub M()\n  Range("A1").Value = Range("A1").Value + 1\n  Range("C1").Value = 5\nEnd Sub\n'), "Module1")];
    const result = runMacro("Module1.M", asts, wb);
    expect(result.status).toBe("fully resurrected");
    const changes = deriveChanges(result.trace).bySheet.get("Data");
    const c = gridOf(wb.getSheet("Data"), changes as ReadonlyMap<number, { before: number }>);
    expect(cellAt(c, 1, 1)?.textContent).toBe("2026-10-02");
    expect(cellAt(c, 1, 1)?.getAttribute("aria-label")).toBe("2026-10-02, stored 46297, changed, was 46296");
    expect(cellAt(c, 1, 3)?.textContent).toBe("5");
    expect(cellAt(c, 1, 3)?.getAttribute("aria-label")).toBe("5, changed, was 1234.5");
    expect(result.trace.some((e) => e.kind === "write" && e.after === 46297 && e.before === 46296)).toBe(true);
  });

  it("FMT-04 the grid with formatted cells has no axe violations", async () => {
    const c = gridOf(openWorkbook(formatted()).getSheet("Data"));
    const res = await axe.run(c);
    expect(res.violations).toEqual([]);
  });
});
