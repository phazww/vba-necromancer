import { useStore } from "../state/context";
import type { AppState } from "../state/types";

/** What a screen reader hears for the current state; empty when nothing is going on. */
export function announcement(state: AppState): string {
  if (state.phase === "loading") return "Exhuming";
  if (state.run.status === "running") return "Running";
  if (state.run.status === "done") {
    const { result, counts } = state.run.view;
    const label = result.status === "failed" ? "Run failed" : capitalise(result.status);
    return `${label}. ${counts.changed} ${counts.changed === 1 ? "cell" : "cells"} changed.`;
  }
  return "";
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Polite announcements; errors go to the separate alert region. */
export function LiveRegion() {
  const { state } = useStore();
  return (
    <div role="status" class="visually-hidden">
      {announcement(state)}
    </div>
  );
}

export function AlertRegion() {
  const { state } = useStore();
  return (
    <div role="alert" class="alert-region">
      {state.actionError ? <p class="error-text">{state.actionError}</p> : null}
    </div>
  );
}
