/** VBA `Like` operator: ? * # [list] [!list] with ranges. */

import { RuntimeError } from "./errors.js";

interface CharSet {
  negate: boolean;
  items: Array<[string, string]>;
}

type Token =
  | { kind: "char"; ch: string }
  | { kind: "any" }
  | { kind: "star" }
  | { kind: "digit" }
  | { kind: "set"; set: CharSet };

function tokenizePattern(pattern: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "?") tokens.push({ kind: "any" });
    else if (ch === "*") tokens.push({ kind: "star" });
    else if (ch === "#") tokens.push({ kind: "digit" });
    else if (ch === "[") {
      const close = pattern.indexOf("]", i + 2);
      if (close === -1) {
        // An unmatched "[" is an error in VBA (error 93).
        throw new RuntimeError(93, "Invalid pattern string");
      }
      let body = pattern.slice(i + 1, close);
      const negate = body.startsWith("!");
      if (negate) body = body.slice(1);
      const items: Array<[string, string]> = [];
      for (let k = 0; k < body.length; k++) {
        if (body[k + 1] === "-" && k + 2 < body.length) {
          items.push([body[k], body[k + 2]]);
          k += 2;
        } else {
          items.push([body[k], body[k]]);
        }
      }
      tokens.push({ kind: "set", set: { negate, items } });
      i = close;
    } else tokens.push({ kind: "char", ch });
  }
  return tokens;
}

function matchTokens(tokens: Token[], ti: number, text: string, si: number, fold: boolean): boolean {
  const norm = (s: string): string => (fold ? s.toLowerCase() : s);
  while (ti < tokens.length) {
    const t = tokens[ti];
    if (t.kind === "star") {
      for (let k = si; k <= text.length; k++) {
        if (matchTokens(tokens, ti + 1, text, k, fold)) return true;
      }
      return false;
    }
    if (si >= text.length) return false;
    const c = text[si];
    if (t.kind === "char") {
      if (norm(t.ch) !== norm(c)) return false;
    } else if (t.kind === "digit") {
      if (c < "0" || c > "9") return false;
    } else if (t.kind === "set") {
      const nc = norm(c);
      const hit = t.set.items.some(([lo, hi]) => nc >= norm(lo) && nc <= norm(hi));
      if (hit === t.set.negate) return false;
    }
    ti++;
    si++;
  }
  return si === text.length;
}

export function like(text: string, pattern: string, caseInsensitive: boolean): boolean {
  return matchTokens(tokenizePattern(pattern), 0, text, 0, caseInsensitive);
}
