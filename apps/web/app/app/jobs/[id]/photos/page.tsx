"use client";

import { PHOTO_CONFLICTS, type PhotosMovedResponse } from "@daybell/api";
import { MAX_PHOTOS_PER_BIN_REQUEST } from "@daybell/core";
import { Banner, Button } from "@daybell/ui";
import { ArrowLeft, Trash2, Undo2, Upload } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { useJob } from "../job-context";
import { JobSection } from "../job-section";
import { LiveNote } from "../live-note";
import { tabHref } from "../tabs";
import { PhotoGrid, tileId } from "./photo-grid";
import { PhotoPanel } from "./photo-panel";
import { PhotosViews } from "./photos-views";
import { useRuns } from "./runs-store";
import { isActive, UploadSheet, useLeaveWarning } from "./upload-sheet";
import { usePhotos } from "./use-photos";

export default function PhotosPageRoute() {
  // useSearchParams (the open photo) needs a Suspense boundary.
  return (
    <Suspense>
      <PhotosPage />
    </Suspense>
  );
}

const CONFLICT_KEYS = Object.fromEntries(
  Object.entries(PHOTO_CONFLICTS).map(([key, value]) => [value, key]),
) as Record<string, keyof typeof PHOTO_CONFLICTS>;

/**
 * A job's Photos (D39, D60, D140, D144; Phase 1 step 4, ADR 0016): the view bar (All and Review; a quiet Bin (n) and the
 * green Upload photos), the upload sheet, a muted line with the counts (photos, uploads, processing, duplicates
 * skipped), then the photos as thumbnails in tagging order, 200 at a time. A photo opens in the floating panel (?photo=<id>). Owners, admins and photographers
 * upload, bin and restore; staff look. Closed jobs take no photos.
 */
