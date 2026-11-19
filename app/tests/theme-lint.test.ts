import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ROOT } from "./helpers";
import { BANNED, THEMED_FILES, blurredShadows } from "./theme-util";
import { dark, light } from "./tokens-util";

describe("theme lint", () => {
  it("scans the files it should", () => {
    expect(THEMED_FILES.length).toBeGreaterThan(3);
  });

  it.each(THEMED_FILES.map((f) => [f.replace(ROOT + "/", ""), f]))("%s has no banned pattern", (_name, file) => {
    const text = readFileSync(file, "utf8");
    for (const [label, re] of BANNED) expect(re.test(text), `${label} in ${file}`).toBe(false);
    expect(blurredShadows(text)).toEqual([]);
  });

  it("blurredShadows catches a blur and accepts a flat shadow", () => {
    expect(blurredShadows("box-shadow: 0 1px 4px #000;")).toHaveLength(1);
    expect(blurredShadows("box-shadow: 2px 0 0 0 #000;")).toEqual([]);
  });

  it("no colour token is purple (hue 260 to 320 degrees with saturation above 15 percent)", () => {
    const hsl = (hex: string): { h: number; s: number } => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      const d = max - min;
      if (d === 0) return { h: 0, s: 0 };
      const s = d / (1 - Math.abs(2 * l - 1));
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return { h: (h * 60 + 360) % 360, s };
    };
    for (const scheme of [light, dark]) {
      for (const [name, hex] of Object.entries(scheme)) {
        const { h, s } = hsl(hex);
        expect(h >= 260 && h <= 320 && s > 0.15, `${name} ${hex}`).toBe(false);
      }
    }
  });
});
