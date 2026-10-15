"use client";

import {
  type CardPhotosUndoneResponse,
  GROUP_CONFLICTS,
  type MoveTarget,
  PHOTO_CONFLICTS,
  type PhotosConfirmedResponse,
  type PhotosMovedResponse,
  TAGGING_CONFLICTS,
  type TaggedPhoto,
} from "@daybell/api";
import { MAX_PHOTOS_PER_BIN_REQUEST, MAX_PHOTOS_PER_MOVE } from "@daybell/core";
import { Button } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { createLoadTracker } from "./load-tracker";
import type { ReviewContextValue } from "./review-context";
import { reconcileChecked } from "./selection";

const keysOf = <T extends Record<string, string>>(conflicts: T) =>
  Object.fromEntries(Object.entries(conflicts).map(([key, value]) => [value, key])) as Record<
    string,
    keyof T
  >;
const TAGGING_KEYS = keysOf(TAGGING_CONFLICTS);
const PHOTO_KEYS = keysOf(PHOTO_CONFLICTS);
const GROUP_KEYS = keysOf(GROUP_CONFLICTS);

/** A refusal in the screen's words: tagging's, the bin's or a group's, else the API's general words. */
export function useProblem() {
  const t = useTranslations("app.photos.review");
  const tp = useTranslations("app.photos");
  const tg = useTranslations("app.photos.groups");
  const text = useApiText();
  return useCallback(
    (res: { code: string; fields: Record<string, string> }) => {
      const form = res.fields.form ?? "";
      const tagging = TAGGING_KEYS[form];
      if (tagging) return t(`conflicts.${tagging}`);
      const photo = PHOTO_KEYS[form];
      if (photo) return tp(`conflicts.${photo}`);
      const group = GROUP_KEYS[form];
      if (group) return tg(`conflicts.${group}`);
      return text.error(res.code);
    },
    [t, tp, tg, text],
  );
}

/**
 * What People and To review share (ADR 0018, 0030): the ticked photos, the busy state, and the actions on photos, each
 * sent 500 at a time and announced politely. `onChanged` reloads what the page shows after any change.
 */
export function useReviewState({
  jobId,
  canEdit,
  canUndoCard,
  openPhoto,
  onChanged,
}: {
  jobId: string;
  canEdit: boolean;
  canUndoCard: boolean;
  openPhoto: (photoId: string, alt: string) => void;
  onChanged: () => Promise<void> | void;
}) {
  const t = useTranslations("app.photos.review");
  const tp = useTranslations("app.photos");
  const problem = useProblem();
  const [version, setVersion] = useState(0);
  const [checked, setChecked] = useState<ReadonlyMap<string, TaggedPhoto>>(new Map());
  const [giving, setGiving] = useState<string[] | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  // Sections loading again (load-tracker.ts); while any is, or a request is in flight, the selection bar waits.
  const [loading, setLoading] = useState(false);
  const [tracker] = useState(() => createLoadTracker(setLoading));
  const waiting = busy || loading;
  const base = `/jobs/${encodeURIComponent(jobId)}`;

  // Stable, so a page can poll with it (a group's page while its photos are processed).
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const changed = useCallback(async () => {
    setChecked(new Map());
    setVersion((v) => v + 1);
    await onChanged();
  }, [onChanged]);

  /** Runs a request with the screen busy, and always ends busy, even if it throws. */
  const whileBusy = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }, []);

  /** Sends ids 500 at a time; stops at the first refusal, says why and reloads. */
  const inChunks = useCallback(
    async <T,>(
      ids: string[],
      size: number,
      send: (
        chunk: string[],
      ) => Promise<
        { ok: true; data: T } | { ok: false; code: string; fields: Record<string, string> }
      >,
      count: (data: T) => number,
    ): Promise<number | null> => {
      let done = 0;
      for (let i = 0; i < ids.length; i += size) {
        const res = await send(ids.slice(i, i + size));
        if (!res.ok) {
          setStatus(problem(res));
          await changed();
          return null;
        }
        done += count(res.data);
      }
      return done;
    },
    [problem, changed],
  );

  const move = useCallback(
    async (photoIds: string[], target: MoveTarget, targetName: string) => {
      await whileBusy(async () => {
        setStatus("");
        const moved = await inChunks(
          photoIds,
          MAX_PHOTOS_PER_MOVE,
          (chunk) =>
            api<PhotosMovedResponse>(`${base}/photos/move`, {
              method: "POST",
              body: { photoIds: chunk, target },
            }),
          (d) => d.moved,
        );
        if (moved === null) return;
        setStatus(t("announce.moved", { count: moved, target: targetName }));
        await changed();
      });
    },
    [base, changed, inChunks, t, whileBusy],
  );

  const confirm = useCallback(
    async (asCard: boolean) => {
      if (waiting) return;
      await whileBusy(async () => {
        setStatus("");
        const done = await inChunks(
          [...checked.keys()],
          MAX_PHOTOS_PER_MOVE,
          (chunk) =>
            api<PhotosConfirmedResponse>(`${base}/photos/confirm`, {
              method: "POST",
              body: { photoIds: chunk, asCard },
            }),
          (d) => d.confirmed,
        );
        if (done === null) return;
        setStatus(t(asCard ? "announce.cards" : "announce.confirmed", { count: done }));
        await changed();
      });
    },
    [waiting, whileBusy, inChunks, checked, base, t, changed],
  );

  /** Undo "This is a card photo" (answer 12): back to Flagged, hidden from parents until checked again. */
  const undoCard = useCallback(async () => {
    if (waiting) return;
    await whileBusy(async () => {
      setStatus("");
      const done = await inChunks(
        [...checked.keys()],
        MAX_PHOTOS_PER_MOVE,
        (chunk) =>
          api<CardPhotosUndoneResponse>(`${base}/tagging/undo-card`, {
            method: "POST",
            body: { photoIds: chunk },
          }),
        (d) => d.undone,
      );
      if (done === null) return;
      setStatus(t("announce.undoneCards", { count: done }));
      await changed();
    });
  }, [waiting, whileBusy, inChunks, checked, base, t, changed]);

  /** Junk goes to the bin (plan answer 4), from where it can be restored for 30 days; its upload is tagged again. */
  const moveToBin = useCallback(
    async (ids: string[] = [...checked.keys()]) => {
      if (waiting) return;
      await whileBusy(async () => {
        setStatus("");
        const done = await inChunks(
          ids,
          MAX_PHOTOS_PER_BIN_REQUEST,
          (chunk) =>
            api<PhotosMovedResponse>(`${base}/photos/bin`, {
              method: "POST",
              body: { photoIds: chunk },
            }),
          (d) => d.moved,
        );
        if (done === null) return;
        setStatus(tp("binned", { count: done }));
        await changed();
      });
    },
    [waiting, whileBusy, inChunks, checked, base, tp, changed],
  );

  const reconcile = useCallback(
    (before: readonly TaggedPhoto[] | null, after: readonly TaggedPhoto[]) =>
      setChecked((current) => reconcileChecked(current, before, after)),
    [],
  );

  const context = useMemo<ReviewContextValue>(
    () => ({
      jobId,
      canEdit,
      canUndoCard,
      version,
      checked,
      toggle: (photo, on) =>
        setChecked((current) => {
          const next = new Map(current);
          if (on) next.set(photo.id, photo);
          else next.delete(photo.id);
          return next;
        }),
      move,
      openGive: (photoIds) => setGiving(photoIds),
      openPhoto,
      reconcile,
      startLoad: tracker.start,
    }),
    [jobId, canEdit, canUndoCard, version, checked, move, openPhoto, reconcile, tracker],
  );

  return {
    context,
    version,
    bump,
    checked,
    clear: () => setChecked(new Map()),
    status,
    setStatus,
    busy,
    waiting,
    whileBusy,
    changed,
    giving,
    setGiving,
    actions: { move, confirm, undoCard, moveToBin },
  };
}

