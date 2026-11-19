import { useStore } from "../state/context";

/** The error from the last failed load, and the line about ignored files. */
export function LoadError() {
  const { state } = useStore();
  return (
    <>
      {state.loadError ? (
        <p role="alert" class="error-text">
          {state.loadError}
        </p>
      ) : null}
      {state.notice ? <p class="notice">{state.notice}</p> : null}
    </>
  );
}
