import { parseMacroRef, type RawButton } from "@vba-necromancer/workbook";
import type { ButtonInfo, MacroInfo } from "./types";

function unresolved(button: RawButton, note: string): ButtonInfo {
  return { ...button, macroId: null, note, prediction: null };
}

function joinNames(names: string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Resolves the macro reference of each button against the macro list (BTN-03).
 * A resolved button copies the prediction of its macro (the same object), so the button
 * and the list always agree. No Preact or DOM imports.
 */
export function resolveButtons(
  raw: RawButton[],
  macros: MacroInfo[],
  fileName: string,
): ButtonInfo[] {
  return raw.map((button) => {
    const ref = parseMacroRef(button.macroRef);

    // Rule 1: another workbook. Assumes Excel wrote this workbook's own file name for a prefixed reference.
    if (ref.book !== null && ref.book.toLowerCase() !== fileName.toLowerCase()) {
      return unresolved(button, `Macro not found: it belongs to another workbook (${ref.book}).`);
    }

    const qualified = ref.qualified;
    const lower = qualified.toLowerCase();
    // Rule 2: Module.Name matches the macro id.
    if (qualified.includes(".")) {
      const macro = macros.find((m) => m.id.toLowerCase() === lower);
      if (macro) return { ...button, macroId: macro.id, note: null, prediction: macro.prediction };
      return unresolved(button, `Macro not found: ${qualified}.`);
    }

    // Rule 3: a bare name matches the macro name; two modules with that name are ambiguous.
    const named = macros.filter((m) => m.name.toLowerCase() === lower);
    if (named.length === 1)
      return { ...button, macroId: named[0].id, note: null, prediction: named[0].prediction };
    if (named.length > 1) {
      const modules = joinNames(named.map((m) => m.module));
      return unresolved(
        button,
        `Macro not found: ${qualified} exists in ${modules}, so the button is ambiguous.`,
      );
    }

    // Rule 4: nothing matches (a Private Sub, a Function and a Sub with parameters are not in the macro list).
    return unresolved(button, `Macro not found: ${qualified}.`);
  });
}
