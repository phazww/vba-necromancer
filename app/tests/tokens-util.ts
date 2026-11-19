import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers";

export const css = readFileSync(join(ROOT, "app/src/styles/tokens.css"), "utf8");

function colours(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
export const light = colours(css.slice(0, darkStart));
export const dark = { ...light, ...colours(css.slice(darkStart)) };

function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

