import { useStore } from "../state/context";
import { GraveyardPanel, graveyardEntries } from "./GraveyardPanel";
import { Tabs } from "./Tabs";
import { TracePanel } from "./TracePanel";

export function SidePanels() {
  const { state, dispatch } = useStore();
  const traceCount = state.run.status === "done" ? state.run.view.result.trace.length : 0;
  const graveyardCount = graveyardEntries(state).length;
  return (
    <Tabs
      idBase="side"
      label="Trace and graveyard"
      tabs={[
        { id: "trace", label: `Trace (${traceCount.toLocaleString("en-US")})` },
        { id: "graveyard", label: `Graveyard (${graveyardCount})` },
      ]}
      selected={state.view.panel}
      onSelect={(id) => dispatch({ type: "set-panel", panel: id === "graveyard" ? "graveyard" : "trace" })}
      panelTabIndex={-1}
    >
      {state.view.panel === "graveyard" ? <GraveyardPanel /> : <TracePanel />}
    </Tabs>
  );
}
