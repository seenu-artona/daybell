"use client";

import {
  type ListFilterChip,
  type ListFiltersResponse,
  type ListPage,
  MAX_LIST_FILTERS,
} from "@daybell/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";

/** Two chips are the same filter: the same key and the same record (or none). */
export function sameChip(a: ListFilterChip, b: ListFilterChip): boolean {
  return a.key === b.key && (a.value ?? null) === (b.value ?? null);
}

export interface ListFilters {
  /**
   * The person's saved chips, in order; null while they load, or if they couldn't be loaded (then nothing can be added
   * or removed, so a list built from a failed load is never saved over the real one).
   */
  chips: ListFilterChip[] | null;
  /** Loading failed: the page says so and offers `retry`. */
  loadFailed: boolean;
  retry: () => void;
  /** Eight chips already: the menu offers no more. */
  full: boolean;
  /** Saving the last change failed and it was undone; the page says so. */
  saveFailed: boolean;
  /** Adds a chip at the end, shown at once and saved; false if it couldn't be (not loaded, full, already there, failed). */
  add: (chip: ListFilterChip) => Promise<boolean>;
  /** Removes a chip, at once and saved; put back if it can't be saved. */
  remove: (chip: ListFilterChip) => Promise<boolean>;
  /** Drops chips whose record is gone (a deleted client, job or class) and saves what is left. */
  forget: (gone: readonly ListFilterChip[]) => void;
}

/**
 * The chips a person added to one list (D147, ADR 0026): read from GET /me/list-filters, and the whole list saved with
 * PUT on every change. Changes show at once (optimistic). Saves go one at a time and the newest list wins: while one is
 * in flight, later changes wait and only the latest is sent next. If the latest list can't be saved, the chips go back
 * to the last list the server accepted. Keys and ids only: the page looks up each chip's name by id.
 */
export function useListFilters(page: ListPage, jobId?: string): ListFilters {
  const [chips, setChips] = useState<ListFilterChip[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // What the server last accepted, what the person wants now, and whether a save is in flight.
  const confirmed = useRef<ListFilterChip[] | null>(null);
  const desired = useRef<ListFilterChip[] | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const savingToken = useRef<object | null>(null);
  // Chips whose record is gone: never put back, even by a save that was in flight when they were forgotten.
  const gone = useRef<ListFilterChip[]>([]);
  const withoutGone = useCallback(
    (list: ListFilterChip[]) => list.filter((c) => !gone.current.some((g) => sameChip(c, g))),
    [],
  );
  // Answers for an earlier page, job or load are dropped.
  const epoch = useRef(0);

  const show = useCallback((next: ListFilterChip[] | null) => {
    desired.current = next;
    setChips(next);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` loads again on Retry.
  useEffect(() => {
    const mine = ++epoch.current;
    confirmed.current = null;
    saving.current = null;
    savingToken.current = null;
    gone.current = [];
    show(null);
    setLoadFailed(false);
    const query = new URLSearchParams({ page });
    if (jobId) query.set("jobId", jobId);
    void api<ListFiltersResponse>(`/me/list-filters?${query}`).then((res) => {
      if (mine !== epoch.current) return;
      if (res.ok) {
        confirmed.current = res.data.chips;
        show(res.data.chips);
      } else setLoadFailed(true);
    });
  }, [page, jobId, show, attempt]);

  /** Sends the newest list, then again while it changed meanwhile; true if the newest list was saved. */
  const flush = useCallback((): Promise<boolean> => {
    if (saving.current) return saving.current;
    const mine = epoch.current;
    const token = {};
    savingToken.current = token;
    const run = (async () => {
      let ok = true;
      for (;;) {
        const sent = desired.current;
        if (!sent || sent === confirmed.current) break;
        const res = await api("/me/list-filters", {
          method: "PUT",
          body: {
            page,
            ...(jobId ? { jobId } : {}),
            chips: sent.map((c) => (c.value ? { key: c.key, value: c.value } : { key: c.key })),
          },
        });
        if (mine !== epoch.current) return false;
        if (res.ok) {
          // What the server accepted, less anything forgotten while it was in flight (sent again next, without it).
          const kept = withoutGone(sent);
          confirmed.current = kept.length === sent.length ? sent : kept;
          ok = true;
          continue;
        }
        ok = false;
        // Only the newest list is put back; a newer change is sent next and carries the whole list anyway.
        if (desired.current === sent) {
          show(confirmed.current);
          break;
        }
      }
      // Cleared in the same step as the last check of the newest list, so a change right after starts a new save.
      if (savingToken.current === token) {
        saving.current = null;
        savingToken.current = null;
      }
      setSaveFailed(!ok);
      return ok;
    })();
    if (savingToken.current === token) saving.current = run;
    return run;
  }, [page, jobId, show, withoutGone]);

  const change = useCallback(
    (next: ListFilterChip[]): Promise<boolean> => {
      show(next);
      // With a save in flight, its loop sends this newest list next.
      return flush();
    },
    [show, flush],
  );

  const add = useCallback(
    async (chip: ListFilterChip) => {
      const now = desired.current;
      if (!now || now.length >= MAX_LIST_FILTERS || now.some((c) => sameChip(c, chip)))
        return false;
      return change([...now, chip]);
    },
    [change],
  );

  const remove = useCallback(
    async (chip: ListFilterChip) => {
      const now = desired.current;
      if (!now) return false;
      return change(now.filter((c) => !sameChip(c, chip)));
    },
    [change],
  );

  const forget = useCallback(
    (forgotten: readonly ListFilterChip[]) => {
      const now = desired.current;
      if (!now || !confirmed.current) return;
      const keep = (c: ListFilterChip) => !forgotten.some((g) => sameChip(c, g));
      const next = now.filter(keep);
      if (next.length === now.length) return;
      // The records are gone either way: if saving fails, they are not put back, nor by a save already in flight.
      gone.current = [...gone.current, ...forgotten];
      confirmed.current = withoutGone(confirmed.current);
      void change(next);
    },
    [change, withoutGone],
  );

  return {
    chips,
    loadFailed,
    retry: () => setAttempt((n) => n + 1),
    full: (chips?.length ?? 0) >= MAX_LIST_FILTERS,
    saveFailed,
    add,
    remove,
    forget,
  };
}
