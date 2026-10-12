"use client";

import type { Photo, PhotoDetailResponse } from "@daybell/api";
import { Button } from "@daybell/ui";
import { RotateCcw, Trash2, Undo2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { FloatingPanel } from "../floating-panel";

/**
 * One photo in the floating panel (D140): the 1600 px preview (studio only, unwatermarked), its file's name, when it
 * was taken, its size and status in words, and for people who can bin: Move to bin (or Restore), and Try again for a
 * photo that couldn't be read or has been processing for 15 minutes. ?photo=<id> in the URL (an id only).
 */
export function PhotoPanel({
  photo,
  n,
  canEdit,
  focusKey,
  onClose,
  onBin,
  onRestore,
  onRetry,
}: {
  photo: Photo;
  /** Its place in the order, for the image's alt text. */
  n: number;
  canEdit: boolean;
  focusKey: string | null;
  onClose: () => void;
  onBin: () => Promise<void>;
  onRestore: () => Promise<void>;
  onRetry: () => Promise<void>;
}) {
  const t = useTranslations("app.photos");
  const tp = useTranslations("app.photos.panel");
  const format = useFormatter();
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setViewUrl(null);
    if (photo.status !== "ready") return;
    let live = true;
    void api<PhotoDetailResponse>(`/photos/${encodeURIComponent(photo.id)}`).then((res) => {
      if (live && res.ok) setViewUrl(res.data.photo.viewUrl);
    });
    return () => {
      live = false;
    };
  }, [photo.id, photo.status]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  // The camera's own clock, shown as written (no time zone is known).
  const taken = photo.capturedAt
    ? format.dateTime(new Date(`${photo.capturedAt.slice(0, 19)}Z`), {
        dateStyle: "medium",
        timeStyle: "medium",
        timeZone: "UTC",
      })
    : tp("noCaptureTime");
  const fields = [
    { key: "taken", label: tp("taken"), value: taken },
    {
      key: "size",
      label: tp("size"),
      value: tp("megabytes", {
        size: format.number(photo.byteSize / 1_000_000, { maximumFractionDigits: 1 }),
      }),
    },
    ...(photo.width && photo.height
      ? [
          {
            key: "dims",
            label: tp("pixels"),
            value: tp("dimensions", { width: photo.width, height: photo.height }),
          },
        ]
      : []),
    { key: "status", label: tp("status"), value: tp(`statuses.${photo.status}`) },
  ];

  return (
    <FloatingPanel
      title={photo.originalFilename}
      meta={photo.binnedAt ? tp("inBin") : tp(`statuses.${photo.status}`)}
      focusKey={focusKey}
      onClose={onClose}
    >
      <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-subtle">
        {viewUrl ? (
          // biome-ignore lint/performance/noImgElement: signed, short-lived storage URLs; no image optimiser in between (D113).
          <img
            src={viewUrl}
            alt={t("photoAlt", { n })}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="px-4 text-center text-label font-semibold text-muted">
            {photo.status === "failed" ? t("failed") : t("processing")}
          </span>
        )}
      </div>
      {photo.failureReason ? (
        <p className="m-0 text-sm font-semibold text-danger">
          {tp(`reasons.${photo.failureReason}`)}
        </p>
      ) : null}
      <dl className="m-0 flex flex-col">
        <div className="flex min-h-11 items-center gap-3 border-b border-line">
          <dt className="w-24 shrink-0 text-label text-muted">{tp("file")}</dt>
          <dd className="m-0 min-w-0 break-words text-sm text-ink">{photo.originalFilename}</dd>
        </div>
        {fields.map((f) => (
          <div
            key={f.key}
            className="flex min-h-11 items-center gap-3 border-b border-line last:border-b-0"
          >
            <dt className="w-24 shrink-0 text-label text-muted">{f.label}</dt>
            <dd className="m-0 text-sm text-ink">{f.value}</dd>
          </div>
        ))}
      </dl>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {photo.retryable ? (
            <Button variant="secondary" shape="pill" disabled={busy} onClick={() => act(onRetry)}>
              <RotateCcw aria-hidden="true" />
              {tp("retry")}
            </Button>
          ) : null}
          {photo.binnedAt ? (
            <Button variant="secondary" shape="pill" disabled={busy} onClick={() => act(onRestore)}>
              <Undo2 aria-hidden="true" />
              {t("restore")}
            </Button>
          ) : (
            <Button variant="secondary" shape="pill" disabled={busy} onClick={() => act(onBin)}>
              <Trash2 aria-hidden="true" />
              {t("moveToBin")}
            </Button>
          )}
        </div>
      ) : null}
    </FloatingPanel>
  );
}
