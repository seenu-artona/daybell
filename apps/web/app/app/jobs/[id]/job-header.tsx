"use client";

import type { Job, PriceListResponse, StudioPayoutsResponse } from "@daybell/api";
import { payoutsConnected, type SellChecklistKey } from "@daybell/core";
import {
  Button,
  buttonVariants,
  ConfettiBurst,
  IconButton,
  iconButtonVariants,
  PageHeader,
} from "@daybell/ui";
import { ArrowLeft, Camera, Ellipsis, Eye, History, Lock, Pencil, RotateCcw } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { ActivityCard } from "../../activity-card";
import { Dialog } from "../../dialog";
import { useStudio } from "../../me-context";
import { MENU_ROW, Popover } from "../../popover";
import { JobForm } from "../job-form";
import { StatusBadge } from "../status-badge";
import {
  blockersFromFields,
  jobConflictKey,
  readyToSell,
  sellItems,
  shopAction,
  shopChangedElsewhere,
} from "./going-live";
import { useJob } from "./job-context";
import { SellChecklist } from "./sell-checklist";

type Open = "edit" | "sell" | "closeShop" | "history" | null;

/**
 * The job's title row in the D151 blueprint (D152; ADR 0029, amending ADR 0021 and 0025): back, the job's name and its
 * shop state (Draft, Selling or Closed: the only place status shows), no details line, then ⋯ More and at most one
 * green action. A draft's green action is "Publish shop" (owners and admins: the "Before you can sell" dialog; the
 * server checks everything again); a selling job's is "View shop" (the parent shop, in a new tab, for everyone); a
 * closed job has none. ⋯ More (owners and admins): Preview as a parent and View as photographer (Soon), Edit job,
 * Close shop or Reopen shop, and History (the job's activity). Going live bursts confetti (D75; none with reduced
 * motion) and is announced in words.
 */
export function JobHeader({ stuck = false }: { stuck?: boolean }) {
  const t = useTranslations("app.job");
  const tj = useTranslations("app.jobs");
  const text = useApiText();
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

  const menuOpen = (next: Open) => {
    setAnnouncement("");
    if (next === "closeShop") setDialogStatus("");
    setOpen(next);
  };
  // Sections not built yet are listed, marked Soon, and can't be chosen (D152; Seenu).
  const soonRow = (label: string, icon: ReactNode) => (
    // aria-disabled, not disabled: it stays in the tab order so people hear that it is coming (D91).
    <button
      type="button"
      aria-disabled="true"
      className={`${MENU_ROW} cursor-default text-muted hover:bg-transparent`}
    >
      {icon}
      <span className="flex-1">{label}</span>{" "}
      <span className="rounded-full border border-line-strong px-2 text-micro text-muted">
        {t("soon")}
      </span>
    </button>
  );

  const primary =
    action === "start" && canManage ? (
      <Button shape="pill" onClick={openSelling}>
        {t("publishShop")}
      </Button>
    ) : job.status === "selling" ? (
      <a
        href="/shop"
        target="_blank"
        rel="noopener"
        className={`${buttonVariants({ shape: "pill" })} no-underline`}
      >
        {t("viewShop")}
        <span className="sr-only"> {t("newTab")}</span>
      </a>
    ) : null;

  return (
    <>
      <PageHeader
        variant="record"
        title={job.name}
        headingRef={heading}
        back={
          <IconButton asChild label={tj("detail.back")}>
            {/* While the tab row is stuck it has its own back link; this one, above the window, steps aside. */}
            <Link
              href="/app/jobs"
              aria-hidden={stuck || undefined}
              tabIndex={stuck ? -1 : undefined}
            >
              <ArrowLeft aria-hidden="true" />
            </Link>
          </IconButton>
        }
        status={<StatusBadge status={job.status} />}
        actions={
          <>
            {canManage ? (
              <Popover
                label={t("moreActions")}
                trigger={<Ellipsis aria-hidden="true" />}
                triggerClassName={iconButtonVariants()}
                panelClassName="w-64"
              >
                {(close) => (
                  <>
                    {soonRow(t("more.previewParent"), <Eye aria-hidden="true" />)}
                    {soonRow(t("more.viewPhotographer"), <Camera aria-hidden="true" />)}
                    <button
                      type="button"
                      className={MENU_ROW}
                      onClick={() => {
                        close();
                        menuOpen("edit");
                      }}
                    >
                      <Pencil aria-hidden="true" />
                      {tj("detail.edit")}
                    </button>
                    {action === "close" ? (
                      <button
                        type="button"
                        className={MENU_ROW}
                        onClick={() => {
                          close();
                          menuOpen("closeShop");
                        }}
                      >
                        <Lock aria-hidden="true" />
                        {t("closeShop")}
                      </button>
                    ) : action === "reopen" ? (
                      <button
                        type="button"
                        className={MENU_ROW}
                        onClick={() => {
                          close();
                          setAnnouncement("");
                          openSelling();
                        }}
                      >
                        <RotateCcw aria-hidden="true" />
                        {t("reopenShop")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={MENU_ROW}
                      onClick={() => {
                        close();
                        menuOpen("history");
                      }}
                    >
                      <History aria-hidden="true" />
                      {t("more.history")}
                    </button>
                  </>
                )}
              </Popover>
            ) : null}
            {primary}
          </>
        }
      >
        {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3). */}
        <p role="status" className="m-0 min-h-5 text-caption text-muted">
          {announcement}
        </p>
      </PageHeader>

      <Dialog open={open === "history"} onClose={closeDialog} title={t("more.history")}>
        <div className="flex flex-col gap-3">
          <ActivityCard refreshKey={0} jobId={job.id} />
          <p className="m-0 text-sm text-muted">{t("more.commentsSoon")}</p>
        </div>
      </Dialog>

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
                  {reopening ? t("reopenShop") : t("publishShop")}
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

      {confetti ? <ConfettiBurst onDone={() => setConfetti(false)} /> : null}
    </>
  );
}
