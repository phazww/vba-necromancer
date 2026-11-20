import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import axe from "axe-core";
import { App } from "../../src/App";
import { resolveButtons } from "../../src/model/buttons";
import { exhume, exhumeParts } from "../../src/model/exhume";
import { resurrect } from "../../src/model/resurrect";
import type { Exhumed } from "../../src/model/types";
import { initialState, reduce } from "../../src/state/reducer";
import type { AppState } from "../../src/state/types";
import { fixtureBytes } from "../helpers";

const stateWith = (exhumed: Exhumed): AppState =>
  reduce(initialState(), { type: "load-ok", exhumed, notice: null });
const invoice = (): Exhumed => exhume("demo_invoice.xlsm", fixtureBytes("demo_invoice"));
const panel = (): HTMLElement => screen.getByRole("region", { name: "Exhume" });

/** The invoice workbook with its buttons replaced. */
function withButtons(
  buttons: Array<{ caption: string; macroRef: string; sheet?: string; anchor?: string | null }>,
  problems: string[] = [],
): Exhumed {
  const base = invoice();
  return {
    ...base,
    buttons: resolveButtons(
      buttons.map((b) => ({
        sheet: b.sheet ?? "Log",
        caption: b.caption,
        anchor: b.anchor === undefined ? "H2" : b.anchor,
        macroRef: b.macroRef,
        source: "form-control" as const,
      })),
      base.macros,
      base.fileName,
    ),
    buttonProblems: problems,
  };
}

describe("Buttons on sheets (BTN-05)", () => {
  it("shows the section above Macros with caption, place, macro and prediction", () => {
    const e = invoice();
    render(<App initial={stateWith(e)} />);
    const headings = within(panel())
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(headings.indexOf("Buttons on sheets")).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf("Buttons on sheets")).toBeLessThan(headings.indexOf("Macros"));
    const item = within(panel()).getByText("Build invoice").closest("li") as HTMLElement;
    expect(within(item).getByText(/Log, H2/)).toBeTruthy();
    expect(within(item).getByText(/Module1\.BuildInvoice/)).toBeTruthy();
    expect(within(item).getByText("Predicted: fully resurrected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run button Build invoice" })).toBeTruthy();
  });

  it("a button click starts the same run as the Run button of the macro list", async () => {
    const runs: Array<{ macroId: string; trace: unknown }> = [];
    const deps = {
      resurrect: (exhumed: Exhumed, macroId: string) => {
        const view = resurrect(exhumed, macroId);
        runs.push({ macroId, trace: view.result.trace.map((t) => ({ ...t })) });
        return view;
      },
    };
    const first = render(<App initial={stateWith(invoice())} deps={deps} />);
    fireEvent.click(screen.getByRole("button", { name: "Run button Build invoice" }));
    await waitFor(() => expect(runs).toHaveLength(1));
    await screen.findAllByText(/Result: Fully resurrected/);
    first.unmount();
    render(<App initial={stateWith(invoice())} deps={deps} />);
    fireEvent.click(screen.getByRole("button", { name: "Run Module1.BuildInvoice" }));
    await waitFor(() => expect(runs).toHaveLength(2));
    expect(runs[0].macroId).toBe("Module1.BuildInvoice");
    expect(runs[1].macroId).toBe(runs[0].macroId);
    expect(runs[1].trace).toEqual(runs[0].trace);
  });

  it("shows a result line after a run, and disables both Run buttons while running", async () => {
    render(<App initial={stateWith(invoice())} />);
    const byButton = screen.getByRole("button", { name: "Run button Build invoice" });
    const byList = screen.getByRole("button", { name: "Run Module1.BuildInvoice" });
    fireEvent.click(byButton);
    expect((byButton as HTMLButtonElement).disabled).toBe(true);
    expect((byList as HTMLButtonElement).disabled).toBe(true);
    const item = within(panel()).getByText("Build invoice").closest("li") as HTMLElement;
    await waitFor(() => expect(within(item).getByText("Result: Fully resurrected")).toBeTruthy());
    expect((byButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("an unresolved button shows the note and has no Run button", () => {
    render(
      <App initial={stateWith(withButtons([{ caption: "Lost", macroRef: "[0]!Module1.Nope" }]))} />,
    );
    expect(within(panel()).getByText("Macro not found: Module1.Nope.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Run button/ })).toBeNull();
  });

  it("two buttons with the same caption get different accessible names", () => {
    const e = withButtons([
      { caption: "Go", macroRef: "Module1.BuildInvoice", anchor: "A1" },
      { caption: "Go", macroRef: "Module1.BuildInvoice", anchor: "H2" },
    ]);
    render(<App initial={stateWith(e)} />);
    expect(screen.getByRole("button", { name: "Run button Go on Log A1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run button Go on Log H2" })).toBeTruthy();
  });

  it("a button without an anchor shows only the sheet", () => {
    const e = withButtons([{ caption: "Free", macroRef: "Module1.BuildInvoice", anchor: null }]);
    render(<App initial={stateWith(e)} />);
    expect(within(panel()).getByText(/^Log\. Calls Module1\.BuildInvoice\.$/)).toBeTruthy();
  });

  it("a workbook without drawings has no section and keeps its other headings (BTN-08)", () => {
    const e = exhume("labour_statement.xlsm", fixtureBytes("labour_statement"));
    render(<App initial={stateWith(e)} />);
    const headings = within(panel())
      .getAllByRole("heading")
      .map((h) => h.textContent);
    expect(headings).toEqual(["Exhume", "Macros"]);
  });

  it("shows a problem line, also when there are no buttons", () => {
    const e = exhumeParts("x.xlsm", fixtureBytes("labour_statement"), []);
    render(
      <App
        initial={stateWith({
          ...e,
          buttonProblems: ["xl/drawings/vmlDrawing1.vml: unexpected end"],
        })}
      />,
    );
    expect(within(panel()).getByText("Buttons on sheets")).toBeTruthy();
    expect(within(panel()).getByText("xl/drawings/vmlDrawing1.vml: unexpected end")).toBeTruthy();
  });

  it("has no axe violations with buttons in the panel", async () => {
    const e = withButtons([
      { caption: "Build invoice", macroRef: "Module1.BuildInvoice" },
      { caption: "Lost", macroRef: "Module1.Nope" },
    ]);
    const { container } = render(<App initial={stateWith(e)} />);
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
