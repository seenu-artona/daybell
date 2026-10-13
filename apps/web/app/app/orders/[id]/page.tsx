"use client";

import type { OrderResponse, Refund, StudioOrderDetail } from "@daybell/api";
import { SHOP_CONFLICTS } from "@daybell/api";
import { canFulfil, canRefund, formatBasisPoints, formatOrderReference } from "@daybell/core";
import { Banner, Button, Card } from "@daybell/ui";
import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api, download } from "@/lib/client-api";
import { useStudio } from "../../me-context";
import { PageFrame } from "../../page-frame";
import { OrderBadges, orderMoney } from "../order-badges";
import { useOrderRefusal } from "../order-text";
import { FulfilmentPanel } from "./fulfilment";
import { LedgerSection } from "./ledger";
import { RefundsSection } from "./refunds";

const BACK =
  "inline-flex min-h-11 items-center gap-1.5 self-start font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/**
 * One order (ADR 0024; D25): its reference, date and badges; its progress and next step (FulfilmentPanel); its items
 * with the children's names and what was refunded; totals and fees (owners, admins and staff, Q4); where it ships, or
 * that the address was removed; Download print files; then, for owners and admins, its refunds and its money in the
 * ledger. Every change is announced in a polite status line; words come from the locale files (D96).
 */
