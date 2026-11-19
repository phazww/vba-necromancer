import { DemoButtons } from "./DemoButtons";
import { DropZone } from "./DropZone";

/** The "Invoice" sheet of the built-in demo after BuildInvoice ran (fixtures/expected/demo_invoice.json). */
const ACTS: ReadonlyArray<readonly [string, string, string, string]> = [
  ["Repairs", "65", "484.65", "1286290"],
  ["Welding", "21", "31.5", "19560"],
  ["Maintenance", "52", "76.4", "114830"],
  ["Emergency call-outs", "43", "485", "928500"],
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
          <span class="preview-file">Sheet Invoice</span>
          <span class="preview-sheet">after the run</span>
        </div>
        <div class="preview-code">
          <span class="kw">Sub</span> BuildInvoice()
          <span class="preview-status">
            <span class="shape shape--fully" />
            Fully resurrected
          </span>
        </div>
        <table class="preview-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Qty</th>
              <th>Labour hours</th>
              <th>Amount</th>
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
              <td>Total</td>
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
