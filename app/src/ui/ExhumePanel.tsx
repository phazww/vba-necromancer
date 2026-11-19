import { formatBytes } from "../model/format";
import type { Exhumed, ExhumedModule, MacroInfo, RunView } from "../model/types";
import { useStore } from "../state/context";
import type { RunState } from "../state/types";
import { DropZone } from "./DropZone";
import { useIsWide } from "./useMediaQuery";

const KIND_LABEL: Record<ExhumedModule["type"], string> = {
  procedural: "module",
  class: "class",
  document: "document",
  designer: "form",
};

export function FileSummary(props: { exhumed: Exhumed }) {
  const { exhumed } = props;
  return (
    <div class="file-summary">
      <p class="file-name">{exhumed.fileName}</p>
      <p class="muted">{formatBytes(exhumed.size)}</p>
      <DropZone compact />
    </div>
  );
}

export function SheetList(props: { exhumed: Exhumed; open?: boolean }) {
  return (
    <details open={props.open ?? true} class="fold">
      <summary>Sheets ({props.exhumed.sheets.length})</summary>
      <ul class="plain-list">
        {props.exhumed.sheets.map((s) => (
          <li key={s.name}>
            <span class="name">{s.name}</span>{" "}
            <span class="muted">
              {s.rows} {s.rows === 1 ? "row" : "rows"}, {s.cols} {s.cols === 1 ? "column" : "columns"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ModuleList(props: { exhumed: Exhumed; open?: boolean }) {
  const { modules } = props.exhumed;
  if (modules.length === 0) return null;
  return (
    <details open={props.open ?? true} class="fold">
      <summary>VBA modules ({modules.length})</summary>
      <ul class="plain-list">
        {modules.map((m) => (
          <li key={m.name}>
            <span class="name">{m.name}</span>{" "}
            <span class="muted">
              {KIND_LABEL[m.type]}, {m.lines.length} {m.lines.length === 1 ? "line" : "lines"}
            </span>
            {m.parseError ? (
              <p class="error-text">
                Could not parse: {m.parseError.message} (line {m.parseError.line}). No macros are offered from this
                module.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function NoVbaNotice(props: { exhumed: Exhumed }) {
  const { exhumed } = props;
  if (exhumed.vba === "present") return null;
  if (exhumed.vba === "unreadable-xls") {
    return <p class="notice">VBA in .xls files cannot be read yet. The sheets are shown, but there are no macros to run.</p>;
  }
  return (
    <p class="notice">
      No VBA project found in this workbook.
      {exhumed.vbaError ? ` Could not read the VBA project in ${exhumed.fileName}: ${exhumed.vbaError}` : ""}
    </p>
  );
}

export function predictionText(m: MacroInfo): string {
  const { status, hits } = m.prediction;
  if (status === "fully") return "Predicted: fully resurrected";
  const n = hits.length;
  const lines = [...new Set(hits.map((h) => h.line))].join(", ");
  return `Predicted: partly resurrected, ${n} unsupported ${n === 1 ? "construct" : "constructs"} (${n === 1 ? "line" : "lines"} ${lines})`;
}

export function statusText(view: RunView): string {
  const s = view.result.status;
  return s === "failed" ? "Run failed" : s.charAt(0).toUpperCase() + s.slice(1);
}

function otherProceduresText(n: number): string {
  return n === 1
    ? "1 other procedure is not listed because it is a Function, Private or takes parameters."
    : `${n} other procedures are not listed because they are Functions, Private or take parameters.`;
}

export function MacroList(props: { exhumed: Exhumed; run: RunState }) {
  const { actions } = useStore();
  const { exhumed, run } = props;
  const running = run.status === "running";
  const other = exhumed.procedureCount - exhumed.macros.length;
  return (
    <div>
      <h3>Macros</h3>
      {exhumed.macros.length === 0 ? (
        exhumed.vba === "present" ? (
          <p class="muted">No macros found: every procedure is a Function, Private or takes parameters.</p>
        ) : null
      ) : (
        <ul class="plain-list macro-list" aria-busy={running}>
          {exhumed.macros.map((m) => {
            const done = run.status === "done" && run.macroId === m.id ? run.view : null;
            return (
              <li key={m.id} class="macro">
                <div class="macro-head">
                  <span class="name">{m.id}</span>
                  <button
                    type="button"
                    class="button button--primary"
                    aria-label={`Run ${m.id}`}
                    disabled={running}
                    onClick={() => void actions.runMacro(m.id)}
                  >
                    Run
                  </button>
                </div>
                <p class="muted">{predictionText(m)}</p>
                {done ? <p class="actual">Result: {statusText(done)}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
      {other > 0 && exhumed.vba === "present" ? <p class="muted">{otherProceduresText(other)}</p> : null}
    </div>
  );
}

export function ExhumePanel() {
  const { state } = useStore();
  const { exhumed, run } = state;
  const wide = useIsWide();
  if (!exhumed) return null;
  // On a narrow screen the lists fold away once there is a result to look at.
  const open = wide || run.status !== "done";
  return (
    <section class="panel exhume" aria-labelledby="exhume-title">
      <h2 id="exhume-title">Exhume</h2>
      <FileSummary exhumed={exhumed} />
      <SheetList exhumed={exhumed} open={open} />
      <ModuleList exhumed={exhumed} open={open} />
      <NoVbaNotice exhumed={exhumed} />
      <MacroList exhumed={exhumed} run={run} />
    </section>
  );
}
