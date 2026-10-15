"use client";

import type { Photo, PhotoCounts, PhotoCountsResponse, PhotosResponse } from "@daybell/api";
import { PHOTO_PAGE_SIZE } from "@daybell/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";

/** How often counts are checked while previews are being made. */
const POLL_MS = 4000;

/**
 * A job's photos (or its bin) for the Photos tab, a page of 200 at a time in tagging order, and the job's counts.
 * While photos are processing (or an upload runs), the counts are checked every few seconds; when they change, every
 * page already shown is loaded again (review CR6), so new previews appear without losing the place or the open photo.
 * With `rows: false` only the counts are read (People shows each person's photos instead: D156).
 */
export function usePhotos(
  jobId: string,
  bin: boolean,
  busy: boolean,
  { rows: listRows = true }: { rows?: boolean } = {},
) {
  const [rows, setRows] = useState<Photo[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState<PhotoCounts | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const shown = useRef(0);
  const base = `/jobs/${encodeURIComponent(jobId)}/photos`;
  const page = useCallback(
    (cursor: string | null) =>
      api<PhotosResponse>(
        `${base}?limit=${PHOTO_PAGE_SIZE}&bin=${bin}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
    [base, bin],
  );

  /** Loads again from the start, as many photos as are shown now (at least one page). */
  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    setRefreshing(true);
    const want = Math.max(shown.current, PHOTO_PAGE_SIZE);
    const summary = api<PhotoCountsResponse>(`${base}/summary`);
    const collected: Photo[] = [];
    let cursor: string | null = null;
    let ok = true;
    if (listRows)
      do {
        const res = await page(cursor);
        if (!res.ok) {
          ok = false;
          break;
        }
        collected.push(...res.data.photos);
        cursor = res.data.nextCursor;
      } while (cursor && collected.length < want);
    const counted = await summary;
    if (mine !== generation.current) return;
    setRefreshing(false);
    if (counted.ok) setCounts(counted.data.counts);
    if (!ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    shown.current = collected.length;
    setRows(collected);
    setNextCursor(cursor);
  }, [base, page, listRows]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    const mine = generation.current;
    const res = await page(nextCursor);
    setLoadingMore(false);
    if (mine !== generation.current || !res.ok) return;
    setRows((current) => {
      const merged = [...(current ?? []), ...res.data.photos];
      shown.current = merged.length;
      return merged;
    });
    setNextCursor(res.data.nextCursor);
  }, [page, nextCursor]);

  // A new job or the bin toggled: start from the first page.
  useEffect(() => {
    shown.current = 0;
    setRows(null);
    void refresh();
  }, [refresh]);

  // Keep checking while previews are being made or an upload runs.
  const processing = (counts?.processing ?? 0) > 0;
  const last = useRef<string>("");
  useEffect(() => {
    if (!processing && !busy) return;
    const timer = setInterval(async () => {
      const summary = await api<PhotoCountsResponse>(`${base}/summary`);
      if (!summary.ok) return;
      const key = JSON.stringify(summary.data.counts);
      if (key === last.current) return;
      last.current = key;
      setCounts(summary.data.counts);
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [processing, busy, base, refresh]);

  return { rows, counts, failed, nextCursor, loadingMore, refreshing, reload: refresh, loadMore };
}