export type ReviewState = ReturnType<typeof useReviewState>;

/**
 * The bar over ticked photos (ADR 0018, 0030): what every ticked photo allows (core's reviewActions). Give to a person
 * (never a group photo, C8), Looks right (or "It's a normal photo" when one may be a card; never on Leftovers, C9),
 * It's a card photo, Not a card photo after all (owners and admins, answer 12), Move to bin, Clear. aria-disabled, not
 * disabled, while a request or a reload is in flight: focus stays put and the handlers do nothing meanwhile.
 */
export function SelectionBar({ state }: { state: ReviewState }) {
  const t = useTranslations("app.photos.review");
  const { context, checked, waiting, actions, setGiving, clear } = state;
  const { canEdit, canUndoCard } = context;
  if (!(canEdit || canUndoCard) || checked.size === 0) return null;
  const selected = [...checked.values()];
  const all = (action: keyof TaggedPhoto["actions"]) => selected.every((p) => p.actions[action]);
  const mayBeCard = selected.some((p) => p.flag === "unreadableCard");
  // Card photos (which only owners and admins can tick, to undo) and group photos aren't waiting to be confirmed.
  const someWaitForConfirm = selected.some(
    (p) => !p.actions.move && !p.actions.undoCard && p.place !== "groupPhoto" && p.actions.confirm,
  );
  const wait = { "aria-disabled": waiting || undefined, className: "aria-disabled:opacity-60" };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-full bg-surface px-5 py-1">
        <span className="flex-1 text-sm font-semibold text-ink">
          {t("selection.selected", { count: checked.size })}
        </span>
        {canEdit && all("move") ? (
          <Button
            variant="secondary"
            shape="pill"
            {...wait}
            onClick={() => {
              if (!waiting) setGiving([...checked.keys()]);
            }}
          >
            {t("selection.giveTo")}
          </Button>
        ) : null}
        {canEdit && all("confirm") ? (
          <Button
            variant="secondary"
            shape="pill"
            {...wait}
            onClick={() => void actions.confirm(false)}
          >
            {mayBeCard ? t("selection.normalPhoto") : t("selection.looksRight")}
          </Button>
        ) : null}
        {canEdit && all("markCard") ? (
          <Button
            variant="secondary"
            shape="pill"
            {...wait}
            onClick={() => void actions.confirm(true)}
          >
            {t("selection.isCard")}
          </Button>
        ) : null}
        {canUndoCard && all("undoCard") ? (
          <Button
            variant="secondary"
            shape="pill"
            {...wait}
            onClick={() => void actions.undoCard()}
          >
            {t("selection.undoCard")}
          </Button>
        ) : null}
        {canEdit ? (
          <Button
            variant="secondary"
            shape="pill"
            {...wait}
            onClick={() => void actions.moveToBin()}
          >
            {t("selection.bin")}
          </Button>
        ) : null}
        <Button variant="ghost" shape="pill" onClick={clear}>
          {t("selection.clear")}
        </Button>
      </div>
      {canEdit && someWaitForConfirm ? (
        <p className="m-0 text-caption text-muted">{t("selection.confirmFirst")}</p>
      ) : null}
    </>
  );
}
