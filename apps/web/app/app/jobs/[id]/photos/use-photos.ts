"use client";

import type { Photo, PhotoCounts, PhotoCountsResponse, PhotosResponse } from "@daybell/api";
import { PHOTO_PAGE_SIZE } from "@daybell/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";

/** How often counts are checked while previews are being made. */
const POLL_MS = 4000;

/**
 * A job's photos (or its bin) for the Photos tab, a page of 200 at a time in tagging order, and the job's counts.
 * While photos are processing (or an upload runs), the counts are checked every few seconds and the first page is
 * loaded again when they change, so new previews appear.
 */
export function usePhotos(jobId: string, bin: boolean, busy: boolean) {
  const [rows, setRows] = useState<Photo[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState<PhotoCounts | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const generation = useRef(0);
  const base = `/jobs/${encodeURIComponent(jobId)}/photos`;

  const reload = useCallback(async () => {
    const mine = ++generation.current;
    const [page, summary] = await Promise.all([
      api<PhotosResponse>(`${base}?limit=${PHOTO_PAGE_SIZE}&bin=${bin}`),
      api<PhotoCountsResponse>(`${base}/summary`),
    ]);
    if (mine !== generation.current) return;
    if (summary.ok) setCounts(summary.data.counts);
    if (!page.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setRows(page.data.photos);
    setNextCursor(page.data.nextCursor);
  }, [base, bin]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    const mine = generation.current;
    const page = await api<PhotosResponse>(
      `${base}?limit=${PHOTO_PAGE_SIZE}&bin=${bin}&cursor=${encodeURIComponent(nextCursor)}`,
    );
    setLoadingMore(false);
    if (mine !== generation.current || !page.ok) return;
    setRows((current) => [...(current ?? []), ...page.data.photos]);
    setNextCursor(page.data.nextCursor);
  }, [base, bin, nextCursor]);

  useEffect(() => {
    setRows(null);
    void reload();
  }, [reload]);

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
      void reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [processing, busy, base, reload]);

  return { rows, counts, failed, nextCursor, loadingMore, reload, loadMore };
}