function PhotosPage() {
  const t = useTranslations("app.photos");
  const tc = useTranslations("app.photos.conflicts");
  const text = useApiText();
  const router = useRouter();
  const { job, canEditRoster: canEdit, refreshSummary } = useJob();
  const base = tabHref(job.id, "photos");
  const [bin, setBin] = useState(false);
  const [runs, setRuns] = useRuns(job.id);
  const uploading = runs.some(isActive);
  const photos = usePhotos(job.id, bin, uploading);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState("");
  const [panelFocus, setPanelFocus] = useState<string | null>(null);
  const opener = useRef<string | null>(null);
  useLeaveWarning(uploading);

  const closed = job.status === "closed";
  const canUpload = canEdit && !closed;
  const selectedId = useSearchParams().get("photo");
  const rows = photos.rows ?? [];
  const index = rows.findIndex((p) => p.id === selectedId);
  const selected = index >= 0 ? rows[index] : null;

  // A photo that isn't in what's loaded (binned, another job's id) is dropped from the URL quietly, but never while
  // the photos are being loaded again (review CR6).
  useEffect(() => {
    if (selectedId && photos.rows && !photos.loadingMore && !photos.refreshing && !selected)
      router.replace(base, { scroll: false });
  }, [selectedId, selected, photos.rows, photos.loadingMore, photos.refreshing, router, base]);

  function problem(res: { ok: false; code: string; fields: Record<string, string> }) {
    const key = CONFLICT_KEYS[res.fields.form ?? ""];
    return key ? tc(key) : text.error(res.code);
  }

  async function move(action: "bin" | "restore", ids: string[]) {
    setStatus("");
    // The API takes 500 at a time.
    let moved = 0;
    for (let i = 0; i < ids.length; i += MAX_PHOTOS_PER_BIN_REQUEST) {
      const res = await api<PhotosMovedResponse>(
        `/jobs/${encodeURIComponent(job.id)}/photos/${action}`,
        { method: "POST", body: { photoIds: ids.slice(i, i + MAX_PHOTOS_PER_BIN_REQUEST) } },
      );
      if (!res.ok) {
        setStatus(problem(res));
        await photos.reload();
        return;
      }
      moved += res.data.moved;
    }
    setStatus(t(action === "bin" ? "binned" : "restored", { count: moved }));
    setChecked(new Set());
    if (selectedId && ids.includes(selectedId)) closePanel();
    await photos.reload();
    refreshSummary();
  }

  async function retry(photoId: string) {
    const res = await api(`/photos/${encodeURIComponent(photoId)}/retry`, { method: "POST" });
    setStatus(res.ok ? t("retried") : problem(res));
    await photos.reload();
  }

  function open(photoId: string) {
    opener.current = photoId;
    setPanelFocus(photoId);
    router.replace(`${base}?photo=${photoId}`, { scroll: false });
  }

  function closePanel() {
    const back = opener.current ?? selectedId;
    router.replace(base, { scroll: false });
    setPanelFocus(null);
    if (back) setTimeout(() => document.getElementById(tileId(back))?.focus(), 0);
  }

  function showBin(on: boolean) {
    setBin(on);
    setChecked(new Set());
    setStatus("");
    router.replace(base, { scroll: false });
  }

  const counts = photos.counts;
  const empty = photos.rows !== null && rows.length === 0;
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

  return (
    <JobSection
      title={title}
      views={bin ? null : <PhotosViews jobId={job.id} current="all" />}
      tools={
        bin ? (
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
                shape="pill"
                aria-expanded={sheetOpen}
                onClick={() => setSheetOpen((o) => !o)}
              >
                <Upload aria-hidden="true" />
                {t("upload")}
              </Button>
            ) : null}
          </>
        )
      }
      below={
        <>
          {closed && !bin ? <Banner tone="info" title={t("closed")} /> : null}
          {bin ? null : <LiveNote />}
          {bin ? <p className="m-0 text-sm text-muted">{t("binNote")}</p> : null}
          {(sheetOpen || uploading) && canUpload && !bin ? (
            <UploadSheet
              jobId={job.id}
              runs={runs}
              setRuns={setRuns}
              onClose={() => setSheetOpen(false)}
              onUploaded={() => {
                void photos.reload();
                refreshSummary();
              }}
            />
          ) : null}
          {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3). */}
          <p role="status" className="m-0 text-sm text-muted empty:-mb-4">
            {status}
          </p>
          {canEdit && checked.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-full bg-surface px-5 py-1">
              <span className="flex-1 text-sm font-semibold text-ink">
                {t("selected", { count: checked.size })}
              </span>
              {bin ? (
                <Button
                  variant="secondary"
                  shape="pill"
                  onClick={() => move("restore", [...checked])}
                >
                  <Undo2 aria-hidden="true" />
                  {t("restore")}
                </Button>
              ) : (
                <Button variant="secondary" shape="pill" onClick={() => move("bin", [...checked])}>
                  <Trash2 aria-hidden="true" />
                  {t("moveToBin")}
                </Button>
              )}
              <Button variant="ghost" shape="pill" onClick={() => setChecked(new Set())}>
                {t("clearSelection")}
              </Button>
            </div>
          ) : null}
          {photos.failed ? <Banner tone="danger" title={t("loadFailed")} /> : null}
          {title ? (
            <p className="m-0 text-body text-muted">
              {[title, subline].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </>
      }
      panel={
        selected ? (
          <PhotoPanel
            key={selected.id}
            photo={selected}
            n={index + 1}
            canEdit={canEdit}
            focusKey={panelFocus === selected.id ? panelFocus : null}
            onClose={closePanel}
            onBin={() => move("bin", [selected.id])}
            onRestore={() => move("restore", [selected.id])}
            onRetry={() => retry(selected.id)}
          />
        ) : null
      }
    >
      {!photos.rows && !photos.failed ? <p className="m-0 text-muted">{t("loading")}</p> : null}

      {empty ? (
        bin ? (
          <p className="m-0 rounded-xl bg-surface px-6 py-10 text-center text-muted">
            {t("binEmpty")}
          </p>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl bg-surface px-6 py-16 text-center">
            <h2 className="m-0 text-h3">{t("emptyTitle")}</h2>
            <p className="m-0 max-w-120 text-muted">{t("emptyBody")}</p>
            {canEdit ? null : <p className="m-0 text-caption text-muted">{t("emptyReadOnly")}</p>}
          </div>
        )
      ) : null}

      {rows.length > 0 ? (
        <div className="flex flex-col gap-3">
          <PhotoGrid
            photos={rows}
            selectedId={selected?.id ?? null}
            checked={canEdit ? checked : null}
            onToggle={(id, on) =>
              setChecked((current) => {
                const next = new Set(current);
                if (on) next.add(id);
                else next.delete(id);
                return next;
              })
            }
            onOpen={open}
            busy={photos.loadingMore}
          />
          {photos.nextCursor ? (
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
      ) : null}
    </JobSection>
  );
}
