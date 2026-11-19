import { describe, it, expect } from "vitest";
import type { TraceEvent } from "@vba-necromancer/vba";
import { fireEvent, render, screen, within } from "@testing-library/preact";
import { App } from "../../src/App";
import { exhume } from "../../src/model/exhume";
import { resurrect } from "../../src/model/resurrect";
import { filterTrace } from "../../src/model/traceFilter";
import { initialState, reduce } from "../../src/state/reducer";
import type { AppState } from "../../src/state/types";
import { fixtureBytes, srcText } from "../helpers";

const loaded = (name: string) => reduce(initialState(), { type: "load-ok", exhumed: exhume(`${name}.xlsm`, fixtureBytes(name)), notice: null });
function ran(name: string, macro: string): AppState {
  const s = loaded(name);
  if (!s.exhumed) throw new Error("not loaded");
  return reduce(s, { type: "run-done", view: resurrect(s.exhumed, macro) });
}
const panel = () => within(screen.getByRole("region", { name: "Trace" }));
const options = () => {
  const list = panel().queryByRole("listbox");
  return list ? within(list).queryAllByRole("option") : [];
};
const allKinds = new Set(["read", "write", "skipped"] as const);

describe("trace panel", () => {
  it("before a run says no macro has run", () => {
    render(<App initial={loaded("demo_acts")} />);
    expect(panel().getByText("No macro has run yet.")).toBeTruthy();
    expect(panel().queryByRole("listbox")).toBeNull();
  });

  it("first write row of demo_acts: cell, empty before, the new value, and the source line", () => {
    render(<App initial={ran("demo_acts", "Module1.BuildActs")} />);
    // The first 200 or so events are reads of the journal; hide them to reach the first write.
    fireEvent.click(panel().getByRole("checkbox", { name: "read" }));
    const row = options().find((o) => o.querySelector(".kind")?.textContent === "write");
    if (!row) throw new Error("no write row");
    expect(row.querySelector(".where")?.textContent).toBe("Акты!A1");
    expect(row.querySelector(".before")?.textContent).toBe("empty");
    expect(row.querySelector(".after")?.textContent).toBe("Категория");
    const lines = srcText("demo_acts", "Module1").split(/\r?\n/);
    const line = lines.findIndex((l) => l.includes('dst.Range("A1").Value = "Категория"')) + 1;
    expect(line).toBeGreaterThan(0);
    expect(row.querySelector(".src")?.textContent).toBe(`Module1:${line}`);
    expect(row.getAttribute("aria-label")).toBe(`write Акты!A1, was empty, now Категория, Module1:${line}`);
  });

  it("the kind filter hides reads and updates the count; the total stays visible", () => {
    const state = ran("demo_acts", "Module1.BuildActs");
    if (state.run.status !== "done") throw new Error("no run");
    const trace = state.run.view.result.trace;
    const writes = trace.filter((e) => e.kind === "write").length;
    render(<App initial={state} />);
    expect(panel().getByText(`${trace.length.toLocaleString("en-US")} of ${trace.length.toLocaleString("en-US")} events`)).toBeTruthy();
    fireEvent.click(panel().getByRole("checkbox", { name: "read" }));
    expect(panel().getByText(`${writes.toLocaleString("en-US")} of ${trace.length.toLocaleString("en-US")} events`)).toBeTruthy();
    expect(options().every((o) => o.querySelector(".kind")?.textContent === "write")).toBe(true);
  });

  it("the sheet filter keeps only events on that sheet", () => {
    render(<App initial={ran("demo_acts", "Module1.BuildActs")} />);
    fireEvent.change(panel().getByRole("combobox"), { target: { value: "Акты" } });
    expect(options().length).toBeGreaterThan(0);
    for (const o of options()) expect(o.querySelector(".where")?.textContent).toMatch(/^Акты!/);
  });

  it("clicking a row dispatches one select-trace, marks the row, and a filter that hides it keeps the selection", () => {
    const { container } = render(<App initial={ran("demo_acts", "Module1.BuildActs")} />);
    fireEvent.click(panel().getByRole("checkbox", { name: "read" }));
    const row = options().find((o) => o.querySelector(".kind")?.textContent === "write") as HTMLElement;
    fireEvent.click(row);
    const selectedAfter = options().find((o) => o.getAttribute("aria-selected") === "true");
    expect(selectedAfter?.getAttribute("data-index")).toBe(row.getAttribute("data-index"));
    expect(container.querySelectorAll('.trace-row[aria-selected="true"]')).toHaveLength(1);
    // the grid and the source follow
    expect(container.querySelector('[role="gridcell"][aria-selected="true"]')).not.toBeNull();
    expect(container.querySelector('.src-line[aria-current="true"]')).not.toBeNull();
    // hide writes (reads are already hidden): the row disappears, nothing is marked selected in the list, the grid still shows the selection
    fireEvent.click(panel().getByRole("checkbox", { name: "write" }));
    expect(options().filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(0);
    expect(container.querySelector('[role="gridcell"][aria-selected="true"]')).not.toBeNull();
  });

  it("a skipped row shows the construct and no cell address, and marks only the line", () => {
    const { container } = render(<App initial={ran("graveyard", "Module1.ExportReport")} />);
    const skipped = options().filter((o) => o.querySelector(".kind")?.textContent === "skipped");
    expect(skipped.length).toBeGreaterThan(0);
    const first = skipped[0];
    expect(first.querySelector(".where")?.textContent).toBe("CreateObject");
    expect(first.textContent).not.toMatch(/!/);
    fireEvent.click(first);
    expect(container.querySelector('.src-line[aria-current="true"]')?.getAttribute("data-line")).toBe("11");
    expect(container.querySelector('[role="gridcell"][aria-selected="true"]')).toBeNull();
  });

  it("the listbox has one tab stop and the arrow keys move the active row", () => {
    render(<App initial={ran("demo_acts", "Module1.BuildActs")} />);
    const stops = () => options().filter((o) => o.tabIndex === 0);
    expect(stops()).toHaveLength(1);
    const first = options()[0];
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(options()[1]);
    expect(stops()).toEqual([options()[1]]);
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement?.getAttribute("data-pos")).not.toBe("1");
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(document.activeElement).toBe(options()[0]);
  });

  it("Enter and Space select the focused row", () => {
    render(<App initial={ran("demo_acts", "Module1.BuildActs")} />);
    const row = options()[2];
    fireEvent.keyDown(row, { key: "Enter" });
    expect(options().find((o) => o.getAttribute("aria-selected") === "true")?.getAttribute("data-pos")).toBe("2");
    fireEvent.keyDown(options()[3], { key: " " });
    expect(options().find((o) => o.getAttribute("aria-selected") === "true")?.getAttribute("data-pos")).toBe("3");
  });

  it("a new run clears the selection", () => {
    const state = reduce(ran("demo_acts", "Module1.BuildActs"), { type: "select-trace", eventIndex: 0 });
    expect(state.selection).not.toBeNull();
    expect(reduce(state, { type: "run-start", macroId: "Module1.BuildActs" }).selection).toBeNull();
  });
});

