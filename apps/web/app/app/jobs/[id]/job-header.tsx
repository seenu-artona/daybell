"use client";

import type { Job, PriceListResponse, StudioPayoutsResponse } from "@daybell/api";
import { payoutsConnected, type SellChecklistKey } from "@daybell/core";
import { Button, ConfettiBurst, IconButton, iconButtonVariants } from "@daybell/ui";
import { ArrowLeft, CalendarClock, Ellipsis, Pencil } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog } from "../../dialog";
import { useStudio } from "../../me-context";
import { MENU_ROW, Popover } from "../../popover";
import {
  ClosingDateField,
  closesAtFor,
  closingFieldValue,
  useFormatClosing,
} from "../closing-date";
import { JobForm } from "../job-form";
import { StatusBadge, useFormatDay } from "../status-badge";
import {
  blockersFromFields,
  closingDatePassed,
  jobConflictKey,
  readyToSell,
  sellItems,
  shopAction,
  shopChangedElsewhere,
} from "./going-live";
import { useJob } from "./job-context";
import { SellChecklist } from "./sell-checklist";

type Open = "edit" | "sell" | "closeShop" | "closingDate" | null;

/**
 * The job's title row (D137, D140), on the canvas with no white block: a round back button, the job's name and its shop
 * state (Draft, Selling or Closed; not clickable) with its details under the name, then a round More (⋯) and the page's
 * one pill for owners and admins (ADR 0021): "Start selling" on a draft (the "Before you can sell" dialog; the server
 * checks everything again), "Close shop" while selling (after a confirm), "Reopen shop" once closed (the same checks).
 * Going live bursts confetti (D75; none with reduced motion) and is announced in words. Photographers and staff see the
 * state only.
 */
