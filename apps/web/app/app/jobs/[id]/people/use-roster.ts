"use client";

import type { Child, ChildrenResponse, Group, GroupsResponse } from "@daybell/api";
import { ROSTER_VIEW_MAX } from "@daybell/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";

const PAGE = 500;

export interface Roster {
  /** Null until the first page arrives. */
  rows: Child[] | null;
  groups: Group[];
  /** Children on the roster; can be more than the rows loaded (ROSTER_VIEW_MAX). */
  total: number;
  /** More pages are still loading. */
  loadingMore: boolean;
  failed: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads the whole roster for People (D138; ADR 0013): every page of 500, up to 5,000 children, plus the groups.
 * Search, filters, duplicates and group counts need the whole roster, so it is drawn after the first page and fills in
 * as the rest arrive. Only ids go in the URLs. After any change it reloads, since duplicates are worked out over the
 * whole job on the server.
 */
export function useRoster(jobId: string): Roster {
  const [rows, setRows] = useState<Child[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    const path = (cursor: string | null) =>
      `/jobs/${encodeURIComponent(jobId)}/children?limit=${PAGE}${cursor ? `&cursor=${cursor}` : ""}`;
    const [first, groupList] = await Promise.all([
      api<ChildrenResponse>(path(null)),
      api<GroupsResponse>(`/jobs/${encodeURIComponent(jobId)}/groups`),
    ]);
    // A newer reload (after another change) wins.
    if (request !== latest.current) return;
    if (!first.ok || !groupList.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setGroups(groupList.data.groups);
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

  return { rows, groups, total, loadingMore, failed, reload };
}
