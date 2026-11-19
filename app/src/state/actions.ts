import { exhume as defaultExhume } from "../model/exhume";
import { resurrect as defaultResurrect } from "../model/resurrect";
import { checkSize } from "../model/sniff";
import type { AppState, Dispatch } from "./types";

export type LoadSource = File | { name: string; bytes: Uint8Array };

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface Deps {
  exhume: typeof defaultExhume;
  resurrect: typeof defaultResurrect;
  saveBlob: (blob: Blob, name: string) => void;
}

/** Offers a Blob as a download through a temporary object URL that is revoked afterwards. */
export function defaultSaveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Lets the browser paint the state just dispatched before synchronous work starts. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      setTimeout(resolve, 0);
    };
    if (typeof requestAnimationFrame === "function") {
      // A hidden tab never fires animation frames; do not wait for one forever.
      const fallback = setTimeout(done, 100);
      requestAnimationFrame(() => {
        clearTimeout(fallback);
        done();
      });
    } else {
      done();
    }
  });
}

export const defaultDeps: Deps = {
  exhume: defaultExhume,
  resurrect: defaultResurrect,
  saveBlob: defaultSaveBlob,
};

function readWithFileReader(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsArrayBuffer(file);
  });
}

type BytesSource = { name: string; bytes: Uint8Array };

// A File has a bytes() method in current browsers, so test for the property's type.
function isBytesSource(source: LoadSource): source is BytesSource {
  return typeof (source as { bytes?: unknown }).bytes === "object";
}

async function readSource(source: LoadSource): Promise<BytesSource> {
  if (isBytesSource(source)) {
    checkSize(source.bytes.length, source.name);
    return source;
  }
  checkSize(source.size, source.name);
  const buffer =
    typeof source.arrayBuffer === "function" ? await source.arrayBuffer() : await readWithFileReader(source);
  return { name: source.name, bytes: new Uint8Array(buffer) };
}

/** `Акты 2026.xlsm` -> `Акты_2026-resurrected.xlsx` */
export function downloadName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const clean = base.replace(/[^\p{L}\p{N}\-_.]/gu, "_").replace(/^\.+/, "");
  return `${clean === "" ? "workbook" : clean}-resurrected.xlsx`;
}

function plural(n: number): string {
  return n === 1 ? "1 other file was ignored" : `${n} other files were ignored`;
}

export interface Actions {
  loadFile(source: LoadSource | readonly LoadSource[]): Promise<void>;
  runMacro(macroId: string): Promise<void>;
  download(): void;
}

export function createActions(
  getState: () => AppState,
  dispatch: Dispatch,
  deps: Partial<Deps> = {},
): Actions {
  const exhume = deps.exhume ?? defaultExhume;
  const resurrect = deps.resurrect ?? defaultResurrect;
  const saveBlob = deps.saveBlob ?? defaultSaveBlob;
  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  return {
    async loadFile(input) {
      const sources = "name" in input ? [input as LoadSource] : (input as readonly LoadSource[]);
      const first = sources[0];
      if (!first) return;
      dispatch({ type: "load-start" });
      try {
        const { name, bytes } = await readSource(first);
        await nextFrame();
        const exhumed = exhume(name, bytes);
        const ignored = sources.length - 1;
        dispatch({ type: "load-ok", exhumed, notice: ignored > 0 ? plural(ignored) : null });
      } catch (e) {
        dispatch({ type: "load-fail", message: message(e) });
      }
    },

    async runMacro(macroId) {
      const { exhumed, run } = getState();
      if (!exhumed || run.status === "running") return;
      dispatch({ type: "run-start", macroId });
      await nextFrame();
      try {
        dispatch({ type: "run-done", view: resurrect(exhumed, macroId) });
      } catch (e) {
        dispatch({ type: "run-fail", message: `Could not run ${macroId}: ${message(e)}` });
      }
    },

    download() {
      const { exhumed, run } = getState();
      if (!exhumed || run.status !== "done") return;
      try {
        const bytes = run.view.workbook.save();
        saveBlob(new Blob([bytes as BlobPart], { type: XLSX_MIME }), downloadName(exhumed.fileName));
      } catch (e) {
        dispatch({ type: "save-fail", message: `Could not build the .xlsx: ${message(e)}` });
      }
    },
  };
}
