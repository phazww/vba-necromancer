import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/preact";
import axe from "axe-core";
import { App } from "../../src/App";

const FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex='-1'])";

describe("app shell", () => {
  it("has one h1, one main, one header and one footer", () => {
    const { container } = render(<App />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
  });

  it("the skip link is the first focusable element and its target exists", () => {
    const { container } = render(<App />);
    const first = container.querySelector(FOCUSABLE);
    expect(first?.textContent).toBe("Skip to workbook");
    const target = first?.getAttribute("href") ?? "";
    expect(target.startsWith("#")).toBe(true);
    expect(container.querySelector(target)).not.toBeNull();
    expect(container.querySelector(target)?.tagName).toBe("MAIN");
  });

  it("has an empty status region and an alert region on load", () => {
    render(<App />);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  it("says what it does not do yet, and that the file stays local", () => {
    render(<App />);
    const note = screen.getByText("What this does not do yet").closest("details");
    expect(note).not.toBeNull();
    const text = note?.textContent ?? "";
    expect(text).toMatch(/recalculated/);
    expect(text).toMatch(/Buttons/);
    expect(text).toMatch(/\.xls/);
    expect(text).toMatch(/Number formats/);
    expect(screen.getByText("Your file never leaves this browser.")).toBeTruthy();
  });

  it("has no axe violations (colour contrast is checked from the tokens)", async () => {
    const { container } = render(<App />);
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
