// VBA Necromancer — placeholder app entry point.
// Full UI will be implemented in TASK-17.

const appEl = document.getElementById("app");
if (appEl) {
  appEl.innerHTML = `
    <h1>VBA Necromancer 💀</h1>
    <p>Drop an <code>.xlsm</code> file here to resurrect its macros.</p>
  `;
}
