import { describe, it, expect } from "vitest";
import { contrast, css, dark, light } from "./tokens-util";

const TEXT_PAIRS: Array<[string, string]> = [
  ["--text", "--bg"],
  ["--text", "--surface"],
  ["--muted", "--surface"],
  ["--on-accent", "--accent"],
  ["--accent", "--surface"],
  ["--text", "--changed-bg"],
  ["--danger", "--surface"],
];
const GRAPHIC_PAIRS: Array<[string, string]> = [
  ["--border", "--surface"],
  ["--changed-bar", "--surface"],
  ["--focus", "--surface"],
  ["--focus", "--bg"],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s scheme", (_name, scheme) => {
  it("defines every colour token", () => {
    for (const key of ["--bg", "--surface", "--text", "--muted", "--border", "--accent", "--on-accent", "--changed-bg", "--changed-bar", "--danger", "--focus"]) {
      expect(scheme[key], key).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it.each(TEXT_PAIRS)("text pair %s on %s is at least 4.5", (fg, bg) => {
    expect(contrast(scheme[fg], scheme[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(GRAPHIC_PAIRS)("border, bar and focus pair %s on %s is at least 3.0", (fg, bg) => {
    expect(contrast(scheme[fg], scheme[bg])).toBeGreaterThanOrEqual(3);
  });
});

describe("tokens.css", () => {
  it("declares both schemes and a 2 px focus width", () => {
    expect(css).toContain("color-scheme: light dark");
    expect(css).toContain("--focus-width: 2px");
    expect(Object.keys(dark).length).toBeGreaterThan(0);
  });
});
