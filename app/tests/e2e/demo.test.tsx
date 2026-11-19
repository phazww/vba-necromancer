/**
 * End to end through the DOM only: the demo button, the Run button, the grid, the trace, the
 * graveyard tab and the download, compared with the hand-written oracle for demo_acts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { openWorkbook } from "@vba-necromancer/workbook";
import { App } from "../../src/App";
import { formatValue } from "../../src/model/format";
import { expectedFor } from "../helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("demo_acts through the UI", () => {
  it("exhume, run, grid, trace, graveyard, download", async () => {
    const forbidden = (name: string) =>
      vi.fn(() => {
        throw new Error(`network call: ${name}`);
      });
    const fetchSpy = forbidden("fetch");
    const xhr = forbidden("XMLHttpRequest");
    const ws = forbidden("WebSocket");
    const beacon = forbidden("sendBeacon");
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", xhr);
    vi.stubGlobal("WebSocket", ws);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({ media: query, matches: query.includes("min-width: 960px"), addEventListener() {}, removeEventListener() {} }),
    });
    const saveBlob = vi.fn();
    const oracle = expectedFor("demo_acts");
    const run = oracle.runs[0];

    const { container } = render(<App deps={{ saveBlob }} />);

    // 1. Exhume
    fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    expect(screen.getByRole("status").textContent).toBe("Exhuming");
    const exhumePanel = await screen.findByRole("region", { name: "Exhume" });
    expect(screen.getByRole("status").textContent).toBe("");
    expect(within(exhumePanel).getByText("Журнал")).toBeTruthy();
    expect(within(exhumePanel).getByText("Акты")).toBeTruthy();
    expect(within(exhumePanel).getByText("Module1")).toBeTruthy();
    const row = within(exhumePanel).getByText("Module1.BuildActs").closest("li") as HTMLElement;
    expect(within(row).getByText("Predicted: fully resurrected")).toBeTruthy();

    // 2. Nothing is highlighted before the run
    expect(container.querySelectorAll(".cell--changed")).toHaveLength(0);

    // 3. Run
    fireEvent.click(screen.getByRole("button", { name: "Run Module1.BuildActs" }));
    const bar = await screen.findByText("Fully resurrected", { selector: ".badge" });
    expect(bar).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Акты" }).getAttribute("aria-selected")).toBe("true");

    // 4. Every oracle cell is on screen, formatted, and marked changed
    const sheetCells = container.querySelectorAll<HTMLElement>('[role="gridcell"]');
    expect(sheetCells.length).toBeGreaterThan(0);
    for (const c of run.cells) {
      const cell = container.querySelector<HTMLElement>(`[data-row="${c.row}"][data-col="${c.col}"]`);
      expect(cell, `${c.sheet} R${c.row}C${c.col} is rendered`).not.toBeNull();
      expect(cell?.className).toContain("cell--changed");
      const shown = (cell?.textContent ?? "").replace(/^fx/, "");
      if (typeof c.value === "number") {
        expect(Math.abs(Number(shown) - c.value), `${c.row},${c.col}`).toBeLessThanOrEqual(oracle.numericTolerance);
      } else {
        expect(shown).toBe(formatValue(c.value));
      }
    }

    // 5. A trace row selects the cell and the source line
    const trace = within(screen.getByRole("region", { name: "Trace" }));
    fireEvent.click(trace.getByRole("checkbox", { name: "read" }));
    const first = trace.getAllByRole("option").find((o) => o.closest('[role="listbox"]') && o.querySelector(".kind")?.textContent === "write");
    if (!first) throw new Error("no write row");
    fireEvent.click(first);
    const [, a1] = (first.querySelector(".where")?.textContent ?? "").split("!");
    expect(a1).toBe("A1");
    expect(container.querySelector('[data-row="1"][data-col="1"]')?.getAttribute("aria-selected")).toBe("true");
    const current = container.querySelector<HTMLElement>('.src-line[aria-current="true"]');
    expect(current?.querySelector(".code")?.textContent).toContain('dst.Range("A1").Value = "Категория"');
    expect(first.querySelector(".src")?.textContent).toBe(`Module1:${current?.dataset.line}`);

    // 6. Graveyard
    fireEvent.click(screen.getByRole("tab", { name: /^Graveyard/ }));
    expect(within(screen.getByRole("region", { name: "Graveyard" })).getByText("Nothing in the graveyard")).toBeTruthy();

    // 7. Download
    fireEvent.click(screen.getByRole("button", { name: "Download .xlsx" }));
    expect(saveBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe("demo_acts-resurrected.xlsx");
    const wb = openWorkbook(new Uint8Array(await blob.arrayBuffer()));
    for (const c of run.cells) {
      const v = wb.getSheet(c.sheet).getCellValue(c.row, c.col);
      if (typeof c.value === "number") expect(Math.abs((v as number) - c.value)).toBeLessThanOrEqual(oracle.numericTolerance);
      else expect(v).toBe(c.value);
    }
    for (const e of run.empty ?? []) expect(wb.getSheet(e.sheet).getCellValue(e.row, e.col)).toBeNull();

    // 8. No network
    await waitFor(() => expect(true).toBe(true));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(ws).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });
});
