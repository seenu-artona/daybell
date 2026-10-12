/**
 * Which sections of the review are loading, so the selection bar can wait for fresh data (ADR 0018). Each load gets its
 * own token; `start` returns the function that ends it, which is safe to call any number of times (when the request
 * settles, fails, or the section unmounts), so a load can never be counted twice or left running.
 */
export interface LoadTracker {
  /** Starts a load; call the returned function when it ends, however it ends. */
  start: () => () => void;
  /** Loads in flight. */
  readonly size: number;
}

export function createLoadTracker(onChange: (loading: boolean) => void): LoadTracker {
  const loads = new Set<symbol>();
  return {
    start() {
      const token = Symbol("load");
      loads.add(token);
      if (loads.size === 1) onChange(true);
      return () => {
        if (!loads.delete(token)) return;
        if (loads.size === 0) onChange(false);
      };
    },
    get size() {
      return loads.size;
    },
  };
}
