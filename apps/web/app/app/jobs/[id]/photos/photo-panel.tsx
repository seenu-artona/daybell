"use client";

import type { PhotoDetailResponse } from "@daybell/api";
import { Button } from "@daybell/ui";
import {
  Download,
  EyeOff,
  Layers,
  LayoutGrid,
  Paintbrush,
  RotateCcw,
  Star,
  Trash2,
  Undo2,
  UserPlus,
  UserRoundCheck,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { MENU_ROW } from "../../../popover";
import { FloatingPanel } from "../floating-panel";

type Detail = PhotoDetailResponse["photo"];

/**
 * One photo in the floating panel (D140): the 1600 px preview (studio only, unwatermarked), its file's name, when it
 * was taken, its size and status in words, and for people who can bin: Move to bin (or Restore), Try again for a photo
 * that couldn't be read or has been processing for 15 minutes, and + Give to a person when review allows it (C13; never
 * a group photo, C8). Photo actions coming later are listed and marked Soon (D156). ?photo=<id> in the address (an id
 * only); the panel reads the photo itself, so a photo opened from a person's line, To review or a group works the same.
 * `version` reloads it after a change.
 */
export function PhotoPanel({
  photoId,
  alt,
  canEdit,
  focusKey,
  version = 0,
  onClose,
  onBin,
  onRestore,
  onRetry,
  onGive,
}: {
  photoId: string;
  /** The image's alt text, where the photo was opened from ("Maya Johnson, photo 3"); never a filename. */
  alt: string | null;
  canEdit: boolean;
  focusKey: string | null;
  version?: number;
  onClose: () => void;
  onBin: () => Promise<void>;
  onRestore: () => Promise<void>;
  onRetry: () => Promise<void>;
  /** Opens Give to a person for this photo; left out where photos aren't given (a group's page). */
  onGive?: () => void;
}) {
  const t = useTranslations("app.photos");
  const tp = useTranslations("app.photos.panel");
  const format = useFormatter();
  const [photo, setPhoto] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the reload signal.
  useEffect(() => {
    let live = true;
    void api<PhotoDetailResponse>(`/photos/${encodeURIComponent(photoId)}`).then((res) => {
      if (!live) return;
      setFailed(!res.ok);
      if (res.ok) setPhoto(res.data.photo);
    });
    return () => {
      live = false;
    };
  }, [photoId, version]);

  const act = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }, []);

  if (!photo)
    return (
      <FloatingPanel title={tp("photo")} focusKey={focusKey} onClose={onClose}>
        <p className="m-0 text-sm text-muted">{failed ? t("loadFailed") : t("loading")}</p>
      </FloatingPanel>
    );

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
  const canGive = canEdit && Boolean(onGive) && photo.tagging?.actions.move === true;

  return (
    <FloatingPanel
      title={photo.originalFilename}
      meta={photo.binnedAt ? tp("inBin") : tp(`statuses.${photo.status}`)}
      focusKey={focusKey}
      onClose={onClose}
    >
      <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-subtle">
        {photo.viewUrl ? (
          // biome-ignore lint/performance/noImgElement: signed, short-lived storage URLs; no image optimiser in between (D113).
          <img
            src={photo.viewUrl}
            alt={alt ?? tp("photo")}
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
          {canGive ? (
            <Button variant="secondary" shape="pill" disabled={busy} onClick={onGive}>
              <UserPlus aria-hidden="true" />
              {tp("giveToPerson")}
            </Button>
          ) : null}
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
      <SoonRows />
    </FloatingPanel>
  );
}

/**
 * Photo actions coming later (D156): listed so people know they are coming, marked Soon, and not available. Each stays
 * in the tab order (aria-disabled, not disabled) so screen readers hear it (D91).
 */
function SoonRows() {
  const tp = useTranslations("app.photos.panel");
  const rows: { key: string; icon: ReactNode }[] = [
    { key: "mainPhoto", icon: <UserRoundCheck aria-hidden="true" /> },
    { key: "hide", icon: <EyeOff aria-hidden="true" /> },
    { key: "rating", icon: <Star aria-hidden="true" /> },
    { key: "versions", icon: <Layers aria-hidden="true" /> },
    { key: "composites", icon: <LayoutGrid aria-hidden="true" /> },
    { key: "sendForEditing", icon: <Paintbrush aria-hidden="true" /> },
    { key: "downloadOriginal", icon: <Download aria-hidden="true" /> },
  ];
  return (
    <section aria-label={tp("soonLabel")} className="flex flex-col border-t border-line pt-2">
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              aria-disabled="true"
              className={`${MENU_ROW} cursor-default text-muted hover:bg-transparent`}
            >
              {row.icon}
              <span className="flex-1">{tp(`soonRows.${row.key as "mainPhoto"}`)}</span>{" "}
              <span className="rounded-full border border-line-strong px-2 text-micro text-muted">
                {tp("soon")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
