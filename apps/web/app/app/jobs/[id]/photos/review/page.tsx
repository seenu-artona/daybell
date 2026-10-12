"use client";

import {
  type CardPhotosUndoneResponse,
  type MoveTarget,
  PHOTO_CONFLICTS,
  type PhotosConfirmedResponse,
  type PhotosMovedResponse,
  TAGGING_CONFLICTS,
  type TaggedPhoto,
  type TaggingSummary,
  type TaggingSummaryResponse,
} from "@daybell/api";
import { MAX_PHOTOS_PER_BIN_REQUEST, MAX_PHOTOS_PER_MOVE } from "@daybell/core";
import { Banner, Button, Card } from "@daybell/ui";
import { CheckCheck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { useJob } from "../../job-context";
import { JobSection } from "../../job-section";
import { PhotosViews } from "../photos-views";
import { Albums } from "./albums";
import { BlankCards } from "./blank-cards";
import { MoveDialog } from "./move-dialog";
import { NoPhotos } from "./no-photos";
import { DROP_TARGET, PhotoStrip, useDropTarget } from "./photo-strip";
import {
  ReviewContext,
  type ReviewContextValue,
  usePlacePhotos,
  useReview,
} from "./review-context";
import { reconcileChecked } from "./selection";

/** How often the review checks for photos still being processed or tagged. */
const POLL_MS = 4000;

const CONFLICT_KEYS = Object.fromEntries(
  Object.entries(TAGGING_CONFLICTS).map(([key, value]) => [value, key]),
) as Record<string, keyof typeof TAGGING_CONFLICTS>;
const PHOTO_CONFLICT_KEYS = Object.fromEntries(
  Object.entries(PHOTO_CONFLICTS).map(([key, value]) => [value, key]),
) as Record<string, keyof typeof PHOTO_CONFLICTS>;

/**
 * Photos' Review (D32, F16, D143; ADR 0018; Seenu's answers 1-8 and plan answers 1-10): QR tagging, fixed by hand.
 * Flagged photos and Leftovers at the top, then new children from blank cards, then one album per class with each
 * child's photos, and the children with no photos yet at the bottom. Photos move by drag, or select and Move to…
 * (WCAG 2.5.7); flagged photos are confirmed ("Looks right", or "It's a normal photo" for a photo that may be a card)
 * or marked card photos (owners and admins can undo that, answer 12), and junk goes to the bin (plan answer 4). The selection bar offers only what every ticked
 * photo allows (core's reviewActions). Mark reviewed is enabled only when tagging is clean, and says why not in words.
 * Owners, admins and photographers fix tagging; staff look.
 */
export default function ReviewPage() {
  const t = useTranslations("app.photos.review");
  const tp = useTranslations("app.photos");
  const text = useApiText();
  const format = useFormatter();
  const { job, canEditRoster: canEdit, canManage, refreshSummary, setTaggingReviewed } = useJob();
  // Undoing "This is a card photo" is for owners and admins (Seenu, answer 12).
  const canUndoCard = canEdit && canManage;
  const [summary, setSummary] = useState<TaggingSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [checked, setChecked] = useState<ReadonlyMap<string, TaggedPhoto>>(new Map());
  const [moving, setMoving] = useState<string[] | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  // Sections loading again; while any is (or a request is in flight) the selection bar waits.
  const [loads, setLoads] = useState(0);
  const waiting = busy || loads > 0;
  const last = useRef("");
  const base = `/jobs/${encodeURIComponent(job.id)}`;

  const loadSummary = useCallback(async () => {
    const res = await api<TaggingSummaryResponse>(`${base}/tagging`);
    setFailed(!res.ok);
    if (!res.ok) return;
    setSummary(res.data.tagging);
    setTaggingReviewed(res.data.tagging.done);
    // Anything new (a batch tagged, a photo processed) loads every section again.
    const key = JSON.stringify(res.data.tagging, (k, v) => (k.endsWith("Url") ? undefined : v));
    if (last.current && key !== last.current) setVersion((v) => v + 1);
    last.current = key;
  }, [base, setTaggingReviewed]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  // While photos are being processed or tagged, check again every few seconds.
  const pending = summary?.pending ?? false;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void loadSummary(), POLL_MS);
    return () => clearInterval(timer);
  }, [pending, loadSummary]);

  const changed = useCallback(async () => {
    setChecked(new Map());
    setVersion((v) => v + 1);
    await loadSummary();
    refreshSummary();
  }, [loadSummary, refreshSummary]);

  const problem = useCallback(
    (res: { code: string; fields: Record<string, string> }) => {
      const key = CONFLICT_KEYS[res.fields.form ?? ""];
      if (key) return t(`conflicts.${key}`);
      const photoKey = PHOTO_CONFLICT_KEYS[res.fields.form ?? ""];
      return photoKey ? tp(`conflicts.${photoKey}`) : text.error(res.code);
    },
    [t, tp, text],
  );

  const move = useCallback(
    async (photoIds: string[], target: MoveTarget, targetName: string) => {
      setBusy(true);
      setStatus("");
      let moved = 0;
      for (let i = 0; i < photoIds.length; i += MAX_PHOTOS_PER_MOVE) {
        const res = await api<PhotosMovedResponse>(`${base}/photos/move`, {
          method: "POST",
          body: { photoIds: photoIds.slice(i, i + MAX_PHOTOS_PER_MOVE), target },
        });
        if (!res.ok) {
          setStatus(problem(res));
          await changed();
          setBusy(false);
          return;
        }
        moved += res.data.moved;
      }
      setStatus(t("announce.moved", { count: moved, target: targetName }));
      await changed();
      setBusy(false);
    },
    [base, changed, problem, t],
  );

  const reconcile = useCallback(
    (before: readonly TaggedPhoto[] | null, after: readonly TaggedPhoto[]) =>
      setChecked((current) => reconcileChecked(current, before, after)),
    [],
  );
  const trackLoad = useCallback((delta: 1 | -1) => setLoads((n) => Math.max(0, n + delta)), []);

  async function confirm(asCard: boolean) {
    if (waiting) return;
    setBusy(true);
    setStatus("");
    const ids = [...checked.keys()];
    let confirmed = 0;
    for (let i = 0; i < ids.length; i += MAX_PHOTOS_PER_MOVE) {
      const res = await api<PhotosConfirmedResponse>(`${base}/photos/confirm`, {
        method: "POST",
        body: { photoIds: ids.slice(i, i + MAX_PHOTOS_PER_MOVE), asCard },
      });
      if (!res.ok) {
        setStatus(problem(res));
        await changed();
        setBusy(false);
        return;
      }
      confirmed += res.data.confirmed;
    }
    setStatus(t(asCard ? "announce.cards" : "announce.confirmed", { count: confirmed }));
    await changed();
    setBusy(false);
  }

  /** Undo "This is a card photo" (answer 12): back to Flagged, hidden from parents until checked again. */
  async function undoCard() {
    if (waiting) return;
    setBusy(true);
    setStatus("");
    const ids = [...checked.keys()];
    let undone = 0;
    for (let i = 0; i < ids.length; i += MAX_PHOTOS_PER_MOVE) {
      const res = await api<CardPhotosUndoneResponse>(`${base}/tagging/undo-card`, {
        method: "POST",
        body: { photoIds: ids.slice(i, i + MAX_PHOTOS_PER_MOVE) },
      });
      if (!res.ok) {
        setStatus(problem(res));
        await changed();
        setBusy(false);
        return;
      }
      undone += res.data.undone;
    }
    setStatus(t("announce.undoneCards", { count: undone }));
    await changed();
    setBusy(false);
  }

  /** Junk goes to the bin (plan answer 4), from where it can be restored for 30 days; its upload is tagged again. */
  async function moveToBin() {
    if (waiting) return;
    setBusy(true);
    setStatus("");
    const ids = [...checked.keys()];
    let moved = 0;
    for (let i = 0; i < ids.length; i += MAX_PHOTOS_PER_BIN_REQUEST) {
      const res = await api<PhotosMovedResponse>(`${base}/photos/bin`, {
        method: "POST",
        body: { photoIds: ids.slice(i, i + MAX_PHOTOS_PER_BIN_REQUEST) },
      });
      if (!res.ok) {
        setStatus(problem(res));
        await changed();
        setBusy(false);
        return;
      }
      moved += res.data.moved;
    }
    setStatus(tp("binned", { count: moved }));
    await changed();
    setBusy(false);
  }

  async function markReviewed() {
    setBusy(true);
    setStatus("");
    const res = await api(`${base}/tagging/review`, { method: "POST" });
    setStatus(res.ok ? t("announce.reviewed") : problem(res));
    await changed();
    setBusy(false);
  }

  const context = useMemo<ReviewContextValue>(
    () => ({
      jobId: job.id,
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
      openMove: (photoIds) => setMoving(photoIds),
      reconcile,
      trackLoad,
    }),
    [job.id, canEdit, canUndoCard, version, checked, move, reconcile, trackLoad],
  );

  // What every ticked photo allows; "It's a normal photo" when one of them may be a card (Seenu, plan answer 1).
  const selected = [...checked.values()];
  const all = (action: keyof TaggedPhoto["actions"]) => selected.every((p) => p.actions[action]);
  const mayBeCard = selected.some((p) => p.flag === "unreadableCard");
  // Card photos (which only owners and admins can tick, to undo) aren't waiting to be confirmed.
  const someCannotMove = selected.some((p) => !p.actions.move && !p.actions.undoCard);
  // aria-disabled, not disabled, while a request or a reload is in flight: focus stays on the button, screen readers
  // announce it unavailable, and the handlers do nothing meanwhile (WCAG 2.2 AA).
  const wait = { "aria-disabled": waiting || undefined, className: "aria-disabled:opacity-60" };

  const s = summary;
  const subline = s
    ? t("subline", { photos: s.photos, leftovers: s.leftovers, flagged: s.flagged })
    : null;

  return (
    <ReviewContext.Provider value={context}>
      <JobSection
        title={t("title")}
        subline={subline}
        toolbar={
          canEdit && s ? (
            <Button
              variant="white"
              shape="pill"
              disabled={!s.canMarkReviewed || busy}
              aria-describedby="review-state"
              onClick={() => void markReviewed()}
            >
              <CheckCheck aria-hidden="true" />
              {t("markReviewed")}
            </Button>
          ) : null
        }
        below={
          <>
            <PhotosViews jobId={job.id} current="review" />
            {s ? (
              <p id="review-state" className="m-0 text-sm text-muted">
                {s.done && s.reviewedAt
                  ? t("reviewed", {
                      date: format.dateTime(new Date(s.reviewedAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }),
                    })
                  : s.notReviewable
                    ? t(`notReviewable.${s.notReviewable}`)
                    : t("ready")}
              </p>
            ) : null}
            {canEdit ? (
              <p className="m-0 text-caption text-muted">{t("hint")}</p>
            ) : (
              <p className="m-0 text-caption text-muted">{t("readOnly")}</p>
            )}
            {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3). */}
            <p role="status" className="m-0 text-sm font-semibold text-ink empty:-mb-4">
              {status}
            </p>
            {(canEdit || canUndoCard) && checked.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-full bg-surface px-5 py-1">
                <span className="flex-1 text-sm font-semibold text-ink">
                  {t("selection.selected", { count: checked.size })}
                </span>
                {all("move") ? (
                  <Button
                    variant="secondary"
                    shape="pill"
                    {...wait}
                    onClick={() => {
                      if (!waiting) setMoving([...checked.keys()]);
                    }}
                  >
                    {t("selection.moveTo")}
                  </Button>
                ) : null}
                {all("confirm") ? (
                  <Button
                    variant="secondary"
                    shape="pill"
                    {...wait}
                    onClick={() => void confirm(false)}
                  >
                    {mayBeCard ? t("selection.normalPhoto") : t("selection.looksRight")}
                  </Button>
                ) : null}
                {all("markCard") ? (
                  <Button
                    variant="secondary"
                    shape="pill"
                    {...wait}
                    onClick={() => void confirm(true)}
                  >
                    {t("selection.isCard")}
                  </Button>
                ) : null}
                {canUndoCard && all("undoCard") ? (
                  <Button
                    variant="secondary"
                    shape="pill"
                    {...wait}
                    onClick={() => void undoCard()}
                  >
                    {t("selection.undoCard")}
                  </Button>
                ) : null}
                <Button variant="secondary" shape="pill" {...wait} onClick={() => void moveToBin()}>
                  {t("selection.bin")}
                </Button>
                <Button variant="ghost" shape="pill" onClick={() => setChecked(new Map())}>
                  {t("selection.clear")}
                </Button>
              </div>
            ) : null}
            {canEdit && someCannotMove ? (
              <p className="m-0 text-caption text-muted">{t("selection.confirmFirst")}</p>
            ) : null}
            {failed ? <Banner tone="danger" title={t("loadFailed")} /> : null}
          </>
        }
      >
        {!s && !failed ? <p className="m-0 text-muted">{t("loading")}</p> : null}
        {s ? (
          <div className="flex flex-col gap-6">
            {s.photos === 0 ? (
              <p className="m-0 rounded-xl bg-surface px-6 py-10 text-center text-muted">
                {t("empty")}
              </p>
            ) : null}
            {s.pending ? (
              <Banner tone="info" title={t("pending", { count: s.processing })} />
            ) : null}
            {s.flagged > 0 ? <Flagged count={s.flagged} /> : null}
            <Leftovers count={s.leftovers} />
            <BlankCards groups={s.blankCardGroups} onAnnounce={setStatus} onChanged={changed} />
            {s.unlinkedCardPhotos > 0 ? <UnlinkedCards count={s.unlinkedCardPhotos} /> : null}
            <Albums albums={s.albums} />
            <NoPhotos count={s.noPhotos} />
          </div>
        ) : null}
      </JobSection>
      <MoveDialog jobId={job.id} photoIds={moving} onClose={() => setMoving(null)} onMove={move} />
    </ReviewContext.Provider>
  );
}

