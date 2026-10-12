"use client";

import type { MoveTarget, TaggedPhoto, TaggedPhotosResponse } from "@daybell/api";
import { PHOTO_PAGE_SIZE } from "@daybell/core";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { type ApiResult, api } from "@/lib/client-api";

/** The drag-and-drop payload type: photo ids only, never names (D96). */
export const DRAG_TYPE = "application/x-daybell-photos";

export interface ReviewContextValue {
  jobId: string;
  /** Owners, admins and photographers fix tagging; staff only look (plan answer 10). */
  canEdit: boolean;
  /** Owners and admins can also undo "This is a card photo" (Seenu, answer 12). */
  canUndoCard: boolean;
  /** Goes up after every change, so every section loads again. */
  version: number;
  /** The ticked photos, with what each allows (the selection bar offers what every one of them allows). */
  checked: ReadonlyMap<string, TaggedPhoto>;
  toggle: (photo: TaggedPhoto, on: boolean) => void;
  /** Moves photos (from a drop, or the Move to… dialog) and announces the result. */
  move: (photoIds: string[], target: MoveTarget, targetName: string) => Promise<void>;
  /** Opens Move to… for these photos (the non-drag way, WCAG 2.5.7). */
  openMove: (photoIds: string[]) => void;
  /** A section's photos loaded again: drop ticked photos that left it, refresh the rest (reconcileChecked). */
  reconcile: (before: readonly TaggedPhoto[] | null, after: readonly TaggedPhoto[]) => void;
  /** A section starts (+1) or ends (-1) loading; the selection bar waits while any is loading. */
  trackLoad: (delta: 1 | -1) => void;
}

export const ReviewContext = createContext<ReviewContextValue | null>(null);

export function useReview(): ReviewContextValue {
  const value = useContext(ReviewContext);
  if (!value) throw new Error("useReview must be used inside the review page");
  return value;
}

/**
 * The photos to move when a tile is dragged: every ticked photo that can move if it is one of them, else just it. A
 * photo that may be a card is confirmed before it moves (code review M1), so it never rides along.
 */
export function dragIds(photoId: string, checked: ReadonlyMap<string, TaggedPhoto>): string[] {
  return checked.has(photoId)
    ? [...checked.values()].filter((p) => p.actions.move).map((p) => p.id)
    : [photoId];
}

/** Every page of a place's photos (up to 500 a page), for actions on all of them, e.g. a blank card's photos. */
export async function allPlacePhotos(jobId: string, query: string): Promise<TaggedPhoto[] | null> {
  const base = `/jobs/${encodeURIComponent(jobId)}/tagging/photos?${query}&limit=500`;
  const photos: TaggedPhoto[] = [];
  let cursor: string | null = null;
  do {
    const res: ApiResult<TaggedPhotosResponse> = await api<TaggedPhotosResponse>(
      cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base,
    );
    if (!res.ok) return null;
    photos.push(...res.data.photos);
    cursor = res.data.nextCursor;
  } while (cursor);
  return photos;
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
 * Keeps the ticked photos in step with a section's photos each time they load (so the selection bar never offers
 * actions from old data). `source` names what the photos are; when it changes, nothing is dropped.
 */
export function useReconcileSelection(photos: readonly TaggedPhoto[] | null, source = "") {
  const reconcile = useContext(ReviewContext)?.reconcile;
  const last = useRef<{ photos: readonly TaggedPhoto[]; source: string } | null>(null);
  useEffect(() => {
    if (!photos || !reconcile) return;
    const before = last.current?.source === source ? last.current.photos : null;
    last.current = { photos, source };
    reconcile(before, photos);
  }, [photos, source, reconcile]);
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
  const trackLoad = useContext(ReviewContext)?.trackLoad;
  const base = query
    ? `/jobs/${encodeURIComponent(jobId)}/tagging/photos?${query}&limit=${pageSize}`
    : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the reload signal.
  useEffect(() => {
    if (!base) return;
    let live = true;
    let loading = true;
    trackLoad?.(1);
    const done = () => {
      if (loading) trackLoad?.(-1);
      loading = false;
    };
    void api<TaggedPhotosResponse>(base).then((res) => {
      if (!live) return;
      done();
      setFailed(!res.ok);
      if (res.ok) {
        setPhotos(res.data.photos);
        setNext(res.data.nextCursor);
      }
    });
    return () => {
      live = false;
      done();
    };
  }, [base, version, trackLoad]);

  useReconcileSelection(photos, base ?? "");

  const more = useCallback(async () => {
    if (!base || !next) return;
    const res = await api<TaggedPhotosResponse>(`${base}&cursor=${encodeURIComponent(next)}`);
    if (!res.ok) return;
    setPhotos((current) => [...(current ?? []), ...res.data.photos]);
    setNext(res.data.nextCursor);
  }, [base, next]);

  return { photos, next, failed, more };
}
