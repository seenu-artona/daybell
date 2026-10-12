"use client";

import type { MoveTarget, TaggedPhoto, TaggedPhotosResponse } from "@daybell/api";
import { PHOTO_PAGE_SIZE } from "@daybell/core";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/client-api";

/** The drag-and-drop payload type: photo ids only, never names (D96). */
export const DRAG_TYPE = "application/x-daybell-photos";

export interface ReviewContextValue {
  jobId: string;
  /** Owners, admins and photographers fix tagging; staff only look (plan answer 10). */
  canEdit: boolean;
  /** Goes up after every change, so every section loads again. */
  version: number;
  checked: ReadonlySet<string>;
  toggle: (photoId: string, on: boolean) => void;
  /** Moves photos (from a drop, or the Move to… dialog) and announces the result. */
  move: (photoIds: string[], target: MoveTarget, targetName: string) => Promise<void>;
  /** Opens Move to… for these photos (the non-drag way, WCAG 2.5.7). */
  openMove: (photoIds: string[]) => void;
}

export const ReviewContext = createContext<ReviewContextValue | null>(null);

export function useReview(): ReviewContextValue {
  const value = useContext(ReviewContext);
  if (!value) throw new Error("useReview must be used inside the review page");
  return value;
}

/** The photos to move when a tile is dragged: every ticked photo if it is one of them, else just it. */
export function dragIds(photoId: string, checked: ReadonlySet<string>): string[] {
  return checked.has(photoId) ? [...checked] : [photoId];
}

/** Photo ids from a drop, if it is ours: uuids only, at most 500. */
export function droppedIds(data: string): string[] {
  try {
    const ids = JSON.parse(data) as unknown;
    if (!Array.isArray(ids)) return [];
    return ids
      .filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id))
      .slice(0, 500);
  } catch {
    return [];
  }
}

/**
 * The photos in one place (Leftovers, flagged, a child, a class set, a blank card), a page at a time in tagging order,
 * loaded again whenever the review changes. Ids only in the URL.
 */
export function usePlacePhotos(
  jobId: string,
  query: string | null,
  version: number,
  pageSize = PHOTO_PAGE_SIZE,
) {
  const [photos, setPhotos] = useState<TaggedPhoto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const base = query
    ? `/jobs/${encodeURIComponent(jobId)}/tagging/photos?${query}&limit=${pageSize}`
    : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the reload signal.
  useEffect(() => {
    if (!base) return;
    let live = true;
    void api<TaggedPhotosResponse>(base).then((res) => {
      if (!live) return;
      setFailed(!res.ok);
      if (res.ok) {
        setPhotos(res.data.photos);
        setNext(res.data.nextCursor);
      }
    });
    return () => {
      live = false;
    };
  }, [base, version]);

  const more = useCallback(async () => {
    if (!base || !next) return;
    const res = await api<TaggedPhotosResponse>(`${base}&cursor=${encodeURIComponent(next)}`);
    if (!res.ok) return;
    setPhotos((current) => [...(current ?? []), ...res.data.photos]);
    setNext(res.data.nextCursor);
  }, [base, next]);

  return { photos, next, failed, more };
}
