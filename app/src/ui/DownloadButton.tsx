import { useStore } from "../state/context";

export function DownloadButton() {
  const { state, actions } = useStore();
  const { run } = state;
  const done = run.status === "done";
  let note = "Run a macro first";
  if (done) {
    note =
      run.view.result.status === "fully resurrected"
        ? "The .xlsx has no macros and holds the values the macro wrote."
        : "This file contains partial results: the run did not finish cleanly or skipped unsupported code.";
  }
  return (
    <div class="download">
      <button
        type="button"
        class="button button--primary"
        disabled={!done}
        aria-describedby="download-note"
        onClick={() => actions.download()}
      >
        Download .xlsx
      </button>
      <p id="download-note" class="muted">
        {note}
      </p>
    </div>
  );
}
