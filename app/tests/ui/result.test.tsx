import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { RuntimeError } from "@vba-necromancer/vba";
import { openWorkbook } from "@vba-necromancer/workbook";
import { App } from "../../src/App";
import { exhume } from "../../src/model/exhume";
import { resurrect } from "../../src/model/resurrect";
import { initialState, reduce } from "../../src/state/reducer";
import { XLSX_MIME } from "../../src/state/actions";
import { expectedFor, fixtureBytes } from "../helpers";

const loaded = (name: string) => reduce(initialState(), { type: "load-ok", exhumed: exhume(`${name}.xlsm`, fixtureBytes(name)), notice: null });
function ran(name: string, macro: string) {
  const s = loaded(name);
  if (!s.exhumed) throw new Error("not loaded");
  const view = resurrect(s.exhumed, macro);
  return { state: reduce(s, { type: "run-done", view }), view };
}
const resultBar = () => screen.getByRole("region", { name: "Resurrect" });
const download = () => screen.getByRole("button", { name: "Download .xlsx" }) as HTMLButtonElement;
const described = (el: HTMLElement) => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

describe("result bar", () => {
  it("before a run: no badge, download disabled with the reason", () => {
    const { container } = render(<App initial={loaded("demo_acts")} />);
    expect(container.querySelector(".badge")).toBeNull();
    expect(download().disabled).toBe(true);
    expect(within(resultBar()).getByText("Run a macro first")).toBeTruthy();
    expect(described(download())).toBe("Run a macro first");
  });

  it("after demo_acts: Fully resurrected, 22 cells changed, counts from the model, same status in the live region", () => {
    const { state, view } = ran("demo_acts", "Module1.BuildActs");
    render(<App initial={state} />);
    const bar = within(resultBar());
    expect(bar.getByText("Fully resurrected")).toBeTruthy();
    expect(bar.getByText(new RegExp(`^22 cells changed, ${view.counts.reads} reads, ${view.counts.writes} writes, `))).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Fully resurrected");
    expect(download().disabled).toBe(false);
  });

  it("the badge has a shape as well as text", () => {
    const { state } = ran("demo_acts", "Module1.BuildActs");
    const { container } = render(<App initial={state} />);
    expect(container.querySelector(".badge .shape--fully")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("after ExportStrict: Partly resurrected and where the run stopped", () => {
    const { state } = ran("graveyard", "Module1.ExportStrict");
    render(<App initial={state} />);
    const bar = within(resultBar());
    expect(bar.getByText("Partly resurrected")).toBeTruthy();
    expect(bar.getByText("Run stopped at Module1:22 (Open)")).toBeTruthy();
  });

  it("a failed run shows the message and a link that selects the line", () => {
    const { state, view } = ran("graveyard", "Module1.ExportStrict");
    const failed = {
      ...view,
      result: { ...view.result, status: "failed" as const, stoppedAt: undefined, error: new RuntimeError(9, "Subscript out of range", "Module1", 7) },
    };
    const { container } = render(<App initial={reduce(state, { type: "run-done", view: failed })} />);
    const bar = within(resultBar());
    expect(bar.getByText("Run failed")).toBeTruthy();
    expect(bar.getByText(/Subscript out of range/)).toBeTruthy();
    fireEvent.click(bar.getByRole("button", { name: "Module1:7" }));
    expect(container.querySelector('.src-line[data-line="7"]')?.getAttribute("aria-current")).toBe("true");
  });

  it("a failed run without a location shows the message only", () => {
    const { state, view } = ran("graveyard", "Module1.ExportStrict");
    const failed = { ...view, result: { ...view.result, status: "failed" as const, error: new Error("Out of memory") } };
    render(<App initial={reduce(state, { type: "run-done", view: failed })} />);
    expect(within(resultBar()).getByText("Out of memory")).toBeTruthy();
    expect(within(resultBar()).queryAllByRole("button", { name: /Module1:/ })).toHaveLength(0);
  });
});

describe("download", () => {
  it("saves the workbook of the last run: name, type, and the oracle's cells", async () => {
    const saveBlob = vi.fn();
    const { state } = ran("demo_acts", "Module1.BuildActs");
    render(<App initial={state} deps={{ saveBlob }} />);
    fireEvent.click(download());
    expect(saveBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe("demo_acts-resurrected.xlsx");
    expect(blob.type).toBe(XLSX_MIME);
    const wb = openWorkbook(new Uint8Array(await blob.arrayBuffer()));
    for (const c of expectedFor("demo_acts").runs[0].cells) {
      const actual = wb.getSheet(c.sheet).getCellValue(c.row, c.col);
      if (typeof c.value === "number") expect(Math.abs((actual as number) - c.value)).toBeLessThan(1e-9);
      else expect(actual).toBe(c.value);
    }
  });

  it("says partial results for ExportReport and not for a fully resurrected run", () => {
    const partial = ran("graveyard", "Module1.ExportReport");
    const a = render(<App initial={partial.state} />);
    expect(described(download())).toMatch(/partial results/);
    a.unmount();
    render(<App initial={ran("demo_acts", "Module1.BuildActs").state} />);
    expect(described(download())).not.toMatch(/partial results/);
  });

  it("shows an alert and does not save when save() throws", async () => {
    const saveBlob = vi.fn();
    const { state, view } = ran("demo_acts", "Module1.BuildActs");
    view.workbook.save = () => {
      throw new Error("zip failed");
    };
    render(<App initial={state} deps={{ saveBlob }} />);
    fireEvent.click(download());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not build the .xlsx: zip failed"));
    expect(saveBlob).not.toHaveBeenCalled();
  });
});
