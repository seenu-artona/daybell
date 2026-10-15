"use client";

import type {
  ChildFactsResponse,
  Job,
  OrdersResponse,
  RosterChild,
  StudioOrder,
  TaggedPhoto,
  TaggedPhotosResponse,
} from "@daybell/api";
import { closingDay, formatOrderReference, type GroupLabel, maskEmail } from "@daybell/core";
import { Badge, IconButton, iconButtonVariants } from "@daybell/ui";
import { Ellipsis, Maximize2, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { OrderStatusBadge, orderMoney } from "../../../orders/order-badges";
import { MENU_ROW, Popover } from "../../../popover";
import { tabHref } from "../tabs";
import { OrderedPill } from "./people-list";

const LINK =
  "inline-flex min-h-11 items-center text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/** A section of the record: a small heading with a hairline under it and an optional link at its right. */
function Part({ title, link, children }: { title: string; link?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <div className="mb-3 flex min-h-11 items-center justify-between border-b border-line-canvas pb-1">
        <h3 id={id} className="m-0 text-body-lg font-bold text-ink">
          {title}
        </h3>
        {link}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 pb-4">
      <dt className="text-label font-normal text-muted">{label}</dt>
      <dd className="m-0 text-title-sm font-semibold break-words text-ink">{value}</dd>
    </div>
  );
}

/**
 * One person on a job's Subjects (D153; ADR 0029), beside the folded list: their name with their class and Ordered
 * pill, Edit (roster editors), ⋯ (Remove, while the job is a draft) and the button back to the full list. Photos (with
 * Add photos for roster editors) and Orders (people who see orders; GET /orders?childId=, in Montréal like /orders) on
 * the left; Details (Class, Grade when there is one, Student ID, the parent's email masked like p•••@gmail.com, and
 * when they were photographed) and their QR card (access code, when it was first printed, Print again) on the right.
 * Only ids go in addresses (D113).
 */
export function PersonRecord({
  child,
  job,
  word,
  canEdit,
  seesOrders,
  focusKey,
  printedKey,
  onUnfold,
  onEdit,
  onRemove,
  onPrintCard,
}: {
  child: RosterChild;
  job: Job;
  word: GroupLabel;
  canEdit: boolean;
  seesOrders: boolean;
  /** Set when the person was just opened from the list: focus moves to their name. */
  focusKey: string | null;
  /** Changes after a print of the job's cards (the Print dialog), so the card's Printed date is read again. */
  printedKey: number;
  onUnfold: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onPrintCard: () => Promise<void>;
}) {
  const t = useTranslations("app.people.record");
  const tr = useTranslations("app.roster");
  const format = useFormatter();
  const name = `${child.firstName} ${child.lastName}`;
  const heading = useRef<HTMLHeadingElement>(null);
  const [facts, setFacts] = useState<ChildFactsResponse["facts"] | null>(null);
  const [photos, setPhotos] = useState<TaggedPhoto[] | null | "failed">(null);
  const [orders, setOrders] = useState<StudioOrder[] | null | "failed">(null);
  const [printing, setPrinting] = useState(false);
  // Read again after a print here (onPrintCard) or of the whole job (printedKey).
  const [factsKey, setFactsKey] = useState(0);
  const draft = job.status === "draft";
  const day = (value: string) =>
    format.dateTime(
      new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value),
      /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }
        : { weekday: "short", month: "short", day: "numeric" },
    );

  useEffect(() => {
    if (focusKey) heading.current?.focus();
  }, [focusKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the keys and updatedAt say the facts may have changed.
  useEffect(() => {
    let live = true;
    void api<ChildFactsResponse>(`/children/${encodeURIComponent(child.id)}/facts`).then((res) => {
      if (live) setFacts(res.ok ? res.data.facts : null);
    });
    return () => {
      live = false;
    };
  }, [child.id, child.updatedAt, factsKey, printedKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: updatedAt and the photo count say the person changed.
  useEffect(() => {
    let live = true;
    const id = encodeURIComponent(child.id);
    void api<TaggedPhotosResponse>(
      `/jobs/${encodeURIComponent(job.id)}/tagging/photos?place=child&id=${id}&limit=12`,
    ).then((res) => {
      if (live) setPhotos(res.ok ? res.data.photos : "failed");
    });
    if (seesOrders)
      void api<OrdersResponse>(`/orders?childId=${id}&limit=20`).then((res) => {
        if (live) setOrders(res.ok ? res.data.orders : "failed");
      });
    return () => {
      live = false;
    };
  }, [child.id, child.updatedAt, child.photoCount, job.id, seesOrders]);

  const closes = job.status === "selling" && job.closesAt ? day(closingDay(job.closesAt)) : null;

  return (
    // Escape inside the record goes back to the full list, as the floating panel's did (ADR 0025).
    <div
      className="flex flex-col gap-5.5 px-7 py-5.5"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        if ((e.target as HTMLElement).closest("dialog, [aria-expanded='true']")) return;
        e.preventDefault();
        onUnfold();
      }}
    >
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <h2
            ref={heading}
            tabIndex={-1}
            className="m-0 text-h2 break-words text-ink focus-visible:outline-2 focus-visible:outline-primary"
          >
            {name}
          </h2>
          <p className="m-0 mt-0.5 flex flex-wrap items-center gap-2 text-body text-muted">
            <span>{child.group?.name ?? tr("noGroup", { group: word })}</span>
            {seesOrders ? (
              <>
                <span aria-hidden="true">·</span>
                <OrderedPill hasPaidOrder={child.hasPaidOrder} />
              </>
            ) : null}
            {child.doNotPhotograph ? (
              <Badge tone="danger" className="rounded-sm before:hidden">
                {tr("badges.doNotPhotograph")}
              </Badge>
            ) : null}
            {child.doNotPublish ? (
              <Badge tone="draft" className="rounded-sm before:hidden">
                {tr("badges.doNotPublish")}
              </Badge>
            ) : null}
            {child.duplicate ? (
              <Badge tone="warning" className="rounded-sm before:hidden">
                {t("possibleDuplicate")}
              </Badge>
            ) : null}
          </p>
        </div>
        {canEdit ? (
          <IconButton label={t("edit", { name })} tone="canvas" onClick={onEdit}>
            <Pencil aria-hidden="true" />
          </IconButton>
        ) : null}
        {canEdit && draft ? (
          <Popover
            label={t("moreActions", { name })}
            trigger={<Ellipsis aria-hidden="true" />}
            triggerClassName={iconButtonVariants({ tone: "canvas" })}
            panelClassName="w-56"
          >
            {(close) => (
              <button
                type="button"
                className={`${MENU_ROW} text-danger [&_svg]:text-danger`}
                onClick={() => {
                  close();
                  onRemove();
                }}
              >
                <Trash2 aria-hidden="true" />
                {tr("form.remove")}
              </button>
            )}
          </Popover>
        ) : null}
        <IconButton label={t("unfold")} onClick={onUnfold} className="bg-canvas">
          <Maximize2 aria-hidden="true" />
        </IconButton>
      </div>

      <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-x-11">
        <div className="flex flex-col gap-6.5">
          <Part
            title={t("photos")}
            link={
              canEdit ? (
                <Link href={tabHref(job.id, "photos")} className={LINK}>
                  {t("addPhotos")}
                </Link>
              ) : null
            }
          >
            {photos === null ? (
              <p className="m-0 text-muted">{t("loading")}</p>
            ) : photos === "failed" ? (
              <p className="m-0 text-muted">{t("photosUnavailable")}</p>
            ) : photos.length === 0 ? (
              <p className="m-0 text-muted">{t("noPhotos")}</p>
            ) : (
              <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">
                {photos.map((photo, i) => (
                  <li key={photo.id} className="h-37 w-29.5 overflow-hidden rounded-md bg-subtle">
                    {photo.thumbUrl ? (
                      // biome-ignore lint/performance/noImgElement: signed, short-lived storage URLs; no image optimiser in between (D113).
                      <img
                        src={photo.thumbUrl}
                        alt={t("photoAlt", { number: i + 1, name })}
                        className="size-full object-cover"
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Part>
          {seesOrders ? (
            <Part title={t("orders")}>
              {orders === null ? (
                <p className="m-0 text-muted">{t("loading")}</p>
              ) : orders === "failed" ? (
                <p className="m-0 text-muted">{t("ordersUnavailable")}</p>
              ) : orders.length === 0 ? (
                <p className="m-0 text-body text-muted">
                  {closes ? t("noOrdersCloses", { date: closes }) : t("noOrders")}
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col p-0">
                  {orders.map((order) => (
                    <li
                      key={order.id}
                      className="flex min-h-12 items-center gap-3 border-b border-line last:border-b-0"
                    >
                      <Link
                        href={`/app/orders/${order.id}`}
                        className="inline-flex min-h-11 items-center font-mono font-bold text-ink no-underline hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        {formatOrderReference(order.reference)}
                      </Link>
                      <span className="text-body text-muted">{day(order.paidAt)}</span>
                      <span className="ml-auto tabular-nums">{orderMoney(order.total)}</span>
                      <OrderStatusBadge status={order.fulfilment} />
                    </li>
                  ))}
                </ul>
              )}
            </Part>
          ) : null}
        </div>
        <div className="flex flex-col gap-6.5">
          <Part title={t("details")}>
            <dl className="m-0">
              <Row
                label={tr("columns.group", { group: word })}
                value={child.group?.name ?? tr("noGroup", { group: word })}
              />
              {child.grade ? <Row label={tr("columns.grade")} value={child.grade} /> : null}
              <Row label={tr("columns.studentId")} value={child.studentId ?? t("none")} />
              <Row
                label={t("parentEmail")}
                value={child.parentEmail ? maskEmail(child.parentEmail) : t("none")}
              />
              {facts?.photographedAt ? (
                <Row label={t("photographed")} value={day(facts.photographedAt)} />
              ) : null}
            </dl>
          </Part>
          <Part
            title={t("qrCard")}
            link={
              canEdit && !child.doNotPhotograph ? (
                <button
                  type="button"
                  // aria-disabled, not disabled: focus stays on the button while the card downloads.
                  aria-disabled={printing || undefined}
                  className={`${LINK} aria-disabled:opacity-60`}
                  onClick={async () => {
                    if (printing) return;
                    setPrinting(true);
                    await onPrintCard();
                    setPrinting(false);
                    setFactsKey((k) => k + 1);
                  }}
                >
                  {facts?.cardPrintedAt ? t("printAgain") : t("printCard")}
                </button>
              ) : null
            }
          >
            {child.doNotPhotograph ? (
              <p className="m-0 text-body text-muted">{t("noCard")}</p>
            ) : (
              <dl className="m-0">
                <Row
                  label={tr("columns.accessCode")}
                  value={
                    child.accessCode ? (
                      <span className="font-mono tracking-wider">{child.accessCode}</span>
                    ) : (
                      tr("codeUnavailable")
                    )
                  }
                />
                {facts?.cardPrintedAt ? (
                  <Row label={t("printed")} value={day(facts.cardPrintedAt)} />
                ) : null}
              </dl>
            )}
          </Part>
        </div>
      </div>
    </div>
  );
}
