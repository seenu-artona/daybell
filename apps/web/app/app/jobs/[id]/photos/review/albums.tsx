"use client";

import type { TaggingAlbum, TaggingChild, TaggingChildrenResponse } from "@daybell/api";
import { REVIEW_STRIP_PHOTOS } from "@daybell/core";
import { Button, Card } from "@daybell/ui";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";
import { api } from "@/lib/client-api";
import { DROP_TARGET, PhotoStrip, useDropTarget } from "./photo-strip";
import { usePlacePhotos, useReview } from "./review-context";

/**
 * The review's albums (Seenu, answer 5): one per class, then No class. Each opens (a button with aria-expanded) to its
 * Class photo set, then one row per child with their photos. A child's row, and the class's header, take dropped photos.
 */
export function Albums({ albums }: { albums: readonly TaggingAlbum[] }) {
  const t = useTranslations("app.photos.review.albums");
  return (
    <section aria-labelledby="review-albums" className="flex flex-col gap-3">
      <h3 id="review-albums" className="m-0 text-h3">
        {t("title")}
      </h3>
      {albums.length === 0 ? <p className="m-0 text-muted">{t("empty")}</p> : null}
      {albums.map((album) => (
        <Album key={album.groupId ?? "none"} album={album} />
      ))}
    </section>
  );
}

function Album({ album }: { album: TaggingAlbum }) {
  const t = useTranslations("app.photos.review.albums");
  const { jobId, version, move } = useReview();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const nameId = useId();
  const summaryId = useId();
  const name = album.name ?? t("noClass");
  const drop = useDropTarget((ids) =>
    album.groupId
      ? void move(ids, { kind: "classSet", groupId: album.groupId }, t("classPhoto", { name }))
      : undefined,
  );
  return (
    <Card variant="sheet" asChild>
      <section aria-label={name} className="flex flex-col gap-3 px-5 py-3">
        <div {...(album.groupId ? drop : {})} className={DROP_TARGET}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            // The name and the summary, read with a space between them ("Room 4 2 of 3 children with photos").
            aria-labelledby={`${nameId} ${summaryId}`}
            onClick={() => setOpen(!open)}
            className="flex min-h-11 w-full items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <ChevronDown
              className={`size-5 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
              aria-hidden="true"
            />
            <span id={nameId} className="flex-1 text-title-sm font-bold text-ink">
              {name}
            </span>
            <span id={summaryId} className="text-sm text-muted">
              {t("summary", { withPhotos: album.childrenWithPhotos, children: album.children })}
            </span>
          </button>
        </div>
        <div id={panelId} hidden={!open} className="flex flex-col gap-4">
          {open ? (
            <>
              {album.groupId ? (
                <ClassSet jobId={jobId} groupId={album.groupId} name={name} version={version} />
              ) : null}
              <AlbumChildren groupId={album.groupId} />
            </>
          ) : null}
        </div>
      </section>
    </Card>
  );
}

function ClassSet({
  jobId,
  groupId,
  name,
  version,
}: {
  jobId: string;
  groupId: string;
  name: string;
  version: number;
}) {
  const t = useTranslations("app.photos.review.albums");
  const { photos, next, more } = usePlacePhotos(
    jobId,
    `place=classSet&id=${encodeURIComponent(groupId)}`,
    version,
  );
  const where = t("classPhoto", { name });
  return (
    <div className="flex flex-col gap-2">
      <h4 className="m-0 text-sm font-bold text-ink">{t("classPhotos")}</h4>
      {photos && photos.length === 0 ? (
        <p className="m-0 text-caption text-muted">{t("noClassPhotos")}</p>
      ) : null}
      {photos?.length ? <PhotoStrip photos={photos} where={where} /> : null}
      {next ? (
        <Button variant="ghost" className="self-start" onClick={() => void more()}>
          {t("showMorePhotos")}
        </Button>
      ) : null}
    </div>
  );
}

function AlbumChildren({ groupId }: { groupId: string | null }) {
  const t = useTranslations("app.photos.review.albums");
  const { jobId, version } = useReview();
  const [children, setChildren] = useState<TaggingChild[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const base = `/jobs/${encodeURIComponent(jobId)}/tagging/children?${
    groupId ? `groupId=${encodeURIComponent(groupId)}` : "noGroup=true"
  }`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the reload signal.
  useEffect(() => {
    let live = true;
    void api<TaggingChildrenResponse>(base).then((res) => {
      if (!live) return;
      setFailed(!res.ok);
      if (res.ok) {
        setChildren(res.data.children);
        setNext(res.data.nextCursor);
      }
    });
    return () => {
      live = false;
    };
  }, [base, version]);

  const more = useCallback(async () => {
    if (!next) return;
    const res = await api<TaggingChildrenResponse>(`${base}&cursor=${encodeURIComponent(next)}`);
    if (!res.ok) return;
    setChildren((current) => [...(current ?? []), ...res.data.children]);
    setNext(res.data.nextCursor);
  }, [base, next]);

  if (failed) return <p className="m-0 text-danger">{t("loadFailed")}</p>;
  if (!children) return <p className="m-0 text-muted">{t("loading")}</p>;
  if (children.length === 0) return <p className="m-0 text-muted">{t("noChildren")}</p>;
  return (
    <div className="flex flex-col">
      <ul className="m-0 flex list-none flex-col p-0">
        {children.map((child) => (
          <ChildRow key={child.id} child={child} />
        ))}
      </ul>
      {next ? (
        <Button variant="ghost" className="self-start" onClick={() => void more()}>
          {t("showMoreChildren")}
        </Button>
      ) : null}
    </div>
  );
}

function ChildRow({ child }: { child: TaggingChild }) {
  const t = useTranslations("app.photos.review.albums");
  const { jobId, version, move } = useReview();
  const [all, setAll] = useState(false);
  const name = t("childName", { first: child.firstName, last: child.lastName });
  const drop = useDropTarget((ids) => void move(ids, { kind: "child", childId: child.id }, name));
  // "Show all" loads pages of 500 with "Show more" after each (code review nice 4).
  const everything = usePlacePhotos(
    jobId,
    all ? `place=child&id=${encodeURIComponent(child.id)}` : null,
    version,
    500,
  );
  const photos = all && everything.photos ? everything.photos : child.strip;
  // The strip holds card photos too, which child.photos doesn't count: there is more only when the strip is full and
  // shows fewer of the child's own photos than they have (code review nice 5).
  const shownOwn = child.strip.filter((p) => p.place !== "card").length;
  const hidden = child.strip.length >= REVIEW_STRIP_PHOTOS && shownOwn < child.photos;
  return (
    <li className="border-t border-line py-3 first:border-t-0">
      <div {...drop} className={`flex flex-col gap-2 ${DROP_TARGET}`}>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h4 className="m-0 text-sm font-bold text-ink">{name}</h4>
          <span className="text-caption text-muted">
            {t("childPhotos", { count: child.photos })}
          </span>
        </div>
        {photos.length ? <PhotoStrip photos={photos} where={name} /> : null}
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
            {all ? t("showFewer") : t("showAll", { count: child.photos })}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
