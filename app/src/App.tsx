import type { Deps } from "./state/actions";
import { StoreProvider, useStore } from "./state/context";
import type { AppState } from "./state/types";
import { Footer } from "./ui/Footer";
import { DemoButtons } from "./ui/DemoButtons";
import { DropZone } from "./ui/DropZone";
import { ExhumePanel } from "./ui/ExhumePanel";
import { Header, SkipLink } from "./ui/Header";
import { ResultBar } from "./ui/ResultBar";
import { Workspace } from "./ui/Workspace";
import { LoadError } from "./ui/LoadError";
import { AlertRegion, LiveRegion } from "./ui/LiveRegion";

function Workbook() {
  const { state } = useStore();
  // A workbook that is already open stays on screen while another one loads or fails to load.
  const ready = state.exhumed !== null;
  return (
    <main id="workbook" tabIndex={-1}>
      <LoadError />
      {ready ? (
        <div class="layout">
          <aside class="layout-side">
            <ExhumePanel />
          </aside>
          <div class="layout-main">
            <ResultBar />
            <Workspace />
          </div>
        </div>
      ) : (
        <>
          <p class="empty-state">Nothing buried here yet</p>
          <DropZone />
          <DemoButtons />
        </>
      )}
    </main>
  );
}

export interface AppProps {
  /** For tests: start from a given state. */
  initial?: AppState;
  /** For tests: replace exhume, resurrect and the download. */
  deps?: Partial<Deps>;
}

export function App(props: AppProps = {}) {
  return (
    <StoreProvider initial={props.initial} deps={props.deps}>
      <SkipLink />
      <Header />
      <LiveRegion />
      <AlertRegion />
      <Workbook />
      <Footer />
    </StoreProvider>
  );
}