describe("trace at scale", () => {
  const big: TraceEvent[] = Array.from({ length: 30_000 }, (_, i) => ({
    kind: i % 3 === 0 ? "write" : "read",
    sheet: i % 2 === 0 ? "Журнал" : "Акты",
    row: (i % 500) + 1,
    col: (i % 6) + 1,
    ...(i % 3 === 0 ? { before: null, after: i } : { value: i }),
    statement: { module: "Module1", line: 10 },
  })) as TraceEvent[];

  it("draws at most 100 rows of 30 000 events", () => {
    const base = ran("demo_acts", "Module1.BuildActs");
    if (base.run.status !== "done") throw new Error("no run");
    const state: AppState = { ...base, run: { ...base.run, view: { ...base.run.view, result: { ...base.run.view.result, trace: big } } } };
    render(<App initial={state} />);
    expect(options().length).toBeGreaterThan(0);
    expect(options().length).toBeLessThanOrEqual(100);
    expect(panel().getByText("30,000 of 30,000 events")).toBeTruthy();
  });

  it("filters 30 000 events in under 50 ms", () => {
    const t0 = performance.now();
    const shown = filterTrace(big, { kinds: new Set(["write"]), sheet: "Журнал" });
    const ms = performance.now() - t0;
    console.log(`filterTrace 30 000 events: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(50);
    expect(shown.length).toBe(big.filter((e) => e.kind === "write" && e.sheet === "Журнал").length);
    expect(filterTrace(big, { kinds: allKinds, sheet: null })).toHaveLength(30_000);
  });
});
