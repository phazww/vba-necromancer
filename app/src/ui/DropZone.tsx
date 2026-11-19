import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { useStore } from "../state/context";

function filesOf(e: DragEvent): File[] {
  return Array.from(e.dataTransfer?.files ?? []);
}

/**
 * Drop target plus a real "Choose a file" button. A file dropped anywhere on the page is
 * taken, so a slightly missed drop does not make the browser open the workbook.
 */
export function DropZone(props: { compact?: boolean }) {
  const { state, actions } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const busy = state.phase === "loading";
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useLayoutEffect(() => {
    const onOver = (e: DragEvent): void => e.preventDefault();
    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      setOver(false);
      const files = filesOf(e);
      if (files.length > 0 && !busyRef.current) void actions.loadFile(files);
    };
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [actions]);

  const choose = (): void => input.current?.click();
  const onChange = (e: Event): void => {
    const el = e.currentTarget as HTMLInputElement;
    const files = Array.from(el.files ?? []);
    if (files.length > 0) void actions.loadFile(files);
    el.value = "";
  };

  const fileInput = (
    <input
      ref={input}
      type="file"
      hidden
      tabIndex={-1}
      accept=".xlsm,.xlsx,.xltm,.xls"
      disabled={busy}
      onChange={onChange}
    />
  );

  if (props.compact) {
    return (
      <div class="dropzone-compact">
        <button type="button" class="button" disabled={busy} onClick={choose}>
          Open another file
        </button>
        {fileInput}
      </div>
    );
  }

  return (
    <section
      class={`dropzone${over ? " dropzone--over" : ""}`}
      aria-labelledby="dropzone-title"
      aria-disabled={busy}
      onDragEnter={(e) => {
        e.preventDefault();
        if (!busy) setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
    >
      <h2 id="dropzone-title">Exhume a workbook</h2>
      <p>Drop an .xlsm here, or choose a file.</p>
      <button type="button" class="button button--primary" disabled={busy} onClick={choose}>
        Choose a file
      </button>
      {fileInput}
      <p class="muted">Your file stays in this browser.</p>
    </section>
  );
}
