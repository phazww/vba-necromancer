import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { useRovingFocus } from "./useRovingFocus";

export interface TabSpec {
  id: string;
  label: ComponentChildren;
}

/**
 * WAI-ARIA tabs with automatic activation: arrows move focus and select. One tab stop in
 * the tab list; Tab then goes into the panel. All tabs share one panel, which shows the
 * content of the selected tab.
 */
export function Tabs(props: {
  /** Unique within the page; used to build element ids. */
  idBase: string;
  label: string;
  tabs: readonly TabSpec[];
  selected: string;
  onSelect(id: string): void;
  children?: ComponentChildren;
  class?: string;
  /** Set to -1 when the panel holds its own tab stop (a grid, a listbox). */
  panelTabIndex?: 0 | -1;
}) {
  const list = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, props.tabs.findIndex((t) => t.id === props.selected));
  const tabId = (i: number): string => `${props.idBase}-tab-${i}`;
  const panelId = `${props.idBase}-panel`;

  const onKeyDown = useRovingFocus({
    count: props.tabs.length,
    index: selectedIndex,
    orientation: "horizontal",
    wrap: true,
    onMove: (i) => {
      props.onSelect(props.tabs[i].id);
      list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[i]?.focus();
    },
  });

  return (
    <div class={props.class}>
      <div role="tablist" aria-label={props.label} class="tablist" ref={list} onKeyDown={onKeyDown}>
        {props.tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={tabId(i)}
            class="tab"
            aria-selected={i === selectedIndex}
            aria-controls={panelId}
            tabIndex={i === selectedIndex ? 0 : -1}
            onClick={() => props.onSelect(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(selectedIndex)} tabIndex={props.panelTabIndex ?? 0} class="tabpanel">
        {props.children}
      </div>
    </div>
  );
}
