import { useEffect, useState } from "preact/hooks";

function match(query: string, fallback: boolean): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : fallback;
}

/** Tracks a CSS media query. `fallback` is used where `matchMedia` does not exist. */
export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = useState(() => match(query, fallback));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = (): void => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Two columns from 960 px; below it one column with tabs. */
export const WIDE_QUERY = "(min-width: 960px)";

export function useIsWide(): boolean {
  return useMediaQuery(WIDE_QUERY, true);
}