/** Flagged photos (Seenu, answer 1): hidden from parents until checked. Each says why, and where tagging put it. */
function Flagged({ count }: { count: number }) {
  const t = useTranslations("app.photos.review.flagged");
  const { jobId, version } = useReview();
  const { photos, next, more } = usePlacePhotos(jobId, "place=flagged", version);
  return (
    <Card variant="sheet" asChild>
      <section aria-labelledby="review-flagged" className="flex flex-col gap-3 px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h3 id="review-flagged" className="m-0 text-h3">
            {t("title")}
          </h3>
          <span className="text-sm text-muted">{t("count", { count })}</span>
        </div>
        <p className="m-0 text-sm text-muted">{t("intro")}</p>
        {photos?.length ? <PhotoStrip photos={photos} where={t("where")} /> : null}
        {next ? (
          <Button variant="ghost" className="self-start" onClick={() => void more()}>
            {t("showMore")}
          </Button>
        ) : null}
      </section>
    </Card>
  );
}

/** Leftovers: photos before the first card of an upload. A drop target, so photos can be sent back here too. */
function Leftovers({ count }: { count: number }) {
  const t = useTranslations("app.photos.review.leftovers");
  const { jobId, version, move } = useReview();
  const { photos, next, more } = usePlacePhotos(jobId, "place=leftovers", version);
  const drop = useDropTarget((ids) => void move(ids, { kind: "leftovers" }, t("title")));
  return (
    <Card variant="sheet" asChild>
      <section aria-labelledby="review-leftovers" className="px-5 py-4">
        <div {...drop} className={`flex flex-col gap-3 ${DROP_TARGET}`}>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h3 id="review-leftovers" className="m-0 text-h3">
              {t("title")}
            </h3>
            <span className="text-sm text-muted">{t("count", { count })}</span>
          </div>
          <p className="m-0 text-sm text-muted">{count > 0 ? t("intro") : t("empty")}</p>
          {photos?.length ? <PhotoStrip photos={photos} where={t("title")} /> : null}
          {next ? (
            <Button variant="ghost" className="self-start" onClick={() => void more()}>
              {t("showMore")}
            </Button>
          ) : null}
        </div>
      </section>
    </Card>
  );
}

/**
 * Card photos linked to none of the job's cards (security review 3): photos someone marked card photos in Leftovers or
 * a class set, or another job's card. Kept for the studio, never shown to parents, and listed here so they don't
 * vanish from the review.
 */
function UnlinkedCards({ count }: { count: number }) {
  const t = useTranslations("app.photos.review.unlinkedCards");
  const { jobId, version } = useReview();
  const { photos, next, more } = usePlacePhotos(jobId, "place=unlinkedCards", version);
  return (
    <Card variant="sheet" asChild>
      <section aria-labelledby="review-unlinked-cards" className="flex flex-col gap-3 px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h3 id="review-unlinked-cards" className="m-0 text-h3">
            {t("title")}
          </h3>
          <span className="text-sm text-muted">{t("count", { count })}</span>
        </div>
        <p className="m-0 text-sm text-muted">{t("intro")}</p>
        {photos?.length ? (
          <PhotoStrip photos={photos} where={t("title")} showFlags={false} />
        ) : null}
        {next ? (
          <Button variant="ghost" className="self-start" onClick={() => void more()}>
            {t("showMore")}
          </Button>
        ) : null}
      </section>
    </Card>
  );
}
