/**
 * Frozen empty array used as a stable identity fallback in Zustand selectors.
 *
 * Returning `[]` literally inside a selector creates a new array reference on
 * every call. Zustand uses `Object.is` to decide whether a slice changed; a
 * fresh reference always compares unequal, which combined with React Flow's
 * `<StoreUpdater>` (or any other observer) trips React's `useSyncExternalStore`
 * into an infinite re-render loop: "Maximum update depth exceeded".
 *
 * Use this constant — its identity is stable for the lifetime of the module:
 *
 *   const tasks = useStore((s) => s.tasksById[id] ?? (EMPTY_ARRAY as Task[]));
 */
// `never[]` so it widens to any concrete element type at the use site
// (e.g. `EMPTY_ARRAY as Task[]`). Identity is stable for the module's
// lifetime — that's what the selector needs, not deep immutability.
export const EMPTY_ARRAY: never[] = [];
