import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { useState } from "preact/hooks";
import axe from "axe-core";
import { Tabs } from "../../src/ui/Tabs";
import { nextIndex } from "../../src/ui/useRovingFocus";

function Harness() {
  const [selected, setSelected] = useState("a");
  return (
    <Tabs
      idBase="t"
      label="Letters"
      selected={selected}
      onSelect={setSelected}
      tabs={[
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ]}
    >
      <p>Panel of {selected}</p>
    </Tabs>
  );
}

const tab = (name: string): HTMLElement => screen.getByRole("tab", { name });

describe("Tabs", () => {
  it("only the selected tab has tabindex 0", () => {
    render(<Harness />);
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(tab("Alpha").getAttribute("aria-selected")).toBe("true");
    expect(tab("Beta").getAttribute("aria-selected")).toBe("false");
  });

  it("ArrowRight and ArrowLeft move, select and wrap", () => {
    render(<Harness />);
    fireEvent.keyDown(tab("Alpha"), { key: "ArrowRight" });
    expect(tab("Beta").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Beta"));
    expect(screen.getByText("Panel of b")).toBeTruthy();
    fireEvent.keyDown(tab("Beta"), { key: "ArrowRight" });
    fireEvent.keyDown(tab("Gamma"), { key: "ArrowRight" });
    expect(tab("Alpha").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Alpha"), { key: "ArrowLeft" });
    expect(tab("Gamma").getAttribute("aria-selected")).toBe("true");
  });

  it("Home and End go to the ends", () => {
    render(<Harness />);
    fireEvent.keyDown(tab("Alpha"), { key: "End" });
    expect(tab("Gamma").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Gamma"), { key: "Home" });
    expect(tab("Alpha").getAttribute("aria-selected")).toBe("true");
  });

  it("links the panel to the selected tab both ways", () => {
    render(<Harness />);
    const panel = screen.getByRole("tabpanel");
    expect(tab("Alpha").getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(tab("Alpha").id);
    fireEvent.click(tab("Gamma"));
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tab("Gamma").id);
  });

  it("Tab leads from the tab list into the panel: the panel is focusable, other tabs are not tab stops", () => {
    render(<Harness />);
    const panel = screen.getByRole("tabpanel");
    expect(panel.tabIndex).toBe(0);
    const stops = Array.from(document.querySelectorAll<HTMLElement>("[tabindex]")).filter((e) => e.tabIndex >= 0);
    expect(stops.map((e) => e.getAttribute("role"))).toEqual(["tab", "tabpanel"]);
  });

  it("ignores keys with modifiers and unrelated keys", () => {
    render(<Harness />);
    fireEvent.keyDown(tab("Alpha"), { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(tab("Alpha"), { key: "x" });
    expect(tab("Alpha").getAttribute("aria-selected")).toBe("true");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Harness />);
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("nextIndex", () => {
  it("vertical lists do not wrap and page by the given size", () => {
    expect(nextIndex("ArrowDown", 2, 3, "vertical", false)).toBe(2);
    expect(nextIndex("ArrowUp", 0, 3, "vertical", false)).toBe(0);
    expect(nextIndex("PageDown", 0, 100, "vertical", false, 10)).toBe(10);
    expect(nextIndex("PageDown", 0, 100, "vertical", false)).toBeNull();
    expect(nextIndex("ArrowRight", 0, 3, "vertical", false)).toBeNull();
    expect(nextIndex("End", 0, 0, "vertical", false)).toBeNull();
  });
});
