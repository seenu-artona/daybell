"use client";

import {
  type MoveTarget,
  type PhotosConfirmedResponse,
  type PhotosMovedResponse,
  TAGGING_CONFLICTS,
  type TaggingSummary,
  type TaggingSummaryResponse,
} from "@daybell/api";
import { MAX_PHOTOS_PER_MOVE } from "@daybell/core";
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

/** How often the review checks for photos still being processed or tagged. */
const POLL_MS = 4000;

const CONFLICT_KEYS = Object.fromEntries(
  Object.entries(TAGGING_CONFLICTS).map(([key, value]) => [value, key]),
) as Record<string, keyof typeof TAGGING_CONFLICTS>;

/**
 * Photos' Review (D32, F16, D143; ADR 0018; Seenu's answers 1-8 and plan answers 1-10): QR tagging, fixed by hand.
 * Flagged photos and Leftovers at the top, then new children from blank cards, then one album per class with each
 * child's photos, and the children with no photos yet at the bottom. Photos move by drag, or select and Move to…
 * (WCAG 2.5.7); flagged photos are confirmed ("Looks right") or marked card photos. Mark reviewed is enabled only when
 * tagging is clean, and says why not in words. Owners, admins and photographers fix tagging; staff look.
 */
export default function ReviewPage() {
  const t = useTranslations("app.photos.review");
  const text = useApiText();
  const format = useFormatter();
  const { job, canEditRoster: canEdit, refreshSummary } = useJob();
  const [summary, setSummary] = useState<TaggingSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [moving, setMoving] = useState<string[] | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const last = useRef("");
  const base = `/jobs/${encodeURIComponent(job.id)}`;

  const loadSummary = useCallback(async () => {
    const res = await api<TaggingSummaryResponse>(`${base}/tagging`);
    setFailed(!res.ok);
    if (!res.ok) return;
    setSummary(res.data.tagging);
    // Anything new (a batch tagged, a photo processed) loads every section again.
    const key = JSON.stringify(res.data.tagging, (k, v) => (k.endsWith("Url") ? undefined : v));
    if (last.current && key !== last.current) setVersion((v) => v + 1);
    last.current = key;
  }, [base]);

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
    setChecked(new Set());
    setVersion((v) => v + 1);
    await loadSummary();
    refreshSummary();
  }, [loadSummary, refreshSummary]);

  const problem = useCallback(
    (res: { code: string; fields: Record<string, string> }) => {
      const key = CONFLICT_KEYS[res.fields.form ?? ""];
      return key ? t(`conflicts.${key}`) : text.error(res.code);
    },
    [t, text],
  );

  const move = useCallback(
    async (photoIds: string[], target: MoveTarget, targetName: string) => {
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
          return;
        }
        moved += res.data.moved;
      }
      setStatus(t("announce.moved", { count: moved, target: targetName }));
      await changed();
    },
    [base, changed, problem, t],
  );

  async function confirm(asCard: boolean) {
    setStatus("");
    const ids = [...checked];
    let confirmed = 0;
    for (let i = 0; i < ids.length; i += MAX_PHOTOS_PER_MOVE) {
      const res = await api<PhotosConfirmedResponse>(`${base}/photos/confirm`, {
        method: "POST",
        body: { photoIds: ids.slice(i, i + MAX_PHOTOS_PER_MOVE), asCard },
      });
      if (!res.ok) {
        setStatus(problem(res));
        await changed();
        return;
      }
      confirmed += res.data.confirmed;
    }
    setStatus(t(asCard ? "announce.cards" : "announce.confirmed", { count: confirmed }));
    await changed();
  }

  async function markReviewed() {
    setBusy(true);
    setStatus("");
    const res = await api(`${base}/tagging/review`, { method: "POST" });
    setBusy(false);
    setStatus(res.ok ? t("announce.reviewed") : problem(res));
    await changed();
  }

  const context = useMemo<ReviewContextValue>(
    () => ({
      jobId: job.id,
      canEdit,
      version,
      checked,
      toggle: (photoId, on) =>
        setChecked((current) => {
          const next = new Set(current);
          if (on) next.add(photoId);
          else next.delete(photoId);
          return next;
        }),
      move,
      openMove: (photoIds) => setMoving(photoIds),
    }),
    [job.id, canEdit, version, checked, move],
  );

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
            {canEdit && checked.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-full bg-surface px-5 py-1">
                <span className="flex-1 text-sm font-semibold text-ink">
                  {t("selection.selected", { count: checked.size })}
                </span>
                <Button variant="secondary" shape="pill" onClick={() => setMoving([...checked])}>
                  {t("selection.moveTo")}
                </Button>
                <Button variant="secondary" shape="pill" onClick={() => void confirm(false)}>
                  {t("selection.looksRight")}
                </Button>
                <Button variant="secondary" shape="pill" onClick={() => void confirm(true)}>
                  {t("selection.isCard")}
                </Button>
                <Button variant="ghost" shape="pill" onClick={() => setChecked(new Set())}>
                  {t("selection.clear")}
                </Button>
              </div>
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
