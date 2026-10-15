"use client";

import type { PhotoPeopleResponse, PhotoPerson } from "@daybell/api";
import { cardFirst, PEOPLE_PAGE_SIZE, PERSON_STRIP_PHOTOS } from "@daybell/core";
import { Banner, Button } from "@daybell/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { tabHref } from "../tabs";
import { DROP_TARGET, PhotoStrip, useDropTarget } from "./photo-strip";
import { usePlacePhotos, useReconcileSelection, useReview } from "./review-context";

/**
 * Photos' People view (D156, C15): one folded line per person with photos, by last name, 50 at a time with Show more.
 * Each line: the person's name, a link to their record in Subjects; how many photos they have; their first card photo
 * leading the strip (outlined, with a QR icon and the words "QR card"), then their photos in shot order; Show all
 * (aria-expanded) when there are more. A line takes dropped photos (a person's photos only), as Give to a person does.
 * With a group, only its members. Loaded again whenever the review changes; ids only in the URL.
 */
export function PeopleLines({ groupId, onEmpty }: { groupId: string | null; onEmpty?: string }) {
  const t = useTranslations("app.photos.people");
  const { jobId, version, startLoad } = useReview();
  const [people, setPeople] = useState<PhotoPerson[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const shown = useRef(0);
  const base = `/jobs/${encodeURIComponent(jobId)}/photos/people?limit=${PEOPLE_PAGE_SIZE}${
    groupId ? `&groupId=${encodeURIComponent(groupId)}` : ""
  }`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the reload signal.
  useEffect(() => {
    let live = true;
    const end = startLoad();
    // As many people as are shown now, so a reload keeps the place.
    const want = Math.max(shown.current, PEOPLE_PAGE_SIZE);
    void (async () => {
      const collected: PhotoPerson[] = [];
      let cursor: string | null = null;
      let count = 0;
      do {
        const res: Awaited<ReturnType<typeof api<PhotoPeopleResponse>>> =
          await api<PhotoPeopleResponse>(
            cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base,
          );
        if (!live) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        collected.push(...res.data.people);
        cursor = res.data.nextCursor;
        count = res.data.total;
      } while (cursor && collected.length < want);
      setFailed(false);
      shown.current = collected.length;
      setPeople(collected);
      setNext(cursor);
      setTotal(count);
    })().finally(end);
    return () => {
      live = false;
      end();
    };
  }, [base, version, startLoad]);

  const more = useCallback(async () => {
    if (!next) return;
    setLoadingMore(true);
    const res = await api<PhotoPeopleResponse>(`${base}&cursor=${encodeURIComponent(next)}`);
    setLoadingMore(false);
    if (!res.ok) return;
    setPeople((current) => {
      const merged = [...(current ?? []), ...res.data.people];
      shown.current = merged.length;
      return merged;
    });
    setNext(res.data.nextCursor);
  }, [base, next]);

  if (failed) return <Banner tone="danger" title={t("loadFailed")} className="m-5" />;
  if (!people) return <p className="m-0 px-6 py-10 text-center text-muted">{t("loading")}</p>;
  if (people.length === 0)
    return (
      <p className="m-0 px-6 py-10 text-center text-muted">
        {groupId ? t("emptyGroup") : (onEmpty ?? t("empty"))}
      </p>
    );
  return (
    <div className="flex flex-col">
      <ul aria-label={t("label")} aria-busy={loadingMore} className="m-0 list-none p-0">
        {people.map((person) => (
          <PersonLine key={person.id} person={person} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-3 text-body text-muted">
        <span className="flex-1">{t("footer", { shown: people.length, total })}</span>
        {next ? (
          <Button
            variant="secondary"
            shape="pill"
            disabled={loadingMore}
            onClick={() => void more()}
          >
            {t("showMore")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PersonLine({ person }: { person: PhotoPerson }) {
  const t = useTranslations("app.photos.people");
  const { jobId, version, move } = useReview();
  const [all, setAll] = useState(false);
  const name = t("name", { first: person.firstName, last: person.lastName });
  const drop = useDropTarget((ids) => void move(ids, { kind: "child", childId: person.id }, name));
  // Show all reads every page of 500 (card photos included) and leads with the first card photo again.
  const everything = usePlacePhotos(
    jobId,
    all ? `place=child&id=${encodeURIComponent(person.id)}` : null,
    version,
    500,
  );
  const photos = all && everything.photos ? cardFirst(everything.photos) : person.strip;
  // The strip comes with the line: keep ticked photos in step when it loads again (the full list does this itself).
  useReconcileSelection(all ? null : person.strip, "strip");
  const count = person.photos + person.cardPhotos;
  const hidden = person.strip.length >= PERSON_STRIP_PHOTOS && person.strip.length < count;
  const nameId = `person-line-${person.id}`;
  return (
    <li aria-labelledby={nameId} className="border-b border-line px-6 py-4 last:border-b-0">
      <div {...drop} className={`flex flex-col gap-2 ${DROP_TARGET}`}>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <Link
            id={nameId}
            href={`${tabHref(jobId, "people")}?child=${encodeURIComponent(person.id)}`}
            className="inline-flex min-h-11 items-center rounded-md text-title-sm font-bold text-ink no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {name}
          </Link>
          <span className="text-caption text-muted">{t("photos", { count: person.photos })}</span>
        </div>
        {photos.length ? <PhotoStrip photos={photos} where={name} leadCard /> : null}
        {all && everything.next ? (
          <Button variant="ghost" className="self-start" onClick={() => void everything.more()}>
            {t("showMorePhotos")}
          </Button>
        ) : null}
        {hidden ? (
          <Button
            variant="ghost"
            className="self-start"
            aria-expanded={all}
            onClick={() => setAll(!all)}
          >
            {all ? t("showFewer") : t("showAll", { count })}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