export function JobHeader() {
  const t = useTranslations("app.job");
  const tj = useTranslations("app.jobs");
  const text = useApiText();
  const formatDay = useFormatDay();
  const formatClosing = useFormatClosing();
  const router = useRouter();
  const pathname = usePathname();
  const { changed } = useStudio();
  const { job, setJob, summary, canManage, taggingReviewed } = useJob();
  const [open, setOpen] = useState<Open>(null);
  const [announcement, setAnnouncement] = useState("");
  // "Payouts connected" and "Price list chosen" (an item on the list, A2): read each time the dialog opens; undefined
  // while being checked, so the rows say "Checking…" rather than a state they may not be in.
  const [payouts, setPayouts] = useState<boolean | undefined>(undefined);
  const [hasItems, setHasItems] = useState<boolean | undefined>(undefined);
  // The server's own list after it refused (409): it wins over what the page knew.
  const [blockers, setBlockers] = useState<SellChecklistKey[] | null>(null);
  const [dialogStatus, setDialogStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [confetti, setConfetti] = useState(false);
  const [focusHeading, setFocusHeading] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  // After a refusal the dialog's footer can change (Cancel + Start selling become Close): focus goes to its last
  // button rather than falling to the page (WCAG 2.4.3; code review M3).
  const [focusFooter, setFocusFooter] = useState(false);
  const sellFooter = useRef<HTMLDivElement>(null);
  const closeFooter = useRef<HTMLDivElement>(null);
  // Which opening of the dialog a reply belongs to: one that arrives after the dialog closed (or reopened) is ignored.
  const opening = useRef(0);
  const action = shopAction(job.status);

  function openSelling() {
    const current = ++opening.current;
    setPayouts(undefined);
    setHasItems(undefined);
    setBlockers(null);
    setDialogStatus("");
    setOpen("sell");
    void api<StudioPayoutsResponse>("/studio/payouts").then((res) => {
      if (opening.current !== current) return;
      setPayouts(res.ok ? payoutsConnected(res.data.account?.status) : false);
    });
    void api<PriceListResponse>(`/price-lists/${encodeURIComponent(job.priceListId)}`).then(
      (res) => {
        if (opening.current !== current) return;
        setHasItems(res.ok ? res.data.priceList.items.length > 0 : false);
      },
    );
  }

  function closeDialog() {
    opening.current += 1;
    setOpen(null);
  }

  // ?sell=1 (the checklist's and Up next's Start selling link) opens the dialog, then leaves the address. The header
  // stays mounted across the job's pages, so it follows the address rather than reading it once.
  const sellParam = useSearchParams().get("sell");
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the parameter's arrival matters.
  useEffect(() => {
    if (sellParam !== "1") return;
    if (canManage && action !== "close") openSelling();
    router.replace(pathname, { scroll: false });
  }, [sellParam]);

  // The pill that opened the dialog is gone once the state changes: focus goes to the job's name instead.
  useEffect(() => {
    if (!focusHeading || open !== null) return;
    heading.current?.focus();
    setFocusHeading(false);
  }, [focusHeading, open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once the refused dialog has re-rendered.
  useEffect(() => {
    if (!focusFooter) return;
    setFocusFooter(false);
    const footer = open === "sell" ? sellFooter.current : closeFooter.current;
    const buttons = footer?.querySelectorAll<HTMLButtonElement>("button");
    buttons?.[buttons.length - 1]?.focus();
  }, [focusFooter, blockers]);

  /** Runs one state change; true when it worked. Never twice at once; nothing is disabled meanwhile (D91). */
  async function changeStatus(path: "start-selling" | "close" | "reopen"): Promise<Job | null> {
    if (working.current) return null;
    working.current = true;
    setBusy(true);
    setDialogStatus("");
    const res = await api<{ job: Job }>(`/jobs/${job.id}/${path}`, { method: "POST" });
    working.current = false;
    setBusy(false);
    if (res.ok) return res.data.job;
    const conflict = jobConflictKey(res.fields.form);
    const message = conflict ? t(`conflicts.${conflict}`) : text.error(res.code);
    if (shopChangedElsewhere(conflict)) {
      // Someone else (or the jobs cron) moved the shop on: show it as it is now and say why (code review S1).
      const fresh = await api<{ job: Job }>(`/jobs/${job.id}`);
      if (fresh.ok) {
        setJob(fresh.data.job);
        closeDialog();
        setFocusHeading(true);
        setAnnouncement(message);
        changed();
        return null;
      }
    }
    if (conflict === "notReady") setBlockers(blockersFromFields(res.fields));
    setDialogStatus(message);
    setFocusFooter(true);
    return null;
  }

  async function goLive() {
    const reopening = action === "reopen";
    const next = await changeStatus(reopening ? "reopen" : "start-selling");
    if (!next) return;
    setJob(next);
    closeDialog();
    setFocusHeading(true);
    setAnnouncement(t(reopening ? "reopened" : "live", { job: next.name }));
    // Confetti for the moment a job first goes live (D75, Claude's call 6).
    if (!reopening) setConfetti(true);
    changed();
  }

  async function closeShop() {
    const next = await changeStatus("close");
    if (!next) return;
    setJob(next);
    closeDialog();
    setFocusHeading(true);
    setAnnouncement(t("closedNow", { job: next.name }));
    changed();
  }

  const details = [
    tj(`types.${job.type}`),
    job.client?.name ?? null,
    formatDay(job.pictureDay),
    job.internalNumber,
    job.closesAt
      ? t(closingDatePassed(job, Date.now()) ? "closing.linePassed" : "closing.line", {
          when: formatClosing(job.closesAt),
        })
      : null,
  ].filter(Boolean);

  // Until the job's summary has loaded, the roster and photos rows say "Checking…" (code review S4).
  const items = sellItems(
    {
      children: summary ? summary.children : undefined,
      hasReadyPhoto: summary ? (summary.photos?.ready ?? 0) > 0 : undefined,
      taggingReviewed,
      hasPriceList: hasItems,
      payoutsConnected: payouts,
    },
    blockers,
  );
  const ready = readyToSell(items);
  const reopening = action === "reopen";

  return (
    <header className="flex items-center gap-3">
      <IconButton asChild label={tj("detail.back")}>
        <Link href="/app/jobs">
          <ArrowLeft aria-hidden="true" />
        </Link>
      </IconButton>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h1
            ref={heading}
            tabIndex={-1}
            className="m-0 text-h2 break-words focus-visible:outline-2 focus-visible:outline-primary"
          >
            {job.name}
          </h1>
          <StatusBadge status={job.status} />
        </div>
        <p className="m-0 text-label text-muted">{details.join(" · ")}</p>
        {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3). */}
        <p role="status" className="m-0 min-h-5 text-caption text-muted">
          {announcement}
        </p>
      </div>
      {canManage ? (
        <div className="flex shrink-0 items-center gap-2">
          <Popover
            label={t("moreActions")}
            trigger={<Ellipsis aria-hidden="true" />}
            triggerClassName={iconButtonVariants()}
            panelClassName="w-60"
          >
            {(close) => (
              <>
                <button
                  type="button"
                  className={MENU_ROW}
                  onClick={() => {
                    close();
                    setAnnouncement("");
                    setOpen("edit");
                  }}
                >
                  <Pencil aria-hidden="true" />
                  {tj("detail.edit")}
                </button>
                {job.status === "closed" ? null : (
                  <button
                    type="button"
                    className={MENU_ROW}
                    onClick={() => {
                      close();
                      setAnnouncement("");
                      setOpen("closingDate");
                    }}
                  >
                    <CalendarClock aria-hidden="true" />
                    {t("closing.menu")}
                  </button>
                )}
              </>
            )}
          </Popover>
          {action === "start" ? (
            <Button shape="pill" onClick={openSelling}>
              {t("startSelling")}
            </Button>
          ) : action === "close" ? (
            <Button
              shape="pill"
              variant="secondary"
              onClick={() => {
                setDialogStatus("");
                setOpen("closeShop");
              }}
            >
              {t("closeShop")}
            </Button>
          ) : (
            <Button shape="pill" onClick={openSelling}>
              {t("reopenShop")}
            </Button>
          )}
        </div>
      ) : null}

      <Dialog open={open === "edit"} onClose={closeDialog} title={tj("form.editTitle")}>
        <JobForm
          job={job}
          onCancel={closeDialog}
          onSaved={(next) => {
            setJob(next);
            closeDialog();
            setAnnouncement(tj("detail.saved"));
            changed();
          }}
        />
      </Dialog>

      <Dialog
        open={open === "sell"}
        onClose={closeDialog}
        title={reopening ? t("reopenTitle") : t("checklist.title")}
      >
        <div className="flex flex-col gap-4" aria-busy={busy}>
          <p className="m-0 text-muted">
            {ready
              ? t(reopening ? "reopenReady" : "readyIntro")
              : t(reopening ? "reopenIntro" : "sellIntro")}
          </p>
          <SellChecklist items={items} />
          <p role="status" className="m-0 text-sm font-semibold text-ink empty:sr-only">
            {dialogStatus}
          </p>
          <div ref={sellFooter} className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            {ready ? (
              <>
                <Button variant="secondary" onClick={closeDialog}>
                  {t("cancel")}
                </Button>
                <Button onClick={() => void goLive()}>
                  {reopening ? t("reopenShop") : t("startSelling")}
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={closeDialog}>
                {t("close")}
              </Button>
            )}
          </div>
        </div>
      </Dialog>

      <Dialog open={open === "closeShop"} onClose={closeDialog} title={t("closeDialog.title")}>
        <div className="flex flex-col gap-4" aria-busy={busy}>
          <p className="m-0">{t("closeDialog.body")}</p>
          <p role="status" className="m-0 text-sm font-semibold text-ink empty:sr-only">
            {dialogStatus}
          </p>
          <div ref={closeFooter} className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={closeDialog}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void closeShop()}>{t("closeDialog.confirm")}</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={open === "closingDate"} onClose={closeDialog} title={t("closing.title")}>
        <ClosingDateForm
          job={job}
          onCancel={closeDialog}
          onSaved={(next, removed) => {
            setJob(next);
            closeDialog();
            setAnnouncement(t(removed ? "closing.removed" : "closing.saved"));
            changed();
          }}
        />
      </Dialog>

      {confetti ? <ConfettiBurst onDone={() => setConfetti(false)} /> : null}
    </header>
  );
}

/** The ⋯ menu's "Set closing date": the last day to order, or remove it (ADR 0021). */
function ClosingDateForm({
  job,
  onCancel,
  onSaved,
}: {
  job: Job;
  onCancel: () => void;
  onSaved: (job: Job, removed: boolean) => void;
}) {
  const t = useTranslations("app.job");
  const text = useApiText();
  const [day, setDay] = useState(closingFieldValue(job.closesAt));
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState("");
  const saving = useRef(false);

  async function save(closesAt: string | null) {
    if (saving.current) return;
    saving.current = true;
    setError(undefined);
    setProblem("");
    const res = await api<{ job: Job }>(`/jobs/${job.id}`, { method: "PATCH", body: { closesAt } });
    saving.current = false;
    if (res.ok) return onSaved(res.data.job, closesAt === null);
    if (res.fields.closesAt) return setError(text.field(res.fields.closesAt));
    const conflict = jobConflictKey(res.fields.form);
    setProblem(conflict ? t(`conflicts.${conflict}`) : text.error(res.code));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!day) return setError(text.field("validation.closesAt"));
    void save(closesAtFor(day));
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <ClosingDateField value={day} onChange={setDay} error={error} />
      <p role="status" className="m-0 text-sm font-semibold text-ink empty:sr-only">
        {problem}
      </p>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {job.closesAt ? (
          <Button variant="secondary" onClick={() => void save(null)}>
            {t("closing.remove")}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit">{t("closing.save")}</Button>
      </div>
    </form>
  );
}
