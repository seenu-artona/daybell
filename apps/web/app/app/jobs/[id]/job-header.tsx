"use client";

import type { StudioPayoutsResponse } from "@daybell/api";
import { payoutsConnected } from "@daybell/core";
import { Button, IconButton, iconButtonVariants } from "@daybell/ui";
import { ArrowLeft, Ellipsis, Pencil } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { Dialog } from "../../dialog";
import { useStudio } from "../../me-context";
import { MENU_ROW, Popover } from "../../popover";
import { JobForm } from "../job-form";
import { StatusBadge, useFormatDay } from "../status-badge";
import { useJob } from "./job-context";
import { SellChecklist } from "./sell-checklist";

/**
 * The job's title row (D137, D140), on the canvas with no white block: a round back button, the job's name and status
 * (not clickable) with its details under the name, then a round More (⋯) and the page's one green button, "Start
 * selling", while the job is a draft. Selling itself arrives in step 8; for now the button lists what is still
 * missing and is never disabled.
 */
export function JobHeader() {
  const t = useTranslations("app.job");
  const tj = useTranslations("app.jobs");
  const formatDay = useFormatDay();
  const { changed } = useStudio();
  const { job, setJob, summary, canManage, taggingReviewed } = useJob();
  const [editing, setEditing] = useState(false);
  const [selling, setSelling] = useState(false);
  const [saved, setSaved] = useState(false);
  // "Payouts connected" (ADR 0020): read each time the dialog opens; undefined while it's being checked, so the item
  // says "Checking…" rather than a state it may not be in. The same for every studio (Seenu, Oct 12): where payouts
  // aren't offered (the API refuses), it is simply not connected.
  const [payouts, setPayouts] = useState<boolean | undefined>(undefined);
  // Which opening of the dialog a reply belongs to: one that arrives after the dialog closed (or reopened) is ignored.
  const opening = useRef(0);

  function openSelling() {
    const current = ++opening.current;
    setPayouts(undefined);
    setSelling(true);
    void api<StudioPayoutsResponse>("/studio/payouts").then((res) => {
      if (opening.current !== current) return;
      setPayouts(res.ok ? payoutsConnected(res.data.account?.status) : false);
    });
  }

  function closeSelling() {
    opening.current += 1;
    setSelling(false);
  }

  const details = [
    tj(`types.${job.type}`),
    job.client?.name ?? null,
    formatDay(job.pictureDay),
    job.internalNumber,
  ].filter(Boolean);

  return (
    <header className="flex items-center gap-3">
      <IconButton asChild label={tj("detail.back")}>
        <Link href="/app/jobs">
          <ArrowLeft aria-hidden="true" />
        </Link>
      </IconButton>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h1 className="m-0 text-h2 break-words">{job.name}</h1>
          <StatusBadge status={job.status} />
        </div>
        <p className="m-0 text-label text-muted">{details.join(" · ")}</p>
        {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3). */}
        <p role="status" className="m-0 min-h-5 text-caption text-muted">
          {saved ? tj("detail.saved") : ""}
        </p>
      </div>
      {canManage ? (
        <div className="flex shrink-0 items-center gap-2">
          <Popover
            label={t("moreActions")}
            trigger={<Ellipsis aria-hidden="true" />}
            triggerClassName={iconButtonVariants()}
            panelClassName="w-56"
          >
            {(close) => (
              <button
                type="button"
                className={MENU_ROW}
                onClick={() => {
                  close();
                  setSaved(false);
                  setEditing(true);
                }}
              >
                <Pencil aria-hidden="true" />
                {tj("detail.edit")}
              </button>
            )}
          </Popover>
          {job.status === "draft" ? (
            <Button shape="pill" onClick={openSelling}>
              {t("startSelling")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog open={editing} onClose={() => setEditing(false)} title={tj("form.editTitle")}>
        <JobForm
          job={job}
          onCancel={() => setEditing(false)}
          onSaved={(next) => {
            setJob(next);
            setEditing(false);
            setSaved(true);
            changed();
          }}
        />
      </Dialog>

      <Dialog open={selling} onClose={closeSelling} title={t("checklist.title")}>
        <div className="flex flex-col gap-4">
          <p className="m-0 text-muted">{t("sellIntro")}</p>
          <SellChecklist
            roster={summary?.children ?? 0}
            taggingReviewed={taggingReviewed}
            hasPriceList={Boolean(job.priceListId)}
            payoutsConnected={payouts}
          />
          <div className="flex justify-end">
            <Button variant="secondary" onClick={closeSelling}>
              {t("close")}
            </Button>
          </div>
        </div>
      </Dialog>
    </header>
  );
}
