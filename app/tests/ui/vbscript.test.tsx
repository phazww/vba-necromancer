import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/preact";
import axe from "axe-core";
import { App } from "../../src/App";
import { exhume, exhumeParts } from "../../src/model/exhume";
import { VBSCRIPT_TEXTS } from "@vba-necromancer/vba";
import type { Exhumed } from "../../src/model/types";
import { initialState, reduce } from "../../src/state/reducer";
import { fixtureBytes } from "../helpers";

const stateWith = (e: Exhumed) => reduce(initialState(), { type: "load-ok", exhumed: e, notice: null });
const fixture = (name: string) => exhume(`${name}.xlsm`, fixtureBytes(name));
const section = () => {
  const h = within(screen.getByRole("region", { name: "Exhume" })).getByRole("heading", { name: "VBScript readiness" });
  return within(h.parentElement as HTMLElement);
};

describe("VBS-02 VBScript readiness section", () => {
  it("no findings: says so, and says it is a static scan following the guidance of 9 Sep 2025", () => {
    render(<App initial={stateWith(fixture("demo_invoice"))} />);
    const s = section();
    expect(s.getByText("No VBScript dependencies found")).toBeTruthy();
    expect(s.getByText("Static scan, following Microsoft's guidance of 9 Sep 2025.")).toBeTruthy();
  });

  it("vbscript_deps: the reference and the two code findings with their text and location", () => {
    render(<App initial={stateWith(fixture("vbscript_deps"))} />);
    const s = section();
    expect(s.queryByText("No VBScript dependencies found")).toBeNull();
    expect(s.getByText("VBScript_RegExp_55")).toBeTruthy();
    expect(s.getByText(/vbscript\.dll/)).toBeTruthy();
    expect(s.getByText(VBSCRIPT_TEXTS["vbscript-reference"])).toBeTruthy();
    const buttons = s.getAllByRole("button");
    expect(buttons.map((b) => b.querySelector(".where")?.textContent)).toEqual(["LateBound:5", "Nightly:4"]);
    expect(buttons[0]!.textContent).toContain(VBSCRIPT_TEXTS["vbscript-createobject"]);
    expect(buttons[1]!.textContent).toContain(VBSCRIPT_TEXTS["external-vbs"]);
  });

  it("clicking a code finding selects its line in the source view; the reference has no button", () => {
    render(<App initial={stateWith(fixture("vbscript_deps"))} />);
    fireEvent.click(section().getAllByRole("button")[1]!);
    const source = within(screen.getByRole("region", { name: "Source" }));
    const current = source.getAllByText(/Shell/).map((el) => el.closest("[aria-current='true']")).filter(Boolean);
    expect(current).toHaveLength(1);
    expect(section().getAllByRole("button")).toHaveLength(2);
  });

  it("no VBA read: says it could not check instead of an all-clear", () => {
    const e = exhumeParts("plain.xlsx", fixtureBytes("demo_invoice"), []);
    expect(e.vba).toBe("none");
    render(<App initial={stateWith(e)} />);
    const s = section();
    expect(s.getByText("No VBA project was read, so VBScript dependencies could not be checked.")).toBeTruthy();
    expect(s.queryByText("No VBScript dependencies found")).toBeNull();
  });

  it("reference problems are shown", () => {
    const e = exhumeParts("x.xlsm", fixtureBytes("demo_invoice"), [{ name: "M", type: "procedural", source: "Sub A()\nEnd Sub\n" }], {
      referenceProblems: ["Reference record 0x000d at dir stream offset 12: the libid runs past the end of the record"],
    });
    render(<App initial={stateWith(e)} />);
    expect(section().getByText(/Reference record 0x000d at dir stream offset 12/)).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = render(<App initial={stateWith(fixture("vbscript_deps"))} />);
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
