/**
 * VBScript readiness scan (VBS-01). Static, on tokens: comments are never looked at, a module that
 * does not parse is still scanned. Follows Microsoft's guidance of 9 Sep 2025, which names two
 * patterns: calling external .vbs scripts, and referencing the VBScript type library.
 */

import { TokenType, type Token } from "./ast.js";
import { tokenize } from "./lexer.js";

export type VbscriptKind = "vbscript-reference" | "vbscript-createobject" | "external-vbs";

export interface VbscriptFinding {
  kind: VbscriptKind;
  /** The text of VBS-01 for this kind. */
  text: string;
  /** Code findings: module and 1-based line. Reference findings: null. */
  module: string | null;
  line: number | null;
  /** Reference findings: name and libid. Code findings: null. */
  reference: { name: string; libid: string } | null;
}

export const VBSCRIPT_TEXTS: Readonly<Record<VbscriptKind, string>> = {
  "vbscript-reference":
    "References the VBScript RegExp library. Breaks when VBScript is disabled, unless Office is version 2508 or later (RegExp is built into VBA from 2508).",
  "vbscript-createobject":
    "Late-bound VBScript RegExp. Microsoft's guidance says this runs on Office 2508 and later, and on older builds only while VBScript is enabled.",
  "external-vbs": "Runs an external VBScript file. This stops working once VBScript is disabled, on any Office version.",
};

export interface VbscriptModuleInput {
  name: string;
  source: string;
}
export interface VbscriptReferenceInput {
  name: string;
  kind: string;
  libid: string;
}

const REGEXP_LIBRARY_GUID = "{3f4daca0-160d-11d2-a8e9-00104b365c9f}";
const WORD_SCRIPT_HOST = /\b(?:wscript|cscript)\b/i;

/** The text between the quotes of a StringLiteral token (the lexer keeps the quotes). */
function literalText(t: Token): string {
  return t.value.slice(1, -1);
}

// ".vbs" as a whole extension anywhere in the literal, so "wscript ""C:\a.vbs""" (closing quotes) is found too; ".vbsx" is not.
const isScriptLiteral = (text: string): boolean => /\.vbs\b/i.test(text) || WORD_SCRIPT_HOST.test(text);

/** Tokens that may directly precede a procedure keyword at the start of a statement. */
const BEFORE_PROC_KEYWORD = new Set<TokenType>([
  TokenType.Newline,
  TokenType.Colon,
  TokenType.Public,
  TokenType.Private,
  TokenType.Friend,
  TokenType.Static,
]);

/** A name at `i` that is a plain call or `VBA.<name>`, not a member of another object. */
function isFreeName(tokens: readonly Token[], i: number): boolean {
  const prev = tokens[i - 1];
  if (!prev || prev.type !== TokenType.Dot) return true;
  const owner = tokens[i - 2];
  return owner !== undefined && owner.type === TokenType.Identifier && owner.value.toLowerCase() === "vba";
}

const isName = (t: Token | undefined, name: string): boolean =>
  t !== undefined && t.type === TokenType.Identifier && t.value.toLowerCase() === name;

/** `CreateObject ( "<progId>"` at `i`: the literal token, or null. */
function createObjectArg(tokens: readonly Token[], i: number): Token | null {
  if (!isName(tokens[i], "createobject") || !isFreeName(tokens, i)) return null;
  const open = tokens[i + 1];
  const arg = tokens[i + 2];
  if (open?.type !== TokenType.LParen || arg?.type !== TokenType.StringLiteral) return null;
  return arg;
}

function scanModule(mod: VbscriptModuleInput): VbscriptFinding[] {
  const tokens = tokenize(mod.source).filter((t) => t.type !== TokenType.Comment);
  const found: VbscriptFinding[] = [];
  const code = (kind: VbscriptKind, line: number): void => {
    found.push({ kind, text: VBSCRIPT_TEXTS[kind], module: mod.name, line, reference: null });
  };

  // Procedures: [start, end) token ranges.
  let procStart = -1;
  let usesShell = false;
  let literals: Token[] = [];
  const progIds = new Set<Token>();
  const closeProcedure = (): void => {
    if (procStart >= 0 && usesShell) {
      for (const lit of literals) if (!progIds.has(lit) && isScriptLiteral(literalText(lit))) code("external-vbs", lit.line);
    }
    procStart = -1;
    usesShell = false;
    literals = [];
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const prev = tokens[i - 1];
    const atStatementStart = prev === undefined || BEFORE_PROC_KEYWORD.has(prev.type);

    if (t.type === TokenType.End) {
      const next = tokens[i + 1];
      if (next && (next.type === TokenType.Sub || next.type === TokenType.Function || isName(next, "property"))) {
        closeProcedure();
        continue;
      }
    }
    if (
      atStatementStart &&
      (t.type === TokenType.Sub ||
        t.type === TokenType.Function ||
        (isName(t, "property") && [TokenType.Get, TokenType.Let, TokenType.Set].includes(tokens[i + 1]?.type as TokenType)))
    ) {
      closeProcedure(); // a missing End Sub must not merge two procedures
      procStart = i;
      continue;
    }

    const progId = createObjectArg(tokens, i);
    if (progId) {
      const id = literalText(progId).toLowerCase();
      if (id === "vbscript.regexp") code("vbscript-createobject", t.line);
      if (id === "wscript.shell") {
        // The ProgID itself contains the word "wscript"; it is the trigger, not a script.
        progIds.add(progId);
        if (procStart >= 0) usesShell = true;
      }
    }
    if (isName(t, "shell") && isFreeName(tokens, i) && procStart >= 0) usesShell = true;
    if (t.type === TokenType.StringLiteral && procStart >= 0) literals.push(t);
  }
  closeProcedure();

  // Code findings in line order (createobject and external-vbs were found in different passes).
  return found.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

/**
 * Findings in this order: references in file order, then code findings by module (input order)
 * and line.
 */
export function scanVbscript(
  modules: ReadonlyArray<VbscriptModuleInput>,
  references: ReadonlyArray<VbscriptReferenceInput>,
): VbscriptFinding[] {
  const out: VbscriptFinding[] = [];
  for (const r of references) {
    if (r.kind !== "registered") continue;
    const libid = r.libid.toLowerCase();
    if (libid.includes("vbscript.dll") || libid.includes(REGEXP_LIBRARY_GUID)) {
      out.push({
        kind: "vbscript-reference",
        text: VBSCRIPT_TEXTS["vbscript-reference"],
        module: null,
        line: null,
        reference: { name: r.name, libid: r.libid },
      });
    }
  }
  for (const m of modules) out.push(...scanModule(m));
  return out;
}
