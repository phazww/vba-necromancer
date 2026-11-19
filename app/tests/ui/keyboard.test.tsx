import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/preact";
import axe from "axe-core";
import { App } from "../../src/App";
import { exhume } from "../../src/model/exhume";
import { resurrect } from "../../src/model/resurrect";
import { initialState, reduce } from "../../src/state/reducer";
import type { AppState } from "../../src/state/types";
import { ROOT, fixtureBytes } from "../helpers";

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

const loaded = (name: string): AppState =>
  reduce(initialState(), { type: "load-ok", exhumed: exhume(`${name}.xlsm`, fixtureBytes(name)), notice: null });
function ran(name: string, macro: string): AppState {
  const s = loaded(name);
  if (!s.exhumed) throw new Error("not loaded");
  return reduce(s, { type: "run-done", view: resurrect(s.exhumed, macro) });
}

const TABBABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';
/** Elements Tab reaches, in document order. jsdom has no focus navigation, so this mirrors the rules. */
function tabOrder(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => {
    if (el.hasAttribute("disabled") || el.closest("[hidden]")) return false;
    const attr = el.getAttribute("tabindex");
    return attr === null ? true : Number(attr) >= 0;
  });
}

async function violations(container: Element): Promise<string[]> {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join("; ")})`);
}

describe("axe in four states", () => {
  it("empty", async () => {
    const { container } = render(<App />);
    expect(await violations(container)).toEqual([]);
  });

  it("ready, before a run", async () => {
    const { container } = render(<App initial={loaded("graveyard")} />);
    expect(await violations(container)).toEqual([]);
  });

  it("after a run", async () => {
    const { container } = render(<App initial={ran("demo_acts", "Module1.BuildActs")} />);
    expect(await violations(container)).toEqual([]);
  });

  it("after a run with a trace row selected", async () => {
    const { container } = render(<App initial={ran("demo_acts", "Module1.BuildActs")} />);
    const trace = within(screen.getByRole("region", { name: "Trace" }));
    fireEvent.click(trace.getByRole("checkbox", { name: "read" }));
    fireEvent.click(trace.getAllByRole("option").filter((o) => o.closest('[role="listbox"]'))[0]);
    expect(container.querySelector('[role="gridcell"][aria-selected="true"]')).not.toBeNull();
    expect(await violations(container)).toEqual([]);
  });

  it("the graveyard panel with a stopped run", async () => {
    const { container } = render(<App initial={ran("graveyard", "Module1.ExportStrict")} />);
    fireEvent.click(screen.getByRole("tab", { name: /^Graveyard/ }));
    expect(await violations(container)).toEqual([]);
  });

  it("the narrow layout", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} }),
    });
    const { container } = render(<App initial={ran("demo_acts", "Module1.BuildActs")} />);
    expect(await violations(container)).toEqual([]);
  });
});

describe("tab order", () => {
  it("empty page: skip link, then the file button, then the demo buttons", () => {
    const { container } = render(<App />);
    expect(tabOrder(container).map((e) => e.textContent?.trim())).toEqual([
      "Skip to workbook",
      "Choose a file",
      "Try the demo",
      "Try the graveyard sample",
      "What this does not do yet",
    ]);
  });

  it("after a run: skip link, file actions, Run buttons, result bar, download, grid, source, side tabs", () => {
    const { container } = render(<App initial={ran("graveyard", "Module1.ExportStrict")} />);
    const order = tabOrder(container);
    const at = (pred: (e: HTMLElement) => boolean): number => {
      const i = order.findIndex(pred);
      expect(i, "element found in the tab order").toBeGreaterThanOrEqual(0);
      return i;
    };
    const text = (e: HTMLElement) => e.textContent?.trim() ?? "";
    const sequence = [
      at((e) => text(e) === "Skip to workbook"),
      at((e) => text(e) === "Open another file"),
      at((e) => e.getAttribute("aria-label") === "Run Module1.ExportReport"),
      at((e) => e.getAttribute("aria-label") === "Run Module1.ExportStrict"),
      at((e) => text(e) === "Download .xlsx"),
      at((e) => e.getAttribute("role") === "tab" && text(e) === "Отчёт"),
      at((e) => e.dataset.row !== undefined),
      at((e) => e.getAttribute("role") === "tab" && text(e) === "Module1"),
      at((e) => e.getAttribute("aria-label") === "VBA source: Module1"),
      at((e) => e.getAttribute("role") === "tab" && text(e).startsWith("Trace")),
    ];
    expect(sequence).toEqual([...sequence].sort((a, b) => a - b));
    expect(new Set(sequence).size).toBe(sequence.length);
    expect(order[0].textContent).toBe("Skip to workbook");
  });

  it("no element has a tabindex above 0", () => {
    const { container } = render(<App initial={ran("demo_acts", "Module1.BuildActs")} />);
    for (const el of Array.from(container.querySelectorAll("[tabindex]"))) {
      expect(Number(el.getAttribute("tabindex")), el.outerHTML.slice(0, 80)).toBeLessThanOrEqual(0);
    }
  });

  it("the grid, the trace list and the tab lists each contribute one tab stop", () => {
    const { container } = render(<App initial={ran("demo_acts", "Module1.BuildActs")} />);
    const stops = tabOrder(container);
    expect(stops.filter((e) => e.getAttribute("role") === "gridcell")).toHaveLength(1);
    expect(stops.filter((e) => e.getAttribute("role") === "option")).toHaveLength(1);
    for (const list of Array.from(container.querySelectorAll('[role="tablist"]'))) {
      expect(tabOrder(list).filter((e) => e.getAttribute("role") === "tab")).toHaveLength(1);
    }
  });
});

describe("docs/ui-checklist.md", () => {
  const text = readFileSync(join(ROOT, "docs/ui-checklist.md"), "utf8");
  const headings = [
    "Keyboard-only walk through the demo",
    "375 px layout",
    "Browser zoom 200 percent",
    "Light and dark",
    "High-contrast mode",
    "Screen reader smoke test",
    "Offline reload",
    "Download opened in LibreOffice or Excel",
    "Measured numbers",
  ];
  it.each(headings)("has the item %s with a result field", (heading) => {
    const i = text.indexOf(`## ${heading}`);
    expect(i, heading).toBeGreaterThanOrEqual(0);
    const next = text.indexOf("\n## ", i + 1);
    const section = text.slice(i, next === -1 ? undefined : next);
    expect(section).toMatch(/Result:/);
  });
});
