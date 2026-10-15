"use client";

import {
  type BlankCardGroup,
  type Child,
  type ClassesResponse,
  QR_CARD_CONFLICTS,
  TAGGING_CONFLICTS,
} from "@daybell/api";
import { Button, Card, Field } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { PhotoStrip } from "./photo-strip";
import { allPlacePhotos, usePlacePhotos, useReview } from "./review-context";

/**
 * New children from blank cards (Seenu, answer 2; plan answer 6): for each blank card in the photos, the card's photo,
 * the photos waiting for its child, and a form to name the child (first and last name, one of the job's classes). The
 * child joins the roster with the card's own access code. For a child already on the roster, "Give photos to an
 * existing child" opens Give to a person with every one of the card's photos (all pages, code review S4), and the
 * card's code stays unused. Part of Photos' To review (ADR 0030).
 */
export function BlankCards({
  groups,
  onAnnounce,
  onChanged,
}: {
  groups: readonly BlankCardGroup[];
  onAnnounce: (text: string) => void;
  onChanged: () => void;
}) {
  const t = useTranslations("app.photos.review.blankCards");
  const { jobId } = useReview();
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let live = true;
    void api<ClassesResponse>(`/jobs/${encodeURIComponent(jobId)}/classes`).then((res) => {
      if (live && res.ok) setClasses(res.data.classes);
    });
    return () => {
      live = false;
    };
  }, [jobId]);
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby="review-blank-cards" className="flex flex-col gap-3">
      <div>
        <h3 id="review-blank-cards" className="m-0 text-h3">
          {t("title")}
        </h3>
        <p className="m-0 text-sm text-muted">{t("intro")}</p>
      </div>
      {groups.map((g, i) => (
        <BlankCard
          key={g.cardId}
          group={g}
          n={i + 1}
          classes={classes}
          onAnnounce={onAnnounce}
          onChanged={onChanged}
        />
      ))}
    </section>
  );
}

function BlankCard({
  group,
  n,
  classes,
  onAnnounce,
  onChanged,
}: {
  group: BlankCardGroup;
  n: number;
  classes: readonly { id: string; name: string }[];
  onAnnounce: (text: string) => void;
  onChanged: () => void;
}) {
  const t = useTranslations("app.photos.review.blankCards");
  const text = useApiText();
  const { jobId, canEdit, version, openGive } = useReview();
  const where = t("card", { n });
  const query = `place=blankCard&id=${encodeURIComponent(group.cardId)}`;
  const { photos } = usePlacePhotos(jobId, query, version);
  const waiting = (photos ?? []).filter((p) => p.place === "blankCard");
  const [gathering, setGathering] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [classChoice, setClassChoice] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const classId = useId();

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem("");
    const res = await api<{ child: Child }>(
      `/jobs/${encodeURIComponent(jobId)}/qr-cards/${encodeURIComponent(group.cardId)}/child`,
      { method: "POST", body: { firstName: first, lastName: last, classId: classChoice || null } },
    );
    setBusy(false);
    if (res.ok) {
      setErrors({});
      onAnnounce(t("created", { first: res.data.child.firstName, last: res.data.child.lastName }));
      onChanged();
      return;
    }
    setErrors(res.fields);
    if (res.fields.form === TAGGING_CONFLICTS.cardClaimed) setProblem(t("claimed"));
    else if (res.fields.form === QR_CARD_CONFLICTS.codesUnreadable) setProblem(t("unreadable"));
    else if (res.code !== "invalid_input" || res.fields.form) setProblem(text.error(res.code));
  }

  /** Every photo waiting for this card's child, from every page, that can move (the rest are confirmed first). */
  async function giveToExisting() {
    setGathering(true);
    setProblem("");
    const all = await allPlacePhotos(jobId, query);
    setGathering(false);
    if (!all) {
      setProblem(text.error("internal"));
      return;
    }
    const ids = all.filter((p) => p.place === "blankCard" && p.actions.move).map((p) => p.id);
    if (ids.length) openGive(ids);
  }

  const fieldError = (key: string) => text.field(errors[key]);

  return (
    <Card variant="sheet" asChild>
      <section aria-label={where} className="flex flex-col gap-3 px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h4 className="m-0 text-title-sm font-bold">{where}</h4>
          <span className="text-sm text-muted">{t("photos", { count: group.photos })}</span>
        </div>
        <div className="flex flex-wrap items-start gap-4">
          {group.cardPhotoUrl ? (
            // biome-ignore lint/performance/noImgElement: signed, short-lived storage URLs; no image optimiser in between (D113).
            <img
              src={group.cardPhotoUrl}
              alt={t("cardPhotoAlt", { n })}
              className="size-28 rounded-lg object-cover"
            />
          ) : null}
          {waiting.length ? (
            <div className="min-w-0 flex-1">
              <PhotoStrip photos={waiting} where={where} />
            </div>
          ) : null}
        </div>
        {canEdit ? (
          <form onSubmit={create} className="flex flex-col gap-3" noValidate>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
              <Field
                label={t("firstName")}
                value={first}
                autoComplete="off"
                maxLength={60}
                required
                onChange={(e) => setFirst(e.target.value)}
                {...(fieldError("firstName") ? { error: fieldError("firstName") } : {})}
              />
              <Field
                label={t("lastName")}
                value={last}
                autoComplete="off"
                maxLength={60}
                required
                onChange={(e) => setLast(e.target.value)}
                {...(fieldError("lastName") ? { error: fieldError("lastName") } : {})}
              />
              <div className="flex flex-col gap-1.5">
                <label htmlFor={classId} className="text-label text-ink">
                  {t("class")}
                </label>
                <select
                  id={classId}
                  value={classChoice}
                  onChange={(e) => setClassChoice(e.target.value)}
                  className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <option value="">{t("noClass")}</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {problem ? (
              <p role="alert" className="m-0 text-sm text-danger">
                {problem}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy} aria-busy={busy}>
                {t("create")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={group.photos === 0 || gathering}
                aria-busy={gathering}
                onClick={() => void giveToExisting()}
              >
                {t("existing")}
              </Button>
            </div>
          </form>
        ) : null}
      </section>
    </Card>
  );
}
