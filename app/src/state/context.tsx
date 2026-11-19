import { createContext, type ComponentChildren } from "preact";
import { useContext, useMemo, useReducer, useRef } from "preact/hooks";
import { createActions, defaultDeps, type Actions, type Deps } from "./actions";
import { initialState, reduce } from "./reducer";
import type { Action, AppState, Dispatch } from "./types";

export interface Store {
  state: AppState;
  dispatch: Dispatch;
  actions: Actions;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider(props: {
  children: ComponentChildren;
  /** For tests: start from a given state. */
  initial?: AppState;
  /** For tests: replace the exhume, resurrect and save functions. */
  deps?: Partial<Deps>;
}) {
  const [state, rawDispatch] = useReducer(reduce, props.initial ?? initialState());
  // Actions read the newest state synchronously, before Preact has re-rendered.
  const latest = useRef(state);
  const depsRef = useRef(props.deps);
  depsRef.current = props.deps;

  const dispatch = useMemo<Dispatch>(
    () => (action: Action) => {
      latest.current = reduce(latest.current, action);
      rawDispatch(action);
    },
    [],
  );
  const actions = useMemo(
    () =>
      createActions(() => latest.current, dispatch, {
        exhume: (...a) => (depsRef.current?.exhume ?? defaultDeps.exhume)(...a),
        resurrect: (...a) => (depsRef.current?.resurrect ?? defaultDeps.resurrect)(...a),
        saveBlob: (...a) => (depsRef.current?.saveBlob ?? defaultDeps.saveBlob)(...a),
      }),
    [dispatch],
  );
  const store = useMemo(() => ({ state, dispatch, actions }), [state, dispatch, actions]);
  return <StoreContext.Provider value={store}>{props.children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <StoreProvider>");
  return store;
}
