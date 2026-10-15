"use client";

import type {
  GroupPhotosMovedResponse,
  PhotoGroup,
  PhotosMovedResponse,
  PhotosShownResponse,
} from "@daybell/api";
import { chunk, MAX_GROUP_CHANGE } from "@daybell/core";
import { Banner, Button, Card, iconButtonVariants } from "@daybell/ui";
import { ArrowLeft, Ellipsis, Pencil, Trash2, Upload, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { MENU_ROW, Popover } from "../../../../../popover";
import { JobTabActions, useJob } from "../../../job-context";
import { JobSection } from "../../../job-section";
import { groupHref, groupsHref, tabHref } from "../../../tabs";
import { PhotoPanel } from "../../photo-panel";
import { PhotoStrip, stripTileId } from "../../photo-strip";
import { ReviewContext, usePlacePhotos } from "../../review-context";
import { useProblem, useReviewState } from "../../review-state";
import { useRuns } from "../../runs-store";
import { isActive, UploadSheet, useLeaveWarning } from "../../upload-sheet";
import { usePhotoGroups } from "../../use-photo-groups";
import {
  AlsoShowDialog,
  DeleteGroupDialog,
  GroupNameDialog,
  MembersDialog,
  MoveToGroupDialog,
} from "../group-dialogs";

export default function GroupPageRoute() {
  // useSearchParams (the open photo) needs a Suspense boundary.
  return (
    <Suspense>
      <GroupPage />
    </Suspense>
  );
}

type Open = "rename" | "members" | "delete" | null;

/**
 * One group's page (D156; ADR 0030), or Not in a group (/groups/none: group photos in no group, C2; call 1). Back to
 * Groups, the group's name, Upload group photos and ⋯ (Rename, Add or remove people, Delete); "N members · See them in
 * Subjects" and Add or remove people; then its photos, with a bar over ticked ones: Move to group, Also show in…, Move
 * to bin. Group photos move between groups only by hand, never to a person (C8). A photo opens in the floating panel.
 * Owners, admins and photographers change groups (C11); staff and closed jobs look.
 */
function GroupPage() {
  const t = useTranslations("app.photos.groups");
  const tp = useTranslations("app.photos");
  const router = useRouter();
  const problem = useProblem();
  const { groupId } = useParams<{ groupId: string }>();
  const none = groupId === "none";
  const photoId = useSearchParams().get("photo");
  const { job, canEditRoster, refreshSummary } = useJob();
  const closed = job.status === "closed";
  const canEdit = canEditRoster && !closed;
  const { groups, failed, reload } = usePhotoGroups(job.id);
  const list = groups ?? [];
  const group: PhotoGroup | null = none ? null : (list.find((g) => g.id === groupId) ?? null);
  const gone = !none && groups !== null && group === null;
  const name = none ? t("page.noneTitle") : (group?.name ?? "");
  const here = groupHref(job.id, none ? "none" : groupId);
  const [open, setOpen] = useState<Open>(null);
  const [moving, setMoving] = useState<string[] | null>(null);
  const [showing, setShowing] = useState<string[] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [panelFocus, setPanelFocus] = useState<string | null>(null);
  const opener = useRef<{ id: string; alt: string } | null>(null);
  const [runs, setRuns] = useRuns(job.id);
  const uploading = runs.some(isActive);
  useLeaveWarning(uploading);

  const openPhoto = useCallback(
    (id: string, alt: string) => {
      opener.current = { id, alt };
      setPanelFocus(id);
      router.replace(`${here}?photo=${encodeURIComponent(id)}`, { scroll: false });
    },
    [router, here],
  );
  const review = useReviewState({
    jobId: job.id,
    canEdit,
    canUndoCard: false,
    openPhoto,
    onChanged: async () => {
      await reload();
      refreshSummary();
    },
  });
  const { setStatus, checked, whileBusy, changed } = review;
  const path = none
    ? `/jobs/${encodeURIComponent(job.id)}/groups/none/photos`
    : `/groups/${encodeURIComponent(groupId)}/photos`;
  const photos = usePlacePhotos(job.id, null, review.version, 200, gone ? null : path);

  function closePanel() {
    const back = opener.current?.id ?? photoId;
    router.replace(here, { scroll: false });
    setPanelFocus(null);
    if (back) setTimeout(() => document.getElementById(stripTileId(back))?.focus(), 0);
  }

  /** Move to group: from this group (or no group) to another, 500 at a time (C10). */
  async function moveTo(ids: string[], to: PhotoGroup) {
    await whileBusy(async () => {
      setStatus("");
      let moved = 0;
      for (const part of chunk(ids, MAX_GROUP_CHANGE)) {
        const res = await api<GroupPhotosMovedResponse>(`${path}/move`, {
          method: "POST",
          body: { photoIds: part, toGroupId: to.id },
        });
        if (!res.ok) {
          setStatus(problem(res));
          await changed();
          return;
        }
        moved += res.data.moved;
      }
      setStatus(t("announce.moved", { count: moved, name: to.name }));
      await changed();
    });
  }

  /** Also show in…: links added only, 500 at a time. */
  async function alsoShow(ids: string[], groupIds: string[]) {
    await whileBusy(async () => {
      setStatus("");
      let added = 0;
      for (const part of chunk(ids, MAX_GROUP_CHANGE)) {
        const res = await api<PhotosShownResponse>(
          `/jobs/${encodeURIComponent(job.id)}/photos/also-show`,
          { method: "POST", body: { photoIds: part, groupIds } },
        );
        if (!res.ok) {
          setStatus(problem(res));
          await changed();
          return;
        }
        added += res.data.added;
      }
      setStatus(t("announce.shown", { count: added }));
      await changed();
    });
  }

  async function binOrRestore(action: "bin" | "restore", ids: string[]) {
    await whileBusy(async () => {
      setStatus("");
      const res = await api<PhotosMovedResponse>(
        `/jobs/${encodeURIComponent(job.id)}/photos/${action}`,
        { method: "POST", body: { photoIds: ids } },
      );
      setStatus(
        res.ok
          ? tp(action === "bin" ? "binned" : "restored", { count: res.data.moved })
          : problem(res),
      );
      if (res.ok && photoId && ids.includes(photoId)) closePanel();
      await changed();
    });
  }

  const selected = useMemo(() => [...checked.keys()], [checked]);
  const wait = {
    "aria-disabled": review.waiting || undefined,
    className: "aria-disabled:opacity-60",
  };
  const members = group?.members ?? 0;

  return (
    <ReviewContext.Provider value={review.context}>
      <JobSection
        below={
          <>
            <JobTabActions>
              {canEdit && !none && group ? (
                <Button
                  variant="white"
                  shape="pill"
                  aria-expanded={sheetOpen}
                  onClick={() => setSheetOpen((o) => !o)}
                >
                  <Upload aria-hidden="true" />
                  {t("page.upload")}
                </Button>
              ) : null}
            </JobTabActions>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={groupsHref(job.id)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-muted no-underline hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                {t("page.back")}
              </Link>
              <h2 className="m-0 min-w-0 flex-1 text-h2">{name}</h2>
              {canEdit && group ? (
                <Popover
                  label={t("page.more", { name: group.name })}
                  trigger={<Ellipsis aria-hidden="true" />}
                  triggerClassName={iconButtonVariants({ tone: "canvas" })}
                  panelClassName="w-64"
                >
                  {(close) => (
                    <>
                      <button
                        type="button"
                        className={MENU_ROW}
                        onClick={() => {
                          close();
                          setOpen("rename");
                        }}
                      >
                        <Pencil aria-hidden="true" />
                        {t("rename")}
                      </button>
                      <button
                        type="button"
                        className={MENU_ROW}
                        onClick={() => {
                          close();
                          setOpen("members");
                        }}
                      >
                        <Users aria-hidden="true" />
                        {t("addRemove")}
                      </button>
                      <button
                        type="button"
                        className={`${MENU_ROW} text-danger [&_svg]:text-danger`}
                        onClick={() => {
                          close();
                          setOpen("delete");
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                        {t("delete")}
                      </button>
                    </>
                  )}
                </Popover>
              ) : null}
            </div>
            {closed ? <Banner tone="info" title={t("closed")} /> : null}
            {gone ? <Banner tone="warning" title={t("page.notFound")} /> : null}
            {failed ? <Banner tone="danger" title={t("loadFailed")} /> : null}
            {none ? <p className="m-0 text-sm text-muted">{t("page.noneIntro")}</p> : null}
            {group ? (
              <div className="flex flex-wrap items-center gap-3 text-body text-muted">
                <span>{t("page.members", { count: members })}</span>
                <span aria-hidden="true">·</span>
                <Link
                  href={`${tabHref(job.id, "people")}?group=${encodeURIComponent(group.id)}`}
                  className="inline-flex min-h-11 items-center font-semibold text-ink underline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {t("page.seeInSubjects")}
                </Link>
                {canEdit ? (
                  <Button variant="secondary" shape="pill" onClick={() => setOpen("members")}>
                    <Users aria-hidden="true" />
                    {t("addRemove")}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {(sheetOpen || uploading) && canEdit && group ? (
              <UploadSheet
                jobId={job.id}
                runs={runs}
                setRuns={setRuns}
                groups={groups}
                presetGroupId={group.id}
                onClose={() => setSheetOpen(false)}
                onUploaded={() => void changed()}
              />
            ) : null}
            {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3). */}
            <p role="status" className="m-0 text-sm font-semibold text-ink empty:-mb-4">
              {review.status}
            </p>
            {canEdit && selected.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-full bg-surface px-5 py-1">
                <span className="flex-1 text-sm font-semibold text-ink">
                  {t("page.selection.selected", { count: selected.length })}
                </span>
                <Button
                  variant="secondary"
                  shape="pill"
                  {...wait}
                  onClick={() => {
                    if (!review.waiting) setMoving(selected);
                  }}
                >
                  {t("page.selection.moveTo")}
                </Button>
                <Button
                  variant="secondary"
                  shape="pill"
                  {...wait}
                  onClick={() => {
                    if (!review.waiting) setShowing(selected);
                  }}
                >
                  {t("page.selection.alsoShow")}
                </Button>
                <Button
                  variant="secondary"
                  shape="pill"
                  {...wait}
                  onClick={() => void review.actions.moveToBin(selected)}
                >
                  {t("page.selection.bin")}
                </Button>
                <Button variant="ghost" shape="pill" onClick={review.clear}>
                  {t("page.selection.clear")}
                </Button>
              </div>
            ) : null}
          </>
        }
        panel={
          photoId ? (
            <PhotoPanel
              key={photoId}
              photoId={photoId}
              alt={opener.current?.id === photoId ? opener.current.alt : null}
              canEdit={canEdit}
              focusKey={panelFocus === photoId ? panelFocus : null}
              version={review.version}
              onClose={closePanel}
              onBin={() => binOrRestore("bin", [photoId])}
              onRestore={() => binOrRestore("restore", [photoId])}
              onRetry={async () => {
                const res = await api(`/photos/${encodeURIComponent(photoId)}/retry`, {
                  method: "POST",
                });
                setStatus(res.ok ? tp("retried") : problem(res));
                await changed();
              }}
            />
          ) : null
        }
      >
        {gone ? null : (
          <Card variant="sheet" asChild>
            <section aria-label={t("page.photos")} className="flex flex-col gap-3 px-5 py-4">
              {photos.failed ? <p className="m-0 text-danger">{t("page.loadFailed")}</p> : null}
              {!photos.photos && !photos.failed ? (
                <p className="m-0 text-muted">{t("page.loading")}</p>
              ) : null}
              {photos.photos && photos.photos.length === 0 ? (
                <p className="m-0 text-muted">{none ? t("page.emptyNone") : t("page.empty")}</p>
              ) : null}
              {photos.photos?.length ? (
                <PhotoStrip photos={photos.photos} where={name} selectable={() => canEdit} />
              ) : null}
              {photos.next ? (
                <Button variant="ghost" className="self-start" onClick={() => void photos.more()}>
                  {t("page.showMore")}
                </Button>
              ) : null}
            </section>
          </Card>
        )}
      </JobSection>

      <MoveToGroupDialog
        groups={list}
        from={group}
        photoIds={moving}
        onClose={() => setMoving(null)}
        onMove={moveTo}
      />
      <AlsoShowDialog
        groups={list}
        from={group}
        photoIds={showing}
        onClose={() => setShowing(null)}
        onShow={alsoShow}
      />
      <GroupNameDialog
        jobId={job.id}
        group={group}
        groups={list}
        open={open === "rename"}
        onClose={() => setOpen(null)}
        onSaved={(g) => {
          setOpen(null);
          setStatus(t("announce.renamed", { name: g.name }));
          void reload();
        }}
      />
      <MembersDialog
        jobId={job.id}
        group={group}
        open={open === "members"}
        onClose={() => setOpen(null)}
        onSaved={(c) => {
          setOpen(null);
          setStatus(t("announce.members", c));
          void reload();
          refreshSummary();
        }}
      />
      <DeleteGroupDialog
        group={group}
        groups={list}
        open={open === "delete"}
        onClose={() => setOpen(null)}
        onDeleted={() => {
          setOpen(null);
          refreshSummary();
          router.push(groupsHref(job.id));
        }}
      />
    </ReviewContext.Provider>
  );
}