export default function OrderPage() {
  const t = useTranslations("app.orders.detail");
  const td = useTranslations("app.orders");
  const tr = useTranslations("app.orders.detail.refundDialog");
  const ts = useTranslations("shop");
  const tx = useTranslations("app.orders.detail.externalRefund");
  const text = useApiText();
  const refusal = useOrderRefusal();
  const format = useFormatter();
  const { me } = useStudio();
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<StudioOrderDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [filesNote, setFilesNote] = useState<string | null>(null);
  const filesBusy = useRef(false);
  const checkBusy = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const itemsId = useId();
  const totalsId = useId();
  const shipId = useId();

  const load = useCallback(async () => {
    const res = await api<OrderResponse>(`/orders/${encodeURIComponent(id)}`);
    if (res.ok) {
      setOrder(res.data.order);
      setProblem(null);
    } else setProblem(res.status === 404 ? t("notFound") : text.error(res.code));
  }, [id, t, text]);

  useEffect(() => {
    void load();
  }, [load]);

  async function printFiles() {
    if (!order || filesBusy.current) return;
    filesBusy.current = true;
    setPreparing(true);
    setFilesNote(null);
    const res = await download(`/orders/${order.id}/print-files`);
    filesBusy.current = false;
    setPreparing(false);
    if (res.ok) return setFilesNote(t("printFilesStarted"));
    if (res.fields.form === SHOP_CONFLICTS.downloadPreparing)
      return setFilesNote(t("printFilesPreparing"));
    if (res.fields.form === SHOP_CONFLICTS.downloadUnavailable)
      return setFilesNote(t("printFilesUnavailable"));
    setFilesNote(text.error(res.code));
  }

  // A refund made outside Daybell, checked by an owner or admin (security review S5).
  async function checkExternalRefund() {
    if (!order || checkBusy.current) return;
    checkBusy.current = true;
    const res = await api<OrderResponse>(`/orders/${order.id}/external-refund/checked`, {
      method: "POST",
    });
    checkBusy.current = false;
    if (!res.ok) return setStatus(refusal(res));
    setOrder(res.data.order);
    setStatus(tx("saved"));
  }

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const back = (
    <Link href="/app/orders" className={BACK}>
      <ArrowLeft className="size-4" aria-hidden="true" />
      {t("back")}
    </Link>
  );

  if (!order)
    return (
      <PageFrame>
        {back}
        {problem ? (
          <Banner tone="danger" title={problem} />
        ) : (
          <p className="m-0 text-muted">{t("loading")}</p>
        )}
      </PageFrame>
    );

  const reference = formatOrderReference(order.reference);
  const fullName = (p: { firstName: string; lastName: string }) =>
    t("childName", { firstName: p.firstName, lastName: p.lastName });
  const anyToPrint = order.lines.some((l) => l.physical && l.quantity > l.refundedQuantity);

  return (
    <PageFrame>
      {back}
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-h1">{t("title", { reference })}</h1>
        <p className="m-0 text-muted">{t("paidOn", { date: date(order.paidAt) })}</p>
        <OrderBadges
          status={order.fulfilment}
          refund={order.refund}
          disputed={order.disputedAt !== null}
        />
      </div>
      <p role="status" aria-live="polite" className="m-0 empty:sr-only">
        {status}
      </p>
      {order.canceledAt ? (
        <Banner tone="info" title={t("canceledNote", { date: date(order.canceledAt) })} />
      ) : null}
      {order.disputedAt ? (
        <Banner tone="danger" title={t("disputedNote", { date: date(order.disputedAt) })} />
      ) : null}
      {order.externalRefund ? (
        <Banner tone={order.externalRefund.checkedAt ? "info" : "warning"} title={tx("title")}>
          <p className="m-0">{tx("body", { date: date(order.externalRefund.at) })}</p>
          {order.externalRefund.checkedAt ? (
            <p className="m-0 mt-1">
              {tx("checked", { date: date(order.externalRefund.checkedAt) })}
            </p>
          ) : canRefund(me.studio.role) ? (
            <Button variant="secondary" className="mt-2" onClick={() => void checkExternalRefund()}>
              {tx("check")}
            </Button>
          ) : null}
        </Banner>
      ) : null}

      <Card className="flex flex-col gap-4 p-6">
        <FulfilmentPanel
          order={order}
          onChanged={(next, saved) => {
            setOrder(next);
            setStatus(t(`saved.${saved}`));
          }}
        />
      </Card>

      <Card asChild className="flex flex-col gap-3 p-6">
        <section aria-labelledby={itemsId}>
          <h2 id={itemsId} className="m-0 text-h3">
            {t("items")}
          </h2>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {order.lines.map((line) => (
              <li key={line.id} className="flex flex-col gap-0.5 py-2">
                <span className="flex justify-between gap-3">
                  <span className="font-semibold">
                    {t("line", { name: line.name, quantity: line.quantity })}
                  </span>
                  <span className="tabular-nums">{orderMoney(line.lineTotal)}</span>
                </span>
                <span className="text-caption text-muted">
                  {line.child ? t("forChild", { name: fullName(line.child) }) : t("childRemoved")}
                </span>
                {line.contents.length > 0 ? (
                  <span className="text-caption text-muted">
                    {format.list(
                      line.contents.map((c) =>
                        c.kind === "digital"
                          ? ts("contents.digital")
                          : ts("contents.print", {
                              quantity: c.quantity,
                              size: c.printSize ? ts(`sizes.${c.printSize}`) : "",
                            }),
                      ),
                      { type: "unit" },
                    )}
                  </span>
                ) : null}
                {line.refundedQuantity > 0 ? (
                  <span className="text-caption font-semibold text-danger">
                    {t("refundedQuantity", { count: line.refundedQuantity })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {canFulfil(me.studio.role) && anyToPrint && order.fulfilment !== "canceled" ? (
            <div className="flex flex-col items-start gap-1">
              <Button
                variant="secondary"
                onClick={() => void printFiles()}
                aria-busy={preparing || undefined}
              >
                <Download aria-hidden="true" />
                {preparing ? t("printFilesBusy") : t("printFiles")}
              </Button>
              <p className="m-0 text-caption text-muted">{t("printFilesNote")}</p>
              <p role="status" className="m-0 text-caption empty:sr-only">
                {filesNote}
              </p>
            </div>
          ) : null}
        </section>
      </Card>

      <Card asChild className="flex flex-col gap-3 p-6">
        <section aria-labelledby={totalsId}>
          <h2 id={totalsId} className="m-0 text-h3">
            {t("totals")}
          </h2>
          <dl className="m-0 grid max-w-md grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt>{t("products")}</dt>
            <dd className="m-0 text-right tabular-nums">{orderMoney(order.products)}</dd>
            <dt>{td(`deliveries.${order.shippingMethod ?? "none"}`)}</dt>
            <dd className="m-0 text-right tabular-nums">{orderMoney(order.shipping)}</dd>
            <dt>{t("tax")}</dt>
            <dd className="m-0 text-right tabular-nums">{orderMoney(order.tax)}</dd>
            <dt className="font-bold">{t("total")}</dt>
            <dd className="m-0 text-right font-bold tabular-nums">{orderMoney(order.total)}</dd>
            {order.refundable && order.refundable.refunded.cents > 0 ? (
              <>
                <dt>{t("refundedTotal")}</dt>
                <dd className="m-0 text-right tabular-nums">
                  {orderMoney(order.refundable.refunded)}
                </dd>
              </>
            ) : null}
            <dt>{t("daybellFee")}</dt>
            <dd className="m-0 text-right tabular-nums">
              {t("fee", {
                amount: orderMoney(order.daybellFee.amount),
                percent: formatBasisPoints(order.daybellFee.basisPoints),
              })}
            </dd>
            <dt>{t("cardFee")}</dt>
            <dd className="m-0 text-right tabular-nums">
              {order.cardFee ? orderMoney(order.cardFee) : t("pending")}
            </dd>
            <dt>{t("paidToYou")}</dt>
            <dd className="m-0 text-right tabular-nums">
              {order.paidToStudio ? orderMoney(order.paidToStudio) : t("pending")}
            </dd>
          </dl>
          <p className="m-0 text-caption text-muted">{t("feeNote")}</p>
        </section>
      </Card>

      {order.shipTo || order.shipToPurgedAt ? (
        <Card asChild className="flex flex-col gap-2 p-6">
          <section aria-labelledby={shipId}>
            <h2 id={shipId} className="m-0 text-h3">
              {t("shipTo")}
            </h2>
            {order.shipTo ? (
              <address className="text-sm not-italic">
                {order.shipTo.name}
                <br />
                {order.shipTo.line1}
                {order.shipTo.line2 ? (
                  <>
                    <br />
                    {order.shipTo.line2}
                  </>
                ) : null}
                <br />
                {t("cityLine", {
                  city: order.shipTo.city,
                  province: order.shipTo.province ?? "",
                  postalCode: order.shipTo.postalCode,
                })}
              </address>
            ) : order.shipToPurgedAt ? (
              <p className="m-0 text-muted">
                {t("shipToPurged", { date: date(order.shipToPurgedAt) })}
              </p>
            ) : null}
          </section>
        </Card>
      ) : null}

      {order.refunds !== null ? (
        <Card className="flex flex-col gap-3 p-6">
          <RefundsSection
            order={order}
            onRefunded={(refund: Refund) => {
              setStatus(
                refund.status === "requested"
                  ? tr("processing", { amount: orderMoney(refund.amount) })
                  : tr("done", { amount: orderMoney(refund.amount) }),
              );
              void load();
            }}
          />
        </Card>
      ) : null}
      {order.ledger !== null ? (
        <Card className="flex flex-col gap-3 p-6">
          <LedgerSection order={order} />
        </Card>
      ) : null}
    </PageFrame>
  );
}
