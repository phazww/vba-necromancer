import { describe, it, expect, vi } from "vitest";
import { exhume } from "../../src/model/exhume";
import { resurrect } from "../../src/model/resurrect";
import { MAX_FILE_BYTES } from "../../src/model/sniff";
import { XLSX_MIME, createActions, downloadName } from "../../src/state/actions";
import { initialState, reduce } from "../../src/state/reducer";
import type { Action, AppState } from "../../src/state/types";
import { fixtureBytes } from "../helpers";

function harness(deps: Parameters<typeof createActions>[2] = {}) {
  let state: AppState = initialState();
  const log: Action[] = [];
  const dispatch = (a: Action) => {
    log.push(a);
    state = reduce(state, a);
  };
  const actions = createActions(() => state, dispatch, deps);
  return { actions, log, get: () => state };
}

const demoSource = { name: "demo_acts.xlsm", bytes: fixtureBytes("demo_acts") };

describe("loadFile", () => {
  it("loads a File through arrayBuffer", async () => {
    const h = harness();
    const file = new File([fixtureBytes("demo_acts") as BlobPart], "demo_acts.xlsm");
    await h.actions.loadFile(file);
    expect(h.get().loadError).toBeNull();
    expect(h.get().phase).toBe("ready");
    expect(h.get().exhumed?.fileName).toBe("demo_acts.xlsm");
    expect(h.log[0].type).toBe("load-start");
  });

  it("loads the first of three files and sets the notice", async () => {
    const h = harness();
    await h.actions.loadFile([demoSource, demoSource, demoSource]);
    expect(h.get().exhumed?.fileName).toBe("demo_acts.xlsm");
    expect(h.get().notice).toBe("2 other files were ignored");
    await h.actions.loadFile([demoSource, demoSource]);
    expect(h.get().notice).toBe("1 other file was ignored");
  });

  it("refuses a 51 MB File before reading it", async () => {
    const h = harness();
    const arrayBuffer = vi.fn();
    const big = { name: "big.xlsm", size: 51 * 1024 * 1024, arrayBuffer } as unknown as File;
    await h.actions.loadFile(big);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(h.get().loadError).toContain((51 * 1024 * 1024).toLocaleString("en-US"));
    expect(h.get().loadError).toContain(MAX_FILE_BYTES.toLocaleString("en-US"));
  });

  it("reports a text file by name and keeps the workbook", async () => {
    const h = harness();
    await h.actions.loadFile(demoSource);
    const before = h.get().exhumed;
    await h.actions.loadFile({ name: "notes.txt", bytes: new TextEncoder().encode("hello") });
    expect(h.get().loadError).toContain("notes.txt");
    expect(h.get().exhumed).toBe(before);
    expect(h.get().phase).toBe("ready");
  });
});

describe("runMacro", () => {
  it("dispatches run-start before the interpreter is called", async () => {
    const seen: string[] = [];
    const spy = vi.fn((...args: Parameters<typeof resurrect>) => {
      seen.push(...h.log.map((a) => a.type));
      return resurrect(...args);
    });
    const h = harness({ resurrect: spy });
    await h.actions.loadFile(demoSource);
    await h.actions.runMacro("Module1.BuildActs");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(seen).toContain("run-start");
    expect(seen).not.toContain("run-done");
    expect(h.get().run.status).toBe("done");
  });

  it("reports an exception from resurrect and returns to idle", async () => {
    const h = harness({
      resurrect: () => {
        throw new Error("boom");
      },
    });
    await h.actions.loadFile(demoSource);
    await h.actions.runMacro("Module1.BuildActs");
    expect(h.get().run.status).toBe("idle");
    expect(h.get().actionError).toContain("boom");
  });
});

describe("download", () => {
  it("passes the xlsx type and the resurrected name to saveBlob", async () => {
    const saveBlob = vi.fn();
    const h = harness({ saveBlob });
    await h.actions.loadFile(demoSource);
    h.actions.download();
    expect(saveBlob).not.toHaveBeenCalled();
    await h.actions.runMacro("Module1.BuildActs");
    h.actions.download();
    expect(saveBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = saveBlob.mock.calls[0] as [Blob, string];
    expect(blob.type).toBe(XLSX_MIME);
    expect(name).toBe("demo_acts-resurrected.xlsx");
    expect(blob.size).toBeGreaterThan(100);
  });

  it("sanitises the file name", () => {
    expect(downloadName("a/b\\c:d\u0001e.xlsm")).toBe("a_b_c_d_e-resurrected.xlsx");
    expect(downloadName("Акты 2026.xlsm")).toBe("Акты_2026-resurrected.xlsx");
    expect(downloadName("...")).toBe("workbook-resurrected.xlsx");
  });

  it("shows an alert instead of saving when save() throws", async () => {
    const saveBlob = vi.fn();
    const h = harness({ saveBlob });
    await h.actions.loadFile(demoSource);
    await h.actions.runMacro("Module1.BuildActs");
    const state = h.get();
    if (state.run.status !== "done") throw new Error("not done");
    state.run.view.workbook.save = () => {
      throw new Error("no memory");
    };
    h.actions.download();
    expect(saveBlob).not.toHaveBeenCalled();
    expect(h.get().actionError).toBe("Could not build the .xlsx: no memory");
  });
});

describe("exhume wiring", () => {
  it("uses the injected exhume", async () => {
    const real = exhume("demo_acts.xlsm", fixtureBytes("demo_acts"));
    const fake = vi.fn(() => real);
    const h = harness({ exhume: fake });
    await h.actions.loadFile(demoSource);
    expect(fake).toHaveBeenCalledWith("demo_acts.xlsm", expect.any(Uint8Array));
  });
});
