import { useStore } from "../state/context";
import type { NarrowTab } from "../state/types";
import { GraveyardPanel, graveyardEntries } from "./GraveyardPanel";
import { GridView } from "./GridView";
import { SidePanels } from "./SidePanels";
import { SourceView } from "./SourceView";
import { Tabs } from "./Tabs";
import { TracePanel } from "./TracePanel";
import { useIsWide } from "./useMediaQuery";

const NARROW_IDS: readonly NarrowTab[] = ["grid", "source", "trace", "graveyard"];

function NarrowTabs() {
  const { state, dispatch } = useStore();
  const { narrowTab } = state.view;
  const traceCount = state.run.status === "done" ? state.run.view.result.trace.length : 0;
  const labels: Record<NarrowTab, string> = {
    grid: "Grid",
    source: "Source",
    trace: `Trace (${traceCount.toLocaleString("en-US")})`,
    graveyard: `Graveyard (${graveyardEntries(state).length})`,
  };
  return (
    <Tabs
      idBase="view"
      label="Views"
      tabs={NARROW_IDS.map((id) => ({ id, label: labels[id] }))}
      selected={narrowTab}
      onSelect={(id) => dispatch({ type: "set-narrow-tab", tab: id as NarrowTab })}
      panelTabIndex={-1}
    >
      {narrowTab === "grid" ? <GridView /> : null}
      {narrowTab === "source" ? <SourceView /> : null}
      {narrowTab === "trace" ? <TracePanel /> : null}
      {narrowTab === "graveyard" ? <GraveyardPanel /> : null}
    </Tabs>
  );
}

/** Two columns from 960 px: grid and source side by side, trace and graveyard below. One tab list below that. */
export function Workspace() {
  const wide = useIsWide();
  if (!wide) return <NarrowTabs />;
  return (
    <>
      <div class="workspace">
        <GridView />
        <SourceView />
      </div>
      <SidePanels />
    </>
  );
}
