import { extractProject, NoVBAProjectError, type DirReference } from "@vba-necromancer/ovba";
import { ParseError, parse, scanUnsupported, scanVbscript, tokenize } from "@vba-necromancer/vba";
import { openWorkbook, readButtons } from "@vba-necromancer/workbook";
import { resolveButtons } from "./buttons";
import { countProcedures, listMacros } from "./macros";
import { predictMacro } from "./predict";
import { NotAWorkbookError, WorkbookReadError, checkSize, sniffKind } from "./sniff";
import type { Exhumed, ExhumedModule, ModuleSource, SheetSummary, VbaState } from "./types";

export interface PartsOptions {
  vba?: VbaState;
  vbaError?: string | null;
  references?: DirReference[];
  referenceProblems?: string[];
}

/** Splits on any line ending; the terminator of the last line does not start a new line. */
function splitLines(source: string): string[] {
  const lines = source.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function parseModule(m: ModuleSource): ExhumedModule {
  const lines = splitLines(m.source);
  try {
    const ast = parse(tokenize(m.source), m.name);
    return { ...m, lines, ast, parseError: null };
  } catch (e) {
    if (e instanceof ParseError) {
      return { ...m, lines, ast: null, parseError: { message: e.message, line: e.line } };
    }
    throw e;
  }
}

/**
 * Everything after the VBA text has been read: parse each module, scan for unsupported
 * constructs and open the workbook for the preview. A module that does not parse keeps
 * `ast: null` and does not stop the others.
 */
export function exhumeParts(
  name: string,
  bytes: Uint8Array,
  sources: ModuleSource[],
  options: PartsOptions = {},
): Exhumed {
  const kind = sniffKind(bytes);
  if (kind === "unknown") throw new NotAWorkbookError(name);
  checkSize(bytes.length, name);

  let initial;
  try {
    initial = openWorkbook(bytes);
  } catch (e) {
    throw new WorkbookReadError(name, e instanceof Error ? e.message : String(e));
  }
  const sheets: SheetSummary[] = initial.sheets.map((s) => {
    const sheet = initial.getSheet(s.index);
    return { name: s.name, rows: sheet.usedRowCount(), cols: sheet.usedColCount() };
  });

  const modules = sources.map(parseModule);
  const asts = modules.flatMap((m) => (m.ast ? [m.ast] : []));
  const staticUnsupported = scanUnsupported(asts);

  const macros = listMacros(modules).map((m) => ({
    ...m,
    prediction: predictMacro(m, modules, staticUnsupported),
  }));
  const found = readButtons(bytes);
  const references = options.references ?? [];

  return {
    fileName: name,
    size: bytes.length,
    bytes,
    kind,
    initial,
    sheets,
    modules,
    procedureCount: countProcedures(modules),
    macros,
    buttons: resolveButtons(found.buttons, macros, name),
    buttonProblems: found.problems,
    staticUnsupported,
    references,
    referenceProblems: options.referenceProblems ?? [],
    // Scan what was read: the sources as given, not the parsed modules.
    vbscript: scanVbscript(sources, references),
    vba: options.vba ?? (sources.length > 0 ? "present" : "none"),
    vbaError: options.vbaError ?? null,
  };
}

/** Reads the VBA modules of a workbook. Returns the state to report when there are none. */
export function extractSources(
  name: string,
  bytes: Uint8Array,
): { sources: ModuleSource[]; options: PartsOptions } {
  const kind = sniffKind(bytes);
  if (kind === "unknown") throw new NotAWorkbookError(name);
  try {
    const project = extractProject(bytes);
    const sources = project.modules.map((m) => ({ name: m.name, type: m.type, source: m.source }));
    return {
      sources,
      options: {
        vba: sources.length > 0 ? "present" : "none",
        references: project.references,
        referenceProblems: project.referenceProblems,
      },
    };
  } catch (e) {
    if (e instanceof NoVBAProjectError) {
      return { sources: [], options: { vba: kind === "cfb" ? "unreadable-xls" : "none" } };
    }
    const message = e instanceof Error ? e.message : String(e);
    return {
      sources: [],
      options: { vba: kind === "cfb" ? "unreadable-xls" : "none", vbaError: message },
    };
  }
}

/** The single entry for drop, file input and demo: bytes in, a read-only model out. */
export function exhume(name: string, bytes: Uint8Array): Exhumed {
  if (sniffKind(bytes) === "unknown") throw new NotAWorkbookError(name);
  checkSize(bytes.length, name);
  const { sources, options } = extractSources(name, bytes);
  return exhumeParts(name, bytes, sources, options);
}
