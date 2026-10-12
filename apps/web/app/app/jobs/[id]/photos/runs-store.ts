"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { RunView } from "./upload-sheet";

/**
 * This tab's uploads, per job, kept outside the page so they keep showing (and keep running) when someone looks at
 * another of the job's tabs and comes back. In memory only: nothing about an upload is stored in the browser.
 */
const runs = new Map<string, RunView[]>();
const listeners = new Set<() => void>();
const EMPTY: RunView[] = [];

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRuns(
  jobId: string,
): [RunView[], (update: (runs: RunView[]) => RunView[]) => void] {
  const current = useSyncExternalStore(
    subscribe,
    () => runs.get(jobId) ?? EMPTY,
    () => EMPTY,
  );
  const update = useCallback(
    (fn: (all: RunView[]) => RunView[]) => {
      runs.set(jobId, fn(runs.get(jobId) ?? EMPTY));
      for (const l of listeners) l();
    },
    [jobId],
  );
  return [current, update];
}
