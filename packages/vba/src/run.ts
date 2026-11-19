import type { ModuleAST } from "./ast.js";
import type { WorkbookHandle } from "./host.js";
import { Interpreter, type RunOptions, type RunResult } from "./interpreter.js";

/** Run one macro (`Name` or `Module.Name`) from the given modules against a workbook. */
export function runMacro(
  macroName: string,
  modules: ModuleAST[],
  workbook: WorkbookHandle,
  options: RunOptions = {},
): RunResult {
  return new Interpreter(modules, workbook).run(macroName, options);
}
