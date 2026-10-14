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
  /** The person's saved chips, in order; null while loading, [] if they couldn't be loaded (the built-in chips work). */
  chips: ListFilterChip[] | null;
  /** Eight chips already: the menu offers no more. */
  full: boolean;
  /** Saving the last change failed and it was undone; the page says so. */
  saveFailed: boolean;
  /** Adds a chip at the end, shown at once and saved; undone if it can't be saved. */
  add: (chip: ListFilterChip) => Promise<boolean>;
  /** Removes a chip, at once and saved; put back if it can't be saved. */
  remove: (chip: ListFilterChip) => Promise<boolean>;
  /** Drops chips whose record is gone (a deleted client, job or class) and saves what is left. */
  forget: (gone: readonly ListFilterChip[]) => void;
}

/**
 * The chips a person added to one list (D147, ADR 0026): read once from GET /me/list-filters, and the whole list saved
 * with PUT on every change. Changes show at once (optimistic) and are undone if the save fails, unless a newer change
 * has replaced them meanwhile. Keys and ids only: the page looks up each chip's name by id.
 */
export function useListFilters(page: ListPage, jobId?: string): ListFilters {
  const [chips, setChips] = useState<ListFilterChip[] | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const current = useRef<ListFilterChip[] | null>(null);

  const show = useCallback((next: ListFilterChip[] | null) => {
    current.current = next;
    setChips(next);
  }, []);

  useEffect(() => {
    let live = true;
    show(null);
    const query = new URLSearchParams({ page });
    if (jobId) query.set("jobId", jobId);
    void api<ListFiltersResponse>(`/me/list-filters?${query}`).then((res) => {
      if (live) show(res.ok ? res.data.chips : []);
    });
    return () => {
      live = false;
    };
  }, [page, jobId, show]);

  const save = useCallback(
    async (next: ListFilterChip[], before: ListFilterChip[]): Promise<boolean> => {
      show(next);
      const res = await api(`/me/list-filters`, {
        method: "PUT",
        body: {
          page,
          ...(jobId ? { jobId } : {}),
          chips: next.map((c) => (c.value ? { key: c.key, value: c.value } : { key: c.key })),
        },
      });
      if (res.ok) {
        setSaveFailed(false);
        return true;
      }
      // Undo, unless a newer change has replaced this one already.
      if (current.current === next) show(before);
      setSaveFailed(true);
      return false;
    },
    [page, jobId, show],
  );

  const add = useCallback(
    async (chip: ListFilterChip) => {
      const before = current.current;
      if (!before || before.length >= MAX_LIST_FILTERS || before.some((c) => sameChip(c, chip)))
        return false;
      return save([...before, chip], before);
    },
    [save],
  );

  const remove = useCallback(
    async (chip: ListFilterChip) => {
      const before = current.current;
      if (!before) return false;
      return save(
        before.filter((c) => !sameChip(c, chip)),
        before,
      );
    },
    [save],
  );

  const forget = useCallback(
    (gone: readonly ListFilterChip[]) => {
      const before = current.current;
      if (!before) return;
      const next = before.filter((c) => !gone.some((g) => sameChip(c, g)));
      // Nothing to put back if this fails: the records are gone either way.
      if (next.length !== before.length) void save(next, next);
    },
    [save],
  );

  return {
    chips,
    full: (chips?.length ?? 0) >= MAX_LIST_FILTERS,
    saveFailed,
    add,
    remove,
    forget,
  };
}
