"use client";

import type { ChildrenResponse, Class, ClassesResponse, RosterChild } from "@daybell/api";
import { ROSTER_VIEW_MAX } from "@daybell/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";

const PAGE = 500;

export interface Roster {
  /** Null until the first page arrives. */
  rows: RosterChild[] | null;
  classes: Class[];
  /** Children on the roster; can be more than the rows loaded (ROSTER_VIEW_MAX). */
  total: number;
  /** More pages are still loading. */
  loadingMore: boolean;
  failed: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads the whole roster for People (D138; ADR 0013): every page of 500, up to 5,000 children, plus the classes.
 * Search, filters, duplicates and class counts need the whole roster, so it is drawn after the first page and fills in
 * as the rest arrive. Only ids go in the URLs. After any change it reloads, since duplicates are worked out over the
 * whole job on the server.
 */
export function useRoster(jobId: string): Roster {
  const [rows, setRows] = useState<RosterChild[] | null>(null);
  const [classes, setClasses] = useState<Class[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    const path = (cursor: string | null) =>
      `/jobs/${encodeURIComponent(jobId)}/children?limit=${PAGE}${cursor ? `&cursor=${cursor}` : ""}`;
    const [first, classList] = await Promise.all([
      api<ChildrenResponse>(path(null)),
      api<ClassesResponse>(`/jobs/${encodeURIComponent(jobId)}/classes`),
    ]);
    // A newer reload (after another change) wins.
    if (request !== latest.current) return;
    if (!first.ok || !classList.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setClasses(classList.data.classes);
    setTotal(first.data.total);
    let all = first.data.children;
    let cursor = first.data.nextCursor;
    setRows(all);
    setLoadingMore(cursor !== null && all.length < ROSTER_VIEW_MAX);
    while (cursor && all.length < ROSTER_VIEW_MAX) {
      const next = await api<ChildrenResponse>(path(cursor));
      if (request !== latest.current) return;
      if (!next.ok) {
        setFailed(true);
        break;
      }
      all = [...all, ...next.data.children].slice(0, ROSTER_VIEW_MAX);
      cursor = next.data.nextCursor;
      setRows(all);
    }
    setLoadingMore(false);
  }, [jobId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rows, classes, total, loadingMore, failed, reload };
}
