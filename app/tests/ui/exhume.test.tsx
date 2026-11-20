import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import * as XLSX from "xlsx";
import { App } from "../../src/App";
import { exhume, exhumeParts } from "../../src/model/exhume";
import { resurrect } from "../../src/model/resurrect";
import type { Exhumed } from "../../src/model/types";
import { initialState, reduce } from "../../src/state/reducer";
import type { AppState } from "../../src/state/types";
import { fixtureBytes } from "../helpers";

async function loadDemo(title: string, fileName: string) {
  const view = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: title }));
  await screen.findByText(fileName);
  return view;
}

const stateWith = (exhumed: Exhumed): AppState => reduce(initialState(), { type: "load-ok", exhumed, notice: null });
const rowOf = (id: string): HTMLElement => {
  const li = within(screen.getByRole("region", { name: "Exhume" })).getByText(id).closest("li");
  if (!li) throw new Error(`no row for ${id}`);
  return li;
};

describe("exhume panel: demo_acts", () => {
  it("lists sheets with sizes, the module and a fully predicted macro", async () => {
    await loadDemo("Try a Russian workbook", "demo_acts.xlsm");
    const exhumePanel = screen.getByRole("region", { name: "Exhume" });
    expect(within(exhumePanel).getByText("Журнал")).toBeTruthy();
    expect(within(exhumePanel).getByText("Акты")).toBeTruthy();
    expect(within(exhumePanel).getByText(/41 rows, 6 columns/)).toBeTruthy();
    expect(within(exhumePanel).getByText("Module1")).toBeTruthy();
    expect(within(rowOf("Module1.BuildActs")).getByText("Predicted: fully resurrected")).toBeTruthy();
  });

  it("states how many procedures are not listed", async () => {
    render(<App initial={stateWith(exhume("labour_statement.xlsm", fixtureBytes("labour_statement")))} />);
    expect(screen.getByText("1 other procedure is not listed because it is a Function, Private or takes parameters.")).toBeTruthy();
  });
});

describe("exhume panel: graveyard", () => {
  it("predicts partly resurrected for both macros and shows the lines", async () => {
    await loadDemo("Try the graveyard sample", "graveyard.xlsm");
    expect(
      within(rowOf("Module1.ExportReport")).getByText(
        "Predicted: partly resurrected, 4 unsupported constructs (lines 11, 13, 14, 15)",
      ),
    ).toBeTruthy();
    expect(
      within(rowOf("Module1.ExportStrict")).getByText(
        "Predicted: partly resurrected, 1 unsupported construct (line 22)",
      ),
    ).toBeTruthy();
  });

  it("shows the actual status next to the prediction after a run", async () => {
    await loadDemo("Try the graveyard sample", "graveyard.xlsm");
    fireEvent.click(screen.getByRole("button", { name: "Run Module1.ExportStrict" }));
    await waitFor(() => expect(within(rowOf("Module1.ExportStrict")).getByText("Result: Partly resurrected")).toBeTruthy());
    expect(within(rowOf("Module1.ExportStrict")).getByText(/Predicted: partly resurrected/)).toBeTruthy();
    expect(within(rowOf("Module1.ExportReport")).queryByText(/Result:/)).toBeNull();
  });

  it("keeps both texts when prediction and result differ", () => {
    const exhumed = exhume("graveyard.xlsm", fixtureBytes("graveyard"));
    const forced: Exhumed = {
      ...exhumed,
      macros: exhumed.macros.map((m) => (m.name === "ExportStrict" ? { ...m, prediction: { status: "fully", hits: [] } } : m)),
    };
    const view = resurrect(forced, "Module1.ExportStrict");
    const state = reduce(stateWith(forced), { type: "run-done", view });
    render(<App initial={state} />);
    const row = rowOf("Module1.ExportStrict");
    expect(within(row).getByText("Predicted: fully resurrected")).toBeTruthy();
    expect(within(row).getByText("Result: Partly resurrected")).toBeTruthy();
  });
});

describe("exhume panel: files without macros", () => {
  it("says there is no VBA project and offers no Run button", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a"]]), "Data");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    render(<App initial={stateWith(exhume("plain.xlsx", bytes))} />);
    expect(screen.getByText(/No VBA project found/)).toBeTruthy();
    expect(screen.getAllByText("Data").length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: /^Run / })).toHaveLength(0);
  });

  it("explains that .xls VBA cannot be read yet", () => {
    const base = exhume("demo_acts.xlsm", fixtureBytes("demo_acts"));
    const xls: Exhumed = { ...base, fileName: "old.xls", vba: "unreadable-xls", modules: [], macros: [], buttons: [], procedureCount: 0 };
    render(<App initial={stateWith(xls)} />);
    expect(screen.getByText(/VBA in \.xls files cannot be read yet/)).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /^Run / })).toHaveLength(0);
  });

  it("shows a parse error and offers no macros from that module", () => {
    const e = exhumeParts("demo_acts.xlsm", fixtureBytes("demo_acts"), [
      { name: "Bad", type: "procedural", source: "Sub A()\n x = (1 +\nEnd Sub\n" },
      { name: "Good", type: "procedural", source: "Sub B()\nEnd Sub\n" },
    ]);
    render(<App initial={stateWith(e)} />);
    expect(screen.getByText(/Could not parse:/)).toBeTruthy();
    expect(screen.queryByText("Bad.A")).toBeNull();
    expect(screen.getByRole("button", { name: "Run Good.B" })).toBeTruthy();
  });
});

describe("run buttons", () => {
  it("have the macro id in their accessible name", async () => {
    await loadDemo("Try a Russian workbook", "demo_acts.xlsm");
    expect(screen.getByRole("button", { name: "Run Module1.BuildActs" }).textContent).toBe("Run");
  });

  it("are disabled and the list is busy while a macro runs", () => {
    const state: AppState = {
      ...stateWith(exhume("graveyard.xlsm", fixtureBytes("graveyard"))),
      run: { status: "running", macroId: "Module1.ExportReport" },
    };
    const { container } = render(<App initial={state} />);
    for (const b of screen.getAllByRole("button", { name: /^Run / })) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector(".macro-list")?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Running");
  });
});
