import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(p);
  }
  return out;
}

export const THEMED_FILES = [join(ROOT, "app/index.html"), ...walk(join(ROOT, "app/src"))];

export const BANNED: Array<[string, RegExp]> = [
  ["gradient", /gradient\(/i],
  ["text-shadow", /text-shadow/i],
  ["filter", /(?<![\w-])filter\s*:/i],
  ["font-face", /@font-face/i],
  ["google fonts", /fonts\.googleapis/i],
  ["emoji", /\p{Extended_Pictographic}|[\u{1F000}-\u{1FAFF}]/u],
];

/** `box-shadow` is allowed only without blur: `Xpx Ypx 0 colour`. */
export function blurredShadows(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/box-shadow\s*:\s*([^;}]+)/gi)) {
    const value = m[1].trim();
    if (value === "none") continue;
    for (const layer of value.split(/,(?![^(]*\))/)) {
      const lengths = layer.match(/-?\d*\.?\d+(?:px|rem|em)?/g) ?? [];
      const blur = lengths[2];
      if (blur !== undefined && parseFloat(blur) !== 0) out.push(layer.trim());
    }
  }
  return out;
}

