import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/preact";
import * as XLSX from "xlsx";
import { App } from "../../src/App";
import { exhumeParts } from "../../src/model/exhume";
import { resurrect } from "../../src/model/resurrect";
import { initialState, reduce } from "../../src/state/reducer";
import { srcText } from "../helpers";

describe("rendering a 5 000 row run", () => {
  it("draws at most 400 cells and 100 trace rows", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => [`01.10.2026`, `К-${i % 20}`, `Категория ${i % 20}`, (i % 17) + 0.5, 1.5, 100 + (i % 90)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Дата", "Код", "Категория", "Объём", "Норма", "Цена"], ...rows]), "Журнал");
    XLSX.utils.book_append_sheet(wb, {}, "Акты");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const exhumed = exhumeParts("big.xlsx", bytes, [{ name: "Module1", type: "procedural", source: srcText("demo_acts", "Module1") }]);
    const view = resurrect(exhumed, "Module1.BuildActs");
    let state = reduce(initialState(), { type: "load-ok", exhumed, notice: null });
    state = reduce(state, { type: "run-done", view });
    state = reduce(state, { type: "select-sheet", sheet: "Журнал" });

    const { container } = render(<App initial={state} />);
    const cells = container.querySelectorAll('[role="gridcell"]').length;
    const list = within(screen.getByRole("region", { name: "Trace" })).getByRole("listbox");
    const traceRows = within(list).getAllByRole("option").length;
    console.log(`perf render: ${cells} cell nodes, ${traceRows} trace row nodes, ${view.result.trace.length} events`);
    expect(cells).toBeGreaterThan(0);
    expect(cells).toBeLessThanOrEqual(400);
    expect(traceRows).toBeGreaterThan(0);
    expect(traceRows).toBeLessThanOrEqual(100);
  });
});
