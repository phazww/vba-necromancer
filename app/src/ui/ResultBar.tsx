import { RuntimeError } from "@vba-necromancer/vba";
import type { RunView } from "../model/types";
import { useStore } from "../state/context";
import { DownloadButton } from "./DownloadButton";
import { statusText } from "./ExhumePanel";

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export function durationText(ms: number): string {
  return ms < 1 ? "under 1 ms" : `${Math.round(ms).toLocaleString("en-US")} ms`;
}

function shapeFor(status: RunView["result"]["status"]): string {
  return status === "fully resurrected" ? "fully" : status === "partly resurrected" ? "partly" : "failed";
}

function RunSummary(props: { view: RunView }) {
  const { dispatch } = useStore();
  const { view } = props;
  const { result, counts } = view;
  const error = result.error;
  const where = error instanceof RuntimeError && error.module !== "" && error.line > 0 ? error : null;
  const stopped = result.stoppedAt;
  return (
    <div class="run-summary">
      <p class="status-line">
        <span class={`badge badge--${shapeFor(result.status)}`}>
          <span class={`shape shape--${shapeFor(result.status)}`} aria-hidden="true" />
          {statusText(view)}
        </span>{" "}
        <span class="muted">{view.macroId}</span>
      </p>
      <p class="counts">
        {plural(counts.changed, "cell changed", "cells changed")}, {plural(counts.reads, "read", "reads")},{" "}
        {plural(counts.writes, "write", "writes")}, {durationText(view.durationMs)}
      </p>
      {stopped ? <p class="stopped">{`Run stopped at ${stopped.module}:${stopped.line} (${stopped.construct})`}</p> : null}
      {error ? (
        <p class="error-text">
          {error.message}
          {where ? (
            <>
              {" "}
              <button
                type="button"
                class="link"
                onClick={() => dispatch({ type: "select-graveyard", module: where.module, line: where.line })}
              >
                {`${where.module}:${where.line}`}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

export function ResultBar() {
  const { state } = useStore();
  const { run } = state;
  return (
    <section class="panel result-bar" aria-labelledby="result-title">
      <h2 id="result-title">Resurrect</h2>
      {run.status === "done" ? (
        <RunSummary view={run.view} />
      ) : run.status === "running" ? (
        <p>Running {run.macroId}</p>
      ) : (
        <p class="muted">Pick a macro and press Run.</p>
      )}
      <DownloadButton />
    </section>
  );
}
