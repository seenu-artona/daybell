"use client";

import type { TaggingSummary } from "@daybell/api";
import { Banner, Button, Card } from "@daybell/ui";
import { CheckCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLocalDateTime } from "@/app/_components/local-time";
import { api } from "@/lib/client-api";
import { BlankCards } from "./blank-cards";
import { DROP_TARGET, PhotoStrip, useDropTarget } from "./photo-strip";
import { usePlacePhotos, useReview } from "./review-context";
import { type ReviewState, useProblem } from "./review-state";

/**
 * Photos' To review (D156; ADR 0018's Review, ADR 0030): only what the split by QR card could not place. Its counts
 * and Mark reviewed (enabled only when tagging is clean, with the reason in words), then Flagged (each tile says why),
 * Leftovers (photos before an upload's first card), New children from blank cards, and, not blocking anything, Other
 * card photos (ADR 0030, call 7). Photos are given to a person (Give to a person or a drop on People), confirmed (Looks
 * right, never on Leftovers: C9), marked card photos, or binned. Owners, admins and photographers fix tagging; staff look.
 */
export function ToReview({
  summary,
  failed,
  state,
  onAnnounce,
}: {
  summary: TaggingSummary | null;
  failed: boolean;
  state: ReviewState;
  onAnnounce: (text: string) => void;
}) {
  const t = useTranslations("app.photos.review");
  const local = useLocalDateTime();
  const problem = useProblem();
  const { context, busy, whileBusy, changed } = state;
  const { jobId, canEdit } = context;

  async function markReviewed() {
    await whileBusy(async () => {
      onAnnounce("");
      const res = await api(`/jobs/${encodeURIComponent(jobId)}/tagging/review`, {
        method: "POST",
      });
      onAnnounce(res.ok ? t("announce.reviewed") : problem(res));
      await changed();
    });
  }

  if (failed) return <Banner tone="danger" title={t("loadFailed")} />;
  if (!summary) return <p className="m-0 px-6 py-10 text-center text-muted">{t("loading")}</p>;
  const s = summary;
  const clean =
    s.flagged === 0 && s.leftovers === 0 && s.blankCardGroups.length === 0 && s.photos > 0;
  return (
    <div className="flex flex-col gap-6 p-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="m-0 text-body text-muted">
            {t("subline", { photos: s.photos, leftovers: s.leftovers, flagged: s.flagged })}
          </p>
          <p id="review-state" className="m-0 text-sm text-muted">
            {s.done && s.reviewedAt
              ? t("reviewed", {
                  date: local(s.reviewedAt, { dateStyle: "medium", timeStyle: "short" }),
                })
              : s.notReviewable
                ? t(`notReviewable.${s.notReviewable}`)
                : t("ready")}
          </p>
          <p className="m-0 text-caption text-muted">{canEdit ? t("hint") : t("readOnly")}</p>
        </div>
        {canEdit ? (
          <Button
            shape="pill"
            disabled={!s.canMarkReviewed || busy}
            aria-describedby="review-state"
            onClick={() => void markReviewed()}
          >
            <CheckCheck aria-hidden="true" />
            {t("markReviewed")}
          </Button>
        ) : null}
      </div>
      {s.photos === 0 ? <p className="m-0 text-center text-muted">{t("empty")}</p> : null}
      {s.pending ? <Banner tone="info" title={t("pending", { count: s.processing })} /> : null}
      {clean && !s.pending ? <p className="m-0 text-muted">{t("clean")}</p> : null}
      {s.flagged > 0 ? <Flagged count={s.flagged} /> : null}
      {s.leftovers > 0 ? <Leftovers count={s.leftovers} /> : null}
      <BlankCards groups={s.blankCardGroups} onAnnounce={onAnnounce} onChanged={changed} />
      {s.unlinkedCardPhotos > 0 ? <UnlinkedCards count={s.unlinkedCardPhotos} /> : null}
    </div>
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
          <p className="m-0 text-sm text-muted">{t("intro")}</p>
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
 * Card photos linked to none of the job's cards (security review 3): photos someone marked card photos in Leftovers, or
 * another job's card. Kept for the studio, never shown to parents; listed here so they don't vanish and owners and
 * admins can undo a mark (ADR 0030, call 7). They don't block Mark reviewed.
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
