export function LimitsNote() {
  return (
    <details class="limits">
      <summary>What this does not do yet</summary>
      <ul>
        <li>Formulas are not recalculated. A macro that changes a cell does not change the formulas that depend on it; the cached values from the file are shown.</li>
        <li>Buttons are not read. The macros are listed and run from the list; the buttons drawn on the sheets are not shown.</li>
        <li>VBA in old .xls files cannot be read yet. Their sheets open, their macros do not.</li>
        <li>Number formats: only common ones are shown in the grid (dates, times, percentages, thousands separators, decimals). Colours, conditions, fractions, scientific notation, AM/PM and weekday names show the stored number. Hover a formatted cell to see the stored value.</li>
      </ul>
    </details>
  );
}

export function Footer() {
  return (
    <footer class="app-footer">
      <LimitsNote />
      <p>Your file never leaves this browser.</p>
    </footer>
  );
}
