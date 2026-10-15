"use client";

import type { PhotosMovedResponse, TaggingSummary, TaggingSummaryResponse } from "@daybell/api";
import { MAX_PHOTOS_PER_BIN_REQUEST } from "@daybell/core";
import { Banner, Button, ListCard } from "@daybell/ui";
import { ArrowLeft, Trash2, Undo2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { ChipRow } from "../../../filter-chips/chip-row";
import { SavedChipsNotice } from "../../../filter-chips/saved-chips-notice";
import { JobTabActions, useJob } from "../job-context";
import { JobSection } from "../job-section";
import { LiveNote } from "../live-note";
import { tabHref } from "../tabs";
import { GiveDialog } from "./give-dialog";
import { PeopleLines } from "./people-lines";
import { photosHref, usePhotoChips } from "./photo-chips";
import { PhotoGrid, tileId } from "./photo-grid";
import { PhotoPanel } from "./photo-panel";
import { stripTileId } from "./photo-strip";
import { PhotosSwitch } from "./photos-switch";
import { ReviewContext } from "./review-context";
import { SelectionBar, useProblem, useReviewState } from "./review-state";
import { useRuns } from "./runs-store";
import { ToReview } from "./to-review";
import { isActive, UploadSheet, useLeaveWarning } from "./upload-sheet";
import { usePhotoGroups } from "./use-photo-groups";
import { usePhotos } from "./use-photos";

export default function PhotosPageRoute() {
  // useSearchParams (the chip and the open photo) needs a Suspense boundary.
  return (
    <Suspense>
      <PhotosPage />
    </Suspense>
  );
}

/** How often To review's counts are checked while photos are being processed or tagged. */
const POLL_MS = 4000;

/**
 * A job's Photos (D156, amending D140, D144, D147; ADR 0016, 0018, 0030): the tab row keeps a quiet Bin (n) and a white
 * Upload photos (D151); a muted line counts the photos; then a white card whose toolbar has the People | Groups switch
 * and the chips (All, To review, "+ Add filter › Group…", saved for this job). All shows one folded line per person with
 * photos (50 at a time); a group chip only that group's members; To review what the QR cards couldn't place, with Mark
 * reviewed. A photo opens in the floating panel (?photo=<id>), the bin in its own grid (?bin=1). Owners, admins and
 * photographers upload, give photos to people, check them and bin them; staff look. Closed jobs take no photos.
 */
function PhotosPage() {
  const t = useTranslations("app.photos");
  const router = useRouter();
  const problem = useProblem();
  const { job, canEditRoster: canEdit, canManage, refreshSummary, setTaggingReviewed } = useJob();
  // Undoing "This is a card photo" is for owners and admins (Seenu, answer 12).
  const canUndoCard = canEdit && canManage;
  const base = tabHref(job.id, "photos");
  const [runs, setRuns] = useRuns(job.id);
  const uploading = runs.some(isActive);
  const groups = usePhotoGroups(job.id);
  const { chip, photoId, bin, items, choices, saved } = usePhotoChips({
    base,
    jobId: job.id,
    groups: groups.groups,
  });
  const photos = usePhotos(job.id, true, uploading, { rows: bin });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [binChecked, setBinChecked] = useState<ReadonlySet<string>>(new Set());
  const [panelFocus, setPanelFocus] = useState<string | null>(null);
  const [panelVersion, setPanelVersion] = useState(0);
  const opener = useRef<{ id: string; alt: string } | null>(null);
  useLeaveWarning(uploading);
  const closed = job.status === "closed";
  const canUpload = canEdit && !closed;

  // To review's summary, also the signal that tagging changed something People shows.
  const [summary, setSummary] = useState<TaggingSummary | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const summaryRequest = useRef(0);
  const lastSummary = useRef("");
  const bump = useRef<() => void>(() => {});
  const loadSummary = useCallback(async () => {
    const request = ++summaryRequest.current;
    const res = await api<TaggingSummaryResponse>(`/jobs/${encodeURIComponent(job.id)}/tagging`);
    if (request !== summaryRequest.current) return;
    setSummaryFailed(!res.ok);
    if (!res.ok) return;
    setSummary(res.data.tagging);
    setTaggingReviewed(res.data.tagging.done);
    // Anything new (a batch tagged, a photo processed) loads every line again.
    const key = JSON.stringify(res.data.tagging, (k, v) => (k.endsWith("Url") ? undefined : v));
    if (lastSummary.current && key !== lastSummary.current) bump.current();
    lastSummary.current = key;
  }, [job.id, setTaggingReviewed]);

  const openPhoto = useCallback(
    (id: string, alt: string) => {
      opener.current = { id, alt };
      setPanelFocus(id);
      router.replace(photosHref(base, chip, { photoId: id, bin }), { scroll: false });
    },
    [router, base, chip, bin],
  );
  const review = useReviewState({
    jobId: job.id,
    canEdit,
    canUndoCard,
    openPhoto,
    onChanged: async () => {
      setPanelVersion((v) => v + 1);
      await Promise.all([loadSummary(), photos.reload(), groups.reload()]);
      refreshSummary();
    },
  });
  bump.current = review.bump;
  const { setStatus } = review;

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);
  const pending = summary?.pending ?? false;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void loadSummary(), POLL_MS);
    return () => clearInterval(timer);
  }, [pending, loadSummary]);

  function closePanel() {
    const back = opener.current?.id ?? photoId;
    router.replace(photosHref(base, chip, { bin }), { scroll: false });
    setPanelFocus(null);
    if (back)
      setTimeout(
        () =>
          (
            document.getElementById(stripTileId(back)) ?? document.getElementById(tileId(back))
          )?.focus(),
        0,
      );
  }

  /** The bin and back (Seenu, answer 7), 500 at a time; the uploads are tagged again by the API. */
  async function binOrRestore(action: "bin" | "restore", ids: string[]) {
    await review.whileBusy(async () => {
      setStatus("");
      let moved = 0;
      for (let i = 0; i < ids.length; i += MAX_PHOTOS_PER_BIN_REQUEST) {
        const res = await api<PhotosMovedResponse>(
          `/jobs/${encodeURIComponent(job.id)}/photos/${action}`,
          { method: "POST", body: { photoIds: ids.slice(i, i + MAX_PHOTOS_PER_BIN_REQUEST) } },
        );
        if (!res.ok) {
          setStatus(problem(res));
          await review.changed();
          return;
        }
        moved += res.data.moved;
      }
      setStatus(t(action === "bin" ? "binned" : "restored", { count: moved }));
      setBinChecked(new Set());
      if (photoId && ids.includes(photoId)) closePanel();
      await review.changed();
    });
  }

  async function retry(id: string) {
    const res = await api(`/photos/${encodeURIComponent(id)}/retry`, { method: "POST" });
    setStatus(res.ok ? t("retried") : problem(res));
    await review.changed();
  }

  function showBin(on: boolean) {
    setBinChecked(new Set());
    setStatus("");
    router.replace(photosHref(base, chip, { bin: on }), { scroll: false });
  }

  const counts = photos.counts;
  const noPhotos = counts !== null && counts.photos === 0;
  const title = counts
    ? bin
      ? t("binHeading", { count: counts.binned })
      : t("heading", { count: counts.photos })
    : null;
  const subline =
    counts && !bin
      ? t("subline", {
          uploads: counts.uploads,
          processing: counts.processing,
          duplicates: counts.duplicatesSkipped,
        })
      : null;
  const binRows = photos.rows ?? [];
  const binIndex = binRows.findIndex((p) => p.id === photoId);

  return (
    <ReviewContext.Provider value={review.context}>
      <JobSection
        title={title}
        below={
          <>
            <JobTabActions>
              {bin ? (
                <Button variant="quiet" shape="pill" onClick={() => showBin(false)}>
                  <ArrowLeft aria-hidden="true" />
                  {t("backToPhotos")}
                </Button>
              ) : (
                <>
                  {counts ? (
                    <Button variant="quiet" shape="pill" onClick={() => showBin(true)}>
                      <Trash2 aria-hidden="true" />
                      {t("bin", { count: counts.binned })}
                    </Button>
                  ) : null}
                  {canUpload ? (
                    <Button
                      variant="white"
                      shape="pill"
                      aria-expanded={sheetOpen}
                      onClick={() => setSheetOpen((o) => !o)}
                    >
                      <Upload aria-hidden="true" />
                      {t("upload")}
                    </Button>
                  ) : null}
                </>
              )}
            </JobTabActions>
            {closed && !bin ? <Banner tone="info" title={t("closed")} /> : null}
            {bin ? null : <LiveNote />}
            {bin ? <p className="m-0 text-sm text-muted">{t("binNote")}</p> : null}
            {(sheetOpen || uploading) && canUpload && !bin ? (
              <UploadSheet
                jobId={job.id}
                runs={runs}
                setRuns={setRuns}
                groups={groups.groups}
                onClose={() => setSheetOpen(false)}
                onUploaded={() => void review.changed()}
              />
            ) : null}
            {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3). */}
            <p role="status" className="m-0 text-sm font-semibold text-ink empty:-mb-4">
              {review.status}
            </p>
            {bin && canEdit && binChecked.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-full bg-surface px-5 py-1">
                <span className="flex-1 text-sm font-semibold text-ink">
                  {t("selected", { count: binChecked.size })}
                </span>
                <Button
                  variant="secondary"
                  shape="pill"
                  onClick={() => void binOrRestore("restore", [...binChecked])}
                >
                  <Undo2 aria-hidden="true" />
                  {t("restore")}
                </Button>
                <Button variant="ghost" shape="pill" onClick={() => setBinChecked(new Set())}>
                  {t("clearSelection")}
                </Button>
              </div>
            ) : null}
            {bin ? null : <SelectionBar state={review} />}
            {bin ? null : <SavedChipsNotice filters={saved} />}
            {photos.failed ? <Banner tone="danger" title={t("loadFailed")} /> : null}
            {title ? (
              // The count is the section's h2 for screen readers already: here it is shown, not read twice.
              <p className="m-0 text-body text-muted">
                <span aria-hidden="true">
                  {title}
                  {subline ? " · " : ""}
                </span>
                {subline}
              </p>
            ) : null}
          </>
        }
        panel={
          photoId ? (
            <PhotoPanel
              key={photoId}
              photoId={photoId}
              alt={
                opener.current?.id === photoId
                  ? opener.current.alt
                  : binIndex >= 0
                    ? t("photoAlt", { n: binIndex + 1 })
                    : null
              }
              canEdit={canEdit}
              focusKey={panelFocus === photoId ? panelFocus : null}
              version={panelVersion}
              onClose={closePanel}
              onBin={() => binOrRestore("bin", [photoId])}
              onRestore={() => binOrRestore("restore", [photoId])}
              onRetry={() => retry(photoId)}
              onGive={() => review.setGiving([photoId])}
            />
          ) : null
        }
      >
        <div className="flex flex-col gap-3">
          <ListCard
            toolbar={
              bin ? null : (
                <div className="flex flex-wrap items-center gap-3">
                  <PhotosSwitch jobId={job.id} current="people" />
                  <div className="min-w-0 flex-1">
                    <ChipRow label={t("views.label")} items={items} choices={choices} />
                  </div>
                </div>
              )
            }
          >
            {bin ? (
              <BinGrid
                photos={photos}
                checked={canEdit ? binChecked : null}
                selectedId={photoId}
                onToggle={(id, on) =>
                  setBinChecked((current) => {
                    const next = new Set(current);
                    if (on) next.add(id);
                    else next.delete(id);
                    return next;
                  })
                }
                onOpen={(id, n) => openPhoto(id, t("photoAlt", { n }))}
              />
            ) : chip.kind === "review" ? (
              <ToReview
                summary={summary}
                failed={summaryFailed}
                state={review}
                onAnnounce={setStatus}
              />
            ) : noPhotos ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <h2 className="m-0 text-h3">{t("emptyTitle")}</h2>
                <p className="m-0 max-w-120 text-muted">{t("emptyBody")}</p>
                {canEdit ? null : (
                  <p className="m-0 text-caption text-muted">{t("emptyReadOnly")}</p>
                )}
              </div>
            ) : (
              <PeopleLines groupId={chip.kind === "group" ? chip.id : null} />
            )}
          </ListCard>
          {bin && photos.nextCursor ? (
            <Button
              variant="white"
              shape="pill"
              className="self-center"
              disabled={photos.loadingMore}
              onClick={() => void photos.loadMore()}
            >
              {t("showMore")}
            </Button>
          ) : null}
        </div>
      </JobSection>
      <GiveDialog
        jobId={job.id}
        photoIds={review.giving}
        onClose={() => review.setGiving(null)}
        onGive={review.actions.move}
      />
    </ReviewContext.Provider>
  );
}

/** The bin (Seenu, answer 7): binned photos as a grid of thumbnails, restored from here or from the panel. */
function BinGrid({
  photos,
  checked,
  selectedId,
  onToggle,
  onOpen,
}: {
  photos: ReturnType<typeof usePhotos>;
  checked: ReadonlySet<string> | null;
  selectedId: string | null;
  onToggle: (photoId: string, on: boolean) => void;
  onOpen: (photoId: string, n: number) => void;
}) {
  const t = useTranslations("app.photos");
  const rows = photos.rows ?? [];
  if (!photos.rows && !photos.failed)
    return <p className="m-0 px-6 py-10 text-center text-muted">{t("loading")}</p>;
  if (photos.rows && rows.length === 0)
    return <p className="m-0 px-6 py-10 text-center text-muted">{t("binEmpty")}</p>;
  return (
    <PhotoGrid
      photos={rows}
      selectedId={selectedId}
      checked={checked}
      onToggle={onToggle}
      onOpen={(id) => onOpen(id, rows.findIndex((p) => p.id === id) + 1)}
      busy={photos.loadingMore}
    />
  );
}
