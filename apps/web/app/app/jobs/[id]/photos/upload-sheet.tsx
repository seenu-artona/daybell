"use client";

import { Button, Card, CardRow, IconButton } from "@daybell/ui";
import { FolderOpen, Images, RotateCcw, Square, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { MENU_ROW } from "../../../popover";
import {
  type DropFile,
  filesFromDrop,
  filesFromInput,
  putPart,
  type UploadChoice,
  type UploadProgress,
  UploadRun,
  whenOnline,
  workerHasher,
} from "./upload-run";

export interface RunView {
  id: number;
  run: UploadRun;
  progress: UploadProgress;
}

const ACTIVE: ReadonlySet<UploadProgress["phase"]> = new Set([
  "checking",
  "uploading",
  "offline",
  "finishing",
]);
export const isActive = (r: RunView) => ACTIVE.has(r.progress.phase);

/** Screen readers hear progress at most this often; a finished or stopped upload is announced at once. */
const ANNOUNCE_MS = 5000;

/**
 * The Photos tab's upload sheet (D39, D91, D140; ADR 0016): a drop zone that takes whole folders, and two buttons for
 * people who don't drag (Choose folder, Choose photos). Each drop becomes an upload with its progress in words and a
 * bar, read out politely and not too often. Uploads keep going while the sheet is closed; leaving the page warns.
 * First, what the photos are (D156; ADR 0030): individual photos, split by their QR cards as each upload finishes,
 * optionally adding everyone in the upload to a group (C7); or group photos for one group, which every member sees.
 * Other ways to upload are listed and marked Soon (C14).
 */
export function UploadSheet({
  jobId,
  runs,
  setRuns,
  onClose,
  onUploaded,
  groups,
  presetGroupId = null,
}: {
  jobId: string;
  runs: RunView[];
  setRuns: (update: (runs: RunView[]) => RunView[]) => void;
  onClose: () => void;
  /** An upload finished: the page reloads its photos and the job's counts. */
  onUploaded: () => void;
  /** The job's groups (by name); null while they load. */
  groups: readonly { id: string; name: string }[] | null;
  /** Opened from a group's page: group photos for that group (D156: "uploaded into a group"). */
  presetGroupId?: string | null;
}) {
  const t = useTranslations("app.photos.uploader");
  const tc = useTranslations("app.photos.conflicts");
  const tg = useTranslations("app.photos.groups");
  const headingId = useId();
  const folderInput = useRef<HTMLInputElement>(null);
  const photosInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const lastAnnounced = useRef(0);
  const nextId = useRef(1);
  const kindName = useId();
  const groupSelect = useId();
  const addSelect = useId();
  const individualHint = useId();
  const groupHint = useId();
  const [kind, setKind] = useState<UploadChoice["kind"]>(presetGroupId ? "group" : "individual");
  const [groupId, setGroupId] = useState(presetGroupId ?? "");
  const [addToGroupId, setAddToGroupId] = useState("");
  const list = groups ?? [];

  function start(files: DropFile[]) {
    setNotice("");
    if (kind === "group" && !groupId) {
      setNotice(t("chooseGroupFirst"));
      return;
    }
    const choice: UploadChoice =
      kind === "group"
        ? { kind: "group", groupId }
        : { kind: "individual", addToGroupId: addToGroupId || null };
    const hasher = workerHasher();
    const id = nextId.current++;
    const run = new UploadRun(
      jobId,
      files,
      {
        api,
        put: putPart,
        hash: hasher.hash,
        online: whenOnline,
        sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)),
      },
      (progress) => {
        setRuns((all) => all.map((r) => (r.id === id ? { ...r, progress } : r)));
        const now = Date.now();
        const settled = !ACTIVE.has(progress.phase);
        if (settled || now - lastAnnounced.current > ANNOUNCE_MS) {
          lastAnnounced.current = now;
          setAnnouncement(t("announce", { uploaded: progress.uploaded, total: progress.total }));
        }
      },
      choice,
    );
    if (run.progress.total === 0) {
      setNotice(t("nothing"));
      hasher.close();
      return;
    }
    setRuns((all) => [...all, { id, run, progress: { ...run.progress } }]);
    void run.start().finally(() => {
      hasher.close();
      onUploaded();
    });
  }

  const problem = (code: string | null) => {
    if (!code) return null;
    // The group was deleted meanwhile (ADR 0030).
    if (code === "groups.notInJob") return tg("conflicts.notInJob");
    const key = code.startsWith("photos.") ? code.slice("photos.".length) : null;
    if (
      key &&
      ["jobClosed", "photoLimit", "batchFinished", "notUploading", "incomplete"].includes(key)
    )
      return tc(key as "jobClosed");
    return null;
  };

  return (
    <Card variant="sheet" asChild>
      <section aria-labelledby={headingId} className="flex flex-col gap-4 py-5">
        <div className="flex items-center gap-3">
          <h2 id={headingId} className="m-0 flex-1 text-h3 font-bold">
            {t("title")}
          </h2>
          <IconButton tone="canvas" label={t("close")} onClick={onClose}>
            <X aria-hidden="true" />
          </IconButton>
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-sm font-semibold text-ink">{t("kind.legend")}</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="radio"
              name={kindName}
              checked={kind === "individual"}
              aria-describedby={individualHint}
              onChange={() => setKind("individual")}
              className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
            {t("kind.individual")}
          </label>
          <p id={individualHint} className="m-0 pl-8 text-caption text-muted">
            {t("kind.individualHint")}
          </p>
          {kind === "individual" && list.length > 0 ? (
            <div className="flex flex-col gap-1 pl-8">
              <label htmlFor={addSelect} className="text-label font-semibold text-ink">
                {t("kind.addToGroup")}
              </label>
              <select
                id={addSelect}
                value={addToGroupId}
                onChange={(e) => setAddToGroupId(e.target.value)}
                className={SELECT}
              >
                <option value="">{t("kind.noGroup")}</option>
                {list.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="radio"
              name={kindName}
              checked={kind === "group"}
              disabled={list.length === 0}
              aria-describedby={groupHint}
              onChange={() => setKind("group")}
              className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
            {t("kind.group")}
          </label>
          <p id={groupHint} className="m-0 pl-8 text-caption text-muted">
            {list.length === 0 && groups !== null ? t("kind.noGroups") : t("kind.groupHint")}
          </p>
          {kind === "group" ? (
            <div className="flex flex-col gap-1 pl-8">
              <label htmlFor={groupSelect} className="text-label font-semibold text-ink">
                {t("kind.groupSelect")}
              </label>
              <select
                id={groupSelect}
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className={SELECT}
              >
                <option value="">{t("kind.chooseGroup")}</option>
                {list.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </fieldset>

        <section
          aria-label={t("drop")}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragging(false);
            start(await filesFromDrop(e.dataTransfer));
          }}
          className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 text-center ${
            dragging ? "border-primary bg-primary-soft" : "border-line-strong bg-canvas"
          }`}
        >
          <p className="m-0 text-title-sm font-semibold text-ink">{t("drop")}</p>
          <p className="m-0 text-label text-muted">{t("or")}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" shape="pill" onClick={() => folderInput.current?.click()}>
              <FolderOpen aria-hidden="true" />
              {t("chooseFolder")}
            </Button>
            <Button variant="secondary" shape="pill" onClick={() => photosInput.current?.click()}>
              <Images aria-hidden="true" />
              {t("choosePhotos")}
            </Button>
          </div>
          <p className="m-0 max-w-140 text-caption text-muted">{t("rules")}</p>
          <input
            ref={folderInput}
            type="file"
            hidden
            multiple
            // A whole folder, read with its subfolders (Chrome, Edge, Firefox and Safari).
            {...({ webkitdirectory: "" } as Record<string, string>)}
            onChange={(e) => {
              start(filesFromInput(e.target.files));
              e.target.value = "";
            }}
          />
          <input
            ref={photosInput}
            type="file"
            hidden
            multiple
            accept="image/jpeg,.jpg,.jpeg"
            onChange={(e) => {
              start(filesFromInput(e.target.files));
              e.target.value = "";
            }}
          />
        </section>

        <p role="status" className="m-0 text-sm text-muted empty:hidden">
          {notice}
        </p>
        {/* Polite and rate-limited: progress is read out every few seconds at most (D91). */}
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <SoonTools />

        {runs.length > 0 ? (
          <ul aria-label={t("title")} className="m-0 list-none p-0">
            {runs.map((r, i) => {
              const p = r.progress;
              const pct = p.total
                ? Math.round(((p.uploaded + p.failed + p.duplicates) / p.total) * 100)
                : 100;
              const why = problem(p.problem);
              return (
                <CardRow key={r.id} asChild>
                  <li className="flex-wrap py-3">
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className="font-semibold text-ink">{t("batch", { n: i + 1 })}</span>
                        <span className="text-muted">
                          {p.phase === "checking"
                            ? t("checking", { checked: p.checked, total: p.total })
                            : t(p.phase === "done" ? "done" : "progress", {
                                uploaded: p.uploaded,
                                total: p.total,
                                failed: p.failed,
                                duplicates: p.duplicates,
                              })}
                        </span>
                        {p.phase === "offline" ? (
                          <span className="font-semibold text-warning-text">{t("offline")}</span>
                        ) : null}
                        {p.phase === "finishing" ? (
                          <span className="text-muted">{t("finishing")}</span>
                        ) : null}
                        {p.phase === "stopped" ? (
                          <span className="font-semibold text-danger">{why ?? t("stopped")}</span>
                        ) : null}
                      </span>
                      <span
                        role="progressbar"
                        aria-label={t("batch", { n: i + 1 })}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pct}
                        className="block h-2 overflow-hidden rounded-full bg-subtle"
                      >
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      {p.skipped > 0 ? (
                        <span className="text-caption text-muted">
                          {t("skipped", { count: p.skipped })}
                        </span>
                      ) : null}
                    </span>
                    {isActive(r) ? (
                      <Button variant="secondary" shape="pill" onClick={() => void r.run.cancel()}>
                        <Square aria-hidden="true" />
                        {t("stop")}
                      </Button>
                    ) : null}
                    {!isActive(r) && r.run.failed().length > 0 ? (
                      <Button
                        variant="secondary"
                        shape="pill"
                        onClick={() => start(r.run.failed())}
                      >
                        <RotateCcw aria-hidden="true" />
                        {t("retry")}
                      </Button>
                    ) : null}
                  </li>
                </CardRow>
              );
            })}
          </ul>
        ) : null}
      </section>
    </Card>
  );
}

const SELECT =
  "min-h-11 max-w-80 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** Other ways to upload (C14): listed, marked Soon, not available; in the tab order so they are heard (D91). */
function SoonTools() {
  const t = useTranslations("app.photos.uploader.tools");
  const tools = ["desktop", "ftp", "lightroom", "folderPerGroup"] as const;
  return (
    <section aria-label={t("label")} className="flex flex-col gap-1">
      <h3 className="m-0 text-label font-semibold text-muted">{t("label")}</h3>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-1 p-0">
        {tools.map((tool) => (
          <li key={tool}>
            <button
              type="button"
              aria-disabled="true"
              className={`${MENU_ROW} cursor-default text-muted hover:bg-transparent`}
            >
              <span className="flex-1">{t(tool)}</span>{" "}
              <span className="rounded-full border border-line-strong px-2 text-micro text-muted">
                {t("soon")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Warns before leaving the page while an upload runs (the server keeps what arrived; dropping again resumes). */
export function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}
