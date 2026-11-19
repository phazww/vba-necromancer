import { DemoButtons } from "./DemoButtons";
import { DropZone } from "./DropZone";

/** The "Акты" sheet of the built-in demo after BuildActs ran (fixtures/expected/demo_acts.json). */
const ACTS: ReadonlyArray<readonly [string, string, string, string]> = [
  ["Текущий ремонт", "65", "484.65", "1286290"],
  ["Сварочные работы", "21", "31.5", "19560"],
  ["Техническое обслуживание", "52", "76.4", "114830"],
  ["Аварийные работы", "43", "485", "928500"],
];

/**
 * A static picture of the result the demo produces, so the first screen shows what the
 * product does. It is hidden from assistive technology; the caption under it says the same.
 */
function ResultPreview() {
  return (
    <figure class="preview">
      <div class="preview-window" aria-hidden="true">
        <div class="preview-bar">
          <span class="preview-file">Sheet Акты</span>
          <span class="preview-sheet">after the run</span>
        </div>
        <div class="preview-code">
          <span class="kw">Sub</span> BuildActs()
          <span class="preview-status">
            <span class="shape shape--fully" />
            Fully resurrected
          </span>
        </div>
        <table class="preview-table">
          <thead>
            <tr>
              <th>Категория</th>
              <th>Объём</th>
              <th>Чел.-ч</th>
              <th>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {ACTS.map((r) => (
              <tr key={r[0]}>
                <td>{r[0]}</td>
                <td class="num">{r[1]}</td>
                <td class="num">{r[2]}</td>
                <td class="num">{r[3]}</td>
              </tr>
            ))}
            <tr class="total">
              <td>Итого</td>
              <td />
              <td />
              <td class="num">2349180</td>
            </tr>
          </tbody>
        </table>
      </div>
      <figcaption class="muted">
        The demo workbook after its macro ran in this page. Marked cells were written by the macro
      </figcaption>
    </figure>
  );
}

export function Landing() {
  return (
    <div class="landing">
      <div class="landing-text">
        <p class="empty-state">Nothing buried here yet</p>
        <DropZone />
        <DemoButtons />
      </div>
      <ResultPreview />
    </div>
  );
}
