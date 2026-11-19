export function SkipLink() {
  return (
    <a class="skip-link" href="#workbook">
      Skip to workbook
    </a>
  );
}

/** A tombstone drawn with currentColor; the text next to it carries the name. */
function Tombstone() {
  return (
    <svg class="tombstone" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M6 21V10a6 6 0 0 1 12 0v11z M3 21h18 M12 8v6 M9.5 10.5h5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function Header() {
  return (
    <header class="app-header">
      <Tombstone />
      <div>
        <h1>VBA Necromancer</h1>
        <p class="tagline">Bring dead macros back, in your browser.</p>
      </div>
    </header>
  );
}
