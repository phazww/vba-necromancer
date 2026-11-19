import { DEMOS } from "../model/demo";
import { useStore } from "../state/context";

export function DemoButtons() {
  const { state, actions } = useStore();
  const busy = state.phase === "loading";
  return (
    <section class="demos" aria-labelledby="demos-title">
      <h2 id="demos-title">No workbook at hand?</h2>
      <div class="button-row">
        {DEMOS.map((d) => (
          <button
            key={d.id}
            type="button"
            class="button"
            disabled={busy}
            onClick={() => void actions.loadFile({ name: d.fileName, bytes: d.bytes() })}
          >
            {d.title}
          </button>
        ))}
      </div>
      <p class="muted">All samples are made-up data, built into this page. The Russian one is the same job with Cyrillic text in code page 1251</p>
    </section>
  );
}
