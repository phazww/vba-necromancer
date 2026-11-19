import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/preact";
import { App } from "../../src/App";
import { exhume } from "../../src/model/exhume";
import { resurrect } from "../../src/model/resurrect";
import { initialState, reduce } from "../../src/state/reducer";
import type { AppState } from "../../src/state/types";
import { ROOT, fixtureBytes } from "../helpers";

function setViewport(wide: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      media: query,
      matches: query.includes("min-width: 960px") ? wide : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  });
}
afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

function ran(name: string, macro: string): AppState {
  const s = reduce(initialState(), { type: "load-ok", exhumed: exhume(`${name}.xlsm`, fixtureBytes(name)), notice: null });
  if (!s.exhumed) throw new Error("not loaded");
  return reduce(s, { type: "run-done", view: resurrect(s.exhumed, macro) });
}
const views = () => within(screen.getByRole("tablist", { name: "Views" }));
const tabState = () => views().getAllByRole("tab").map((t) => [t.textContent, t.getAttribute("aria-selected")]);

describe("narrow layout", () => {
  it("has one tab list of four tabs and no side-by-side panels", () => {
    setViewport(false);
    const { container } = render(<App initial={ran("demo_acts", "Module1.BuildActs")} />);
    expect(screen.getAllByRole("tablist", { name: "Views" })).toHaveLength(1);
    expect(views().getAllByRole("tab").map((t) => t.textContent)).toEqual(["Grid", "Source", expect.stringMatching(/^Trace \(/), "Graveyard (0)"]);
    expect(container.querySelector(".src-line")).toBeNull();
    expect(container.querySelector('[role="grid"]')).not.toBeNull();
  });

  it("selecting a trace row does not change the active tab; Go to cell and Go to line do", () => {
    setViewport(false);
    const { container } = render(<App initial={ran("demo_acts", "Module1.BuildActs")} />);
    fireEvent.click(views().getByRole("tab", { name: /^Trace/ }));
    const trace = within(screen.getByRole("region", { name: "Trace" }));
    fireEvent.click(trace.getByRole("checkbox", { name: "read" }));
    fireEvent.click(trace.getAllByRole("option").filter((o) => o.closest('[role="listbox"]'))[0]);
    expect(tabState().find(([, selected]) => selected === "true")?.[0]).toMatch(/^Trace/);

    fireEvent.click(trace.getByRole("button", { name: "Go to cell" }));
    expect(tabState().find(([, selected]) => selected === "true")?.[0]).toBe("Grid");
    expect(container.querySelector('[role="gridcell"][aria-selected="true"]')).not.toBeNull();

    fireEvent.click(views().getByRole("tab", { name: /^Trace/ }));
    fireEvent.click(within(screen.getByRole("region", { name: "Trace" })).getByRole("button", { name: "Go to line" }));
    expect(tabState().find(([, selected]) => selected === "true")?.[0]).toBe("Source");
    expect(container.querySelector('.src-line[aria-current="true"]')).not.toBeNull();
  });

  it("selecting a graveyard entry switches to Source", () => {
    setViewport(false);
    const { container } = render(<App initial={ran("graveyard", "Module1.ExportStrict")} />);
    fireEvent.click(views().getByRole("tab", { name: /^Graveyard/ }));
    fireEvent.click(screen.getByRole("button", { name: /Module1:22/ }));
    expect(tabState().find(([, selected]) => selected === "true")?.[0]).toBe("Source");
    expect(container.querySelector('.src-line[aria-current="true"]')?.getAttribute("data-line")).toBe("22");
  });

  it("folds the sheet and module lists once a macro has run", () => {
    setViewport(false);
    const { container } = render(<App initial={ran("demo_acts", "Module1.BuildActs")} />);
    const folds = Array.from(container.querySelectorAll<HTMLDetailsElement>("details.fold"));
    expect(folds.length).toBe(2);
    expect(folds.every((d) => !d.open)).toBe(true);
  });
});

describe("wide layout", () => {
  it("shows grid and source together and marks both for a trace selection", () => {
    setViewport(true);
    const { container } = render(<App initial={ran("demo_acts", "Module1.BuildActs")} />);
    expect(screen.queryByRole("tablist", { name: "Views" })).toBeNull();
    expect(container.querySelector('[role="grid"]')).not.toBeNull();
    expect(container.querySelector(".src-line")).not.toBeNull();
    const trace = within(screen.getByRole("region", { name: "Trace" }));
    fireEvent.click(trace.getByRole("checkbox", { name: "read" }));
    fireEvent.click(trace.getAllByRole("option").filter((o) => o.closest('[role="listbox"]'))[0]);
    expect(container.querySelector('[role="gridcell"][aria-selected="true"]')).not.toBeNull();
    expect(container.querySelector('.src-line[aria-current="true"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Go to cell" })).toBeNull();
  });

  it("keeps the lists open after a run", () => {
    setViewport(true);
    const { container } = render(<App initial={ran("demo_acts", "Module1.BuildActs")} />);
    expect(Array.from(container.querySelectorAll<HTMLDetailsElement>("details.fold")).every((d) => d.open)).toBe(true);
  });
});

describe("stylesheets", () => {
  const layout = readFileSync(join(ROOT, "app/src/styles/layout.css"), "utf8");
  const components = readFileSync(join(ROOT, "app/src/styles/components.css"), "utf8");

  /** Removes `@media { ... }` blocks (one nesting level of braces). */
  const outsideMedia = (css: string): string => css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");

  it("layout.css has the 960 px breakpoint and a 44 px minimum for buttons in the narrow block", () => {
    expect(layout).toContain("960px");
    const narrow = /@media \(max-width: 959px\) \{([\s\S]*)\n\}/.exec(layout)?.[1] ?? "";
    expect(narrow).toMatch(/\.button[^{]*\{[^}]*min-height:\s*44px/);
  });

  it("no container is wider than 375 px outside a media query", () => {
    for (const css of [layout, components]) {
      for (const m of outsideMedia(css).matchAll(/(?<![-\w])width:\s*(\d+(?:\.\d+)?)px/g)) {
        expect(Number(m[1]), m[0]).toBeLessThanOrEqual(375);
      }
    }
  });

  it("grid children can shrink", () => {
    expect(layout).toMatch(/\.layout-main[^{]*\{[^}]*min-width:\s*0/);
    expect(components).toMatch(/\.panel\s*\{[^}]*min-width:\s*0/);
  });
});
