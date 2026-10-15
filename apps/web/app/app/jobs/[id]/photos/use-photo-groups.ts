"use client";

import type { PhotoGroup, PhotoGroupsResponse } from "@daybell/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";

/**
 * A job's photo groups (D156; ADR 0030), by name, and how many group photos are in no group (C2). A job holds at most
 * 500, so the list is read whole; `reload` after any change. The newest load wins.
 */
export function usePhotoGroups(jobId: string) {
  const [groups, setGroups] = useState<PhotoGroup[] | null>(null);
  const [notInGroup, setNotInGroup] = useState(0);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++latest.current;
    const res = await api<PhotoGroupsResponse>(`/jobs/${encodeURIComponent(jobId)}/groups`);
    if (mine !== latest.current) return;
    setFailed(!res.ok);
    if (!res.ok) return;
    setGroups(res.data.groups);
    setNotInGroup(res.data.notInGroup);
  }, [jobId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { groups, notInGroup, failed, reload };
}
