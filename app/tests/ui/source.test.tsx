import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../../src/App";
import { exhume, exhumeParts } from "../../src/model/exhume";
import { resurrect } from "../../src/model/resurrect";
import { StoreProvider, useStore } from "../../src/state/context";
import { initialState, reduce } from "../../src/state/reducer";
import type { Action } from "../../src/state/types";
import { LINE_HEIGHT, SourceView, scrollTopForLine } from "../../src/ui/SourceView";
import { ROOT, fixtureBytes, srcText } from "../helpers";

const load = (name: string) => reduce(initialState(), { type: "load-ok", exhumed: exhume(`${name}.xlsm`, fixtureBytes(name)), notice: null });
const line = (container: Element, n: number) => container.querySelector<HTMLElement>(`.src-line[data-line="${n}"]`);

describe("SourceView", () => {
  it("renders every line of demo_acts Module1 with its number and the exact text", () => {
    const { container } = render(<App initial={load("demo_acts")} />);
    const expected = srcText("demo_acts", "Module1").replace(/\r?\n$/, "").split(/\r?\n/);
    expect(container.querySelectorAll(".src-line")).toHaveLength(expected.length);
    expected.forEach((text, i) => {
      const el = line(container, i + 1);
      expect(el?.querySelector(".gutter")?.firstChild?.textContent).toBe(String(i + 1));
      expect(el?.querySelector(".code")?.textContent).toBe(text);
    });
    expect(container.querySelector(".code")?.textContent).not.toMatch(/^\d/);
    expect(container.textContent).toContain("Журнал");
  });

  it("graveyard: lines 3, 11, 13, 14, 15 and 22 carry a marker with the construct", () => {
    const { container } = render(<App initial={load("graveyard")} />);
    const expected: Record<number, string> = {
      3: "unsupported: Declare",
      11: "unsupported: CreateObject",
      13: "unsupported: Open",
      14: "unsupported: Print #",
      15: "unsupported: Close",
      22: "unsupported: Open",
    };
    for (const [n, label] of Object.entries(expected)) {
      expect(line(container, Number(n))?.querySelector(".marker")?.getAttribute("aria-label")).toBe(label);
    }
    expect(container.querySelectorAll(".marker")).toHaveLength(6);
    expect(container.querySelector(".stop-tag")).toBeNull();
  });

  it("after ExportStrict line 22 also says 'stopped here'", () => {
    const state0 = load("graveyard");
    if (!state0.exhumed) throw new Error("not loaded");
    const state = reduce(state0, { type: "run-done", view: resurrect(state0.exhumed, "Module1.ExportStrict") });
    const { container } = render(<App initial={state} />);
    expect(line(container, 22)?.querySelector(".stop-tag")?.textContent).toBe("stopped here");
    expect(container.querySelectorAll(".stop-tag")).toHaveLength(1);
    // the tag is not part of the copyable code text
    expect(line(container, 22)?.querySelector(".code")?.textContent).not.toContain("stopped");
  });

  it("scrollTopForLine centres the line and never goes negative", () => {
    expect(scrollTopForLine(1, 200)).toBe(0);
    const top = scrollTopForLine(22, 200);
    const lineTop = 21 * LINE_HEIGHT;
    expect(top).toBeLessThanOrEqual(lineTop);
    expect(top + 200).toBeGreaterThanOrEqual(lineTop + LINE_HEIGHT);
  });

  it("a selection from the store sets aria-current and scrolls the line into the window", async () => {
    let dispatch: ((a: Action) => void) | undefined;
    function Probe() {
      dispatch = useStore().dispatch;
      return null;
    }
    const { container } = render(
      <StoreProvider initial={load("graveyard")}>
        <SourceView />
        <Probe />
      </StoreProvider>,
    );
    const region = screen.getByRole("region", { name: "VBA source: Module1" });
    Object.defineProperty(region, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(region, "scrollTop", { value: 0, configurable: true, writable: true });
    expect(line(container, 22)?.getAttribute("aria-current")).toBeNull();
    dispatch?.({ type: "select-graveyard", module: "Module1", line: 22 });
    await waitFor(() => expect(line(container, 22)?.getAttribute("aria-current")).toBe("true"));
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    const top = (region as HTMLElement).scrollTop;
    const lineTop = 21 * LINE_HEIGHT;
    expect(top).toBeLessThanOrEqual(lineTop);
    expect(top + 100).toBeGreaterThanOrEqual(lineTop + LINE_HEIGHT);
  });

  it("the stylesheet makes the gutter unselectable and keeps lines unwrapped", () => {
    const css = readFileSync(join(ROOT, "app/src/styles/components.css"), "utf8");
    const gutter = /\.gutter\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(gutter).toMatch(/user-select:\s*none/);
    expect(/\.src-line\s*\{[^}]*\}/.exec(css)?.[0]).toMatch(/white-space:\s*pre/);
  });

  it("renders a 5 000 line module quickly by drawing only the lines near the viewport", () => {
    const source = Array.from({ length: 5000 }, (_, i) => `    x = ${i} ' line`).join("\n");
    const e = exhumeParts("demo_acts.xlsm", fixtureBytes("demo_acts"), [{ name: "Big", type: "procedural", source }]);
    const state = reduce(initialState(), { type: "load-ok", exhumed: e, notice: null });
    const t0 = performance.now();
    const { container } = render(
      <StoreProvider initial={state}>
        <SourceView />
      </StoreProvider>,
    );
    const ms = performance.now() - t0;
    console.log(`5 000 line source render: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(200);
    expect(e.modules[0].lines).toHaveLength(5000);
    const drawn = container.querySelectorAll(".src-line").length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(200);
    expect(line(container, 1)?.querySelector(".code")?.textContent).toBe("    x = 0 ' line");
  });

  it("scrolls a long module to a selected line far outside the first window", async () => {
    const source = Array.from({ length: 5000 }, (_, i) => `    x = ${i}`).join("\n");
    const e = exhumeParts("demo_acts.xlsm", fixtureBytes("demo_acts"), [{ name: "Big", type: "procedural", source }]);
    let dispatch: ((a: Action) => void) | undefined;
    function Probe() {
      dispatch = useStore().dispatch;
      return null;
    }
    const { container } = render(
      <StoreProvider initial={reduce(initialState(), { type: "load-ok", exhumed: e, notice: null })}>
        <SourceView />
        <Probe />
      </StoreProvider>,
    );
    const region = screen.getByRole("region", { name: "VBA source: Big" });
    Object.defineProperty(region, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(region, "scrollTop", { value: 0, configurable: true, writable: true });
    expect(line(container, 3000)).toBeNull();
    dispatch?.({ type: "select-graveyard", module: "Big", line: 3000 });
    await waitFor(() => expect(line(container, 3000)?.getAttribute("aria-current")).toBe("true"));
  });

  it("has a module tab per module and shows the other module when picked", () => {
    const e = exhumeParts("demo_acts.xlsm", fixtureBytes("demo_acts"), [
      { name: "One", type: "procedural", source: "Sub A()\nEnd Sub\n" },
      { name: "Two", type: "procedural", source: "Sub B()\nEnd Sub\n" },
    ]);
    const { container } = render(<App initial={reduce(initialState(), { type: "load-ok", exhumed: e, notice: null })} />);
    const tabs = within(screen.getByRole("tablist", { name: "VBA modules" }));
    expect(tabs.getAllByRole("tab").map((t) => t.textContent)).toEqual(["One", "Two"]);
    fireEvent.click(tabs.getByRole("tab", { name: "Two" }));
    expect(container.querySelector(".src-line .code")?.textContent).toBe("Sub B()");
  });
});
