import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/preact";
import { App } from "../../src/App";
import { exhume } from "../../src/model/exhume";
import { resurrect } from "../../src/model/resurrect";
import type { GraveyardEntry } from "../../src/model/types";
import { initialState, reduce } from "../../src/state/reducer";
import type { AppState } from "../../src/state/types";
import { expectedFor, fixtureBytes } from "../helpers";

const loaded = (name: string) => reduce(initialState(), { type: "load-ok", exhumed: exhume(`${name}.xlsm`, fixtureBytes(name)), notice: null });
function ran(name: string, macro: string): AppState {
  const s = loaded(name);
  if (!s.exhumed) throw new Error("not loaded");
  return reduce(s, { type: "run-done", view: resurrect(s.exhumed, macro) });
}
function openGraveyard() {
  fireEvent.click(screen.getByRole("tab", { name: /^Graveyard/ }));
  return within(screen.getByRole("region", { name: "Graveyard" }));
}
/** [line, construct, mark text] per entry button, in display order. */
function entries(p: ReturnType<typeof openGraveyard>) {
  return p.queryAllByRole("button").map((b) => {
    const where = b.querySelector(".where")?.textContent ?? "";
    return [Number(where.split(":")[1]), b.querySelector(".construct")?.textContent ?? "", b.querySelector(".mark")?.textContent ?? ""] as const;
  });
}
const oracle = expectedFor("graveyard").runs[0].unsupported;

describe("graveyard panel", () => {
  it("before any run: the six oracle entries, no run marks, tab label 6", () => {
    render(<App initial={loaded("graveyard")} />);
    expect(screen.getByRole("tab", { name: "Graveyard (6)" })).toBeTruthy();
    const list = entries(openGraveyard());
    expect(list.map(([line, construct]) => [line, construct])).toEqual(oracle.map((h) => [h.line, h.construct]));
    expect(list.every(([, , mark]) => mark === "")).toBe(true);
    expect(within(screen.getByRole("region", { name: "Graveyard" })).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Module1"]);
  });

  it("after ExportReport: runtime hits are skipped, line 22 is not reached", () => {
    render(<App initial={ran("graveyard", "Module1.ExportReport")} />);
    const p = openGraveyard();
    const list = entries(p);
    expect(list).toHaveLength(6);
    expect(list.find(([line]) => line === 22)?.[2]).toBe("not reached");
    expect(list.find(([line]) => line === 11)?.[2]).toBe("skipped during this run");
    expect(p.queryByText(/^Run stopped at/)).toBeNull();
  });

  it("after ExportStrict: line 22 stopped the run, the banner says where, the rest are not reached", () => {
    render(<App initial={ran("graveyard", "Module1.ExportStrict")} />);
    const p = openGraveyard();
    expect(p.getByText("Run stopped at Module1:22 (Open)")).toBeTruthy();
    const list = entries(p);
    expect(list.find(([line]) => line === 22)?.[2]).toBe("stopped the run");
    expect(list.filter(([, , mark]) => mark === "not reached")).toHaveLength(5);
  });

  it("shows a runtime hit that the static list does not have", () => {
    const base = ran("graveyard", "Module1.ExportReport");
    if (base.run.status !== "done") throw new Error("no run");
    const extra: GraveyardEntry = { module: "Module1", line: 99, construct: "Mystery", mark: "skipped" };
    const state: AppState = { ...base, run: { ...base.run, view: { ...base.run.view, graveyard: [...base.run.view.graveyard, extra] } } };
    render(<App initial={state} />);
    expect(screen.getByRole("tab", { name: "Graveyard (7)" })).toBeTruthy();
    expect(entries(openGraveyard()).some(([line, construct]) => line === 99 && construct === "Mystery")).toBe(true);
  });

  it("demo_acts: nothing in the graveyard and tab label 0", () => {
    render(<App initial={loaded("demo_acts")} />);
    expect(screen.getByRole("tab", { name: "Graveyard (0)" })).toBeTruthy();
    expect(openGraveyard().getByText("Nothing in the graveyard")).toBeTruthy();
  });

  it("clicking an entry selects its line in the source view", () => {
    const { container } = render(<App initial={loaded("graveyard")} />);
    const p = openGraveyard();
    fireEvent.click(p.getByRole("button", { name: /Module1:22/ }));
    expect(container.querySelector('.src-line[aria-current="true"]')?.getAttribute("data-line")).toBe("22");
    expect(p.getByRole("button", { name: /Module1:22/ }).getAttribute("aria-current")).toBe("true");
  });

  it("the number in the tab equals the length of the list in every case", () => {
    for (const [state, n] of [
      [loaded("graveyard"), 6],
      [ran("graveyard", "Module1.ExportReport"), 6],
      [ran("graveyard", "Module1.ExportStrict"), 6],
      [loaded("demo_acts"), 0],
    ] as const) {
      const { unmount } = render(<App initial={state} />);
      expect(screen.getByRole("tab", { name: `Graveyard (${n})` })).toBeTruthy();
      expect(entries(openGraveyard()).length).toBe(n);
      unmount();
    }
  });
});
