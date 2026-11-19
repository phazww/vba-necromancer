import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/preact";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import demoUrl from "../../fixtures/build/demo_acts.xlsm?inline";
import { App } from "../src/App";

const ROOT = resolve(__dirname, "../..");

function decodeDataUrl(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(",") + 1));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

describe("app skeleton", () => {
  it("renders one h1 with the product name", () => {
    render(<App />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe("VBA Necromancer");
  });

  it("inlines the demo workbook as a data URL that decodes to a ZIP", () => {
    expect(demoUrl.startsWith("data:")).toBe(true);
    const bytes = decodeDataUrl(demoUrl);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });

  it("reads a File into bytes in this environment", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "a.xlsm");
    expect(typeof file.arrayBuffer).toBe("function");
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("builds with vite and typechecks including the app", () => {
    const out = execFileSync("npm", ["run", "build", "-w", "app"], { cwd: ROOT, encoding: "utf8" });
    expect(out).toContain("built in");
    const tsc = execFileSync("npm", ["run", "typecheck"], { cwd: ROOT, encoding: "utf8" });
    expect(tsc).toContain("app");
  }, 120_000);
});
