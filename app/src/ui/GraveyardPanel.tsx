import { useMemo } from "preact/hooks";
import { buildGraveyard } from "../model/graveyard";
import type { GraveyardEntry, GraveyardMark } from "../model/types";
import { useStore } from "../state/context";
import type { AppState } from "../state/types";

const MARK_TEXT: Record<GraveyardMark, string> = {
  skipped: "skipped during this run",
  stopped: "stopped the run",
  "not-reached": "not reached",
  static: "",
};

/** The entries behind the panel and its tab label: from the last run when there is one. */
export function graveyardEntries(state: AppState): GraveyardEntry[] {
  if (state.run.status === "done") return state.run.view.graveyard;
  return buildGraveyard(state.exhumed?.staticUnsupported ?? [], null);
}

export function GraveyardPanel() {
  const { state, dispatch } = useStore();
  const entries = useMemo(() => graveyardEntries(state), [state.run, state.exhumed]);
  const stopped = state.run.status === "done" ? state.run.view.result.stoppedAt : undefined;
  const moduleNames = [...new Set(entries.map((e) => e.module))];
  const selection = state.selection;
  return (
    <section class="panel graveyard-panel" aria-labelledby="graveyard-title">
      <h2 id="graveyard-title">Graveyard</h2>
      {stopped ? (
        <p class="stopped banner">{`Run stopped at ${stopped.module}:${stopped.line} (${stopped.construct})`}</p>
      ) : null}
      {entries.length === 0 ? (
        <p class="muted">Nothing in the graveyard</p>
      ) : (
        moduleNames.map((module) => (
          <div key={module} class="graveyard-group">
            <h3>{module}</h3>
            <ul class="plain-list">
              {entries
                .filter((e) => e.module === module)
                .map((e) => {
                  const current = selection?.origin === "graveyard" && selection.module === e.module && selection.line === e.line;
                  return (
                    <li key={`${e.line}:${e.construct}`}>
                      <button
                        type="button"
                        class={`entry entry--${e.mark}`}
                        aria-current={current ? "true" : undefined}
                        onClick={() => dispatch({ type: "select-graveyard", module: e.module, line: e.line })}
                      >
                        <span class="where">{`${e.module}:${e.line}`}</span> <span class="construct">{e.construct}</span>
                        {MARK_TEXT[e.mark] ? <span class="mark">{MARK_TEXT[e.mark]}</span> : null}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
