"use client";

import type {
  MoneyAmount,
  OrderResponse,
  OrdersResponse,
  StudioOrder,
  StudioOrderDetail,
} from "@daybell/api";
import {
  formatBasisPoints,
  formatMoney,
  formatOrderReference,
  localeForCurrency,
} from "@daybell/core";
import { Banner, Button, Card, Table, TableCell, TableHead, TableRow } from "@daybell/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog } from "../../../dialog";

const money = (m: MoneyAmount) => formatMoney(m, localeForCurrency(m.currency));

/**
 * The job's paid orders on its Shop tab (ADR 0023 §5.8; until the Orders tab arrives in step 11): reference, date,
 * children (full names: the studio may see them), items, total, tax, Daybell's fee with the rate it used, Stripe's card
 * fee ("Pending" until Stripe says) and what reaches the studio (D59, D98). Owners and admins only (call 15). Each
 * reference opens the order's lines, package contents and, for home delivery, where it ships.
 */
export function OrdersCard({ jobId }: { jobId: string }) {
  const t = useTranslations("app.job.orders");
  const fullName = (p: { firstName: string; lastName: string }) =>
    t("childName", { firstName: p.firstName, lastName: p.lastName });
  const text = useApiText();
  const format = useFormatter();
  const titleId = useId();
  const [orders, setOrders] = useState<StudioOrder[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<StudioOrder | null>(null);
  const [detail, setDetail] = useState<StudioOrderDetail | null>(null);

  useEffect(() => {
    let live = true;
    void api<OrdersResponse>(`/orders?jobId=${encodeURIComponent(jobId)}`).then((res) => {
      if (!live) return;
      if (res.ok) {
        setOrders(res.data.orders);
        setCursor(res.data.nextCursor);
      } else setProblem(text.error(res.code));
    });
    return () => {
      live = false;
    };
  }, [jobId, text]);

  async function more() {
    if (!cursor) return;
    const res = await api<OrdersResponse>(
      `/orders?jobId=${encodeURIComponent(jobId)}&cursor=${encodeURIComponent(cursor)}`,
    );
    if (!res.ok) return setProblem(text.error(res.code));
    setOrders((o) => [...(o ?? []), ...res.data.orders]);
    setCursor(res.data.nextCursor);
  }

  async function show(order: StudioOrder) {
    setOpen(order);
    setDetail(null);
    const res = await api<OrderResponse>(`/orders/${order.id}`);
    if (res.ok) setDetail(res.data.order);
    else setProblem(text.error(res.code));
  }

  const paid = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });

  return (
    <Card variant="sheet" asChild>
      <section aria-labelledby={titleId} className="flex flex-col gap-3 px-6 pt-5 pb-4">
        <h3 id={titleId} className="m-0 text-h3 font-bold">
          {t("title")}
        </h3>
        {problem ? <Banner tone="danger" title={problem} /> : null}
        {!orders ? (
          <p className="m-0 text-muted">{t("loading")}</p>
        ) : orders.length === 0 ? (
          <p className="m-0 text-muted">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <caption className="sr-only">{t("caption")}</caption>
              <thead>
                <TableRow>
                  <TableHead>{t("columns.order")}</TableHead>
                  <TableHead>{t("columns.paid")}</TableHead>
                  <TableHead>{t("columns.for")}</TableHead>
                  <TableHead numeric>{t("columns.items")}</TableHead>
                  <TableHead numeric>{t("columns.total")}</TableHead>
                  <TableHead numeric>{t("columns.tax")}</TableHead>
                  <TableHead numeric>{t("columns.daybellFee")}</TableHead>
                  <TableHead numeric>{t("columns.cardFee")}</TableHead>
                  <TableHead numeric>{t("columns.paidToYou")}</TableHead>
                </TableRow>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => void show(o)}
                        aria-label={t("open", { reference: formatOrderReference(o.reference) })}
                        className="min-h-11 font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        {formatOrderReference(o.reference)}
                      </button>
                    </TableCell>
                    <TableCell>{paid(o.paidAt)}</TableCell>
                    <TableCell>
                      {o.children.length > 0
                        ? format.list(o.children.map(fullName))
                        : t("noChildren")}
                    </TableCell>
                    <TableCell numeric>{o.items}</TableCell>
                    <TableCell numeric>{money(o.total)}</TableCell>
                    <TableCell numeric>{money(o.tax)}</TableCell>
                    <TableCell numeric>
                      {t("fee", {
                        amount: money(o.daybellFee.amount),
                        percent: formatBasisPoints(o.daybellFee.basisPoints),
                      })}
                    </TableCell>
                    <TableCell numeric>{o.cardFee ? money(o.cardFee) : t("pending")}</TableCell>
                    <TableCell numeric>
                      {o.paidToStudio ? money(o.paidToStudio) : t("pending")}
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        {cursor ? (
          <div>
            <Button variant="secondary" onClick={() => void more()}>
              {t("more")}
            </Button>
          </div>
        ) : null}
        <p className="m-0 text-caption text-muted">{t("note")}</p>
        <Dialog
          open={open !== null}
          onClose={() => setOpen(null)}
          title={open ? t("detailTitle", { reference: formatOrderReference(open.reference) }) : ""}
        >
          {!detail ? (
            <p className="m-0 text-muted">{t("loading")}</p>
          ) : (
            <OrderDetail order={detail} />
          )}
        </Dialog>
      </section>
    </Card>
  );
}

function OrderDetail({ order }: { order: StudioOrderDetail }) {
  const t = useTranslations("app.job.orders");
  const fullName = (p: { firstName: string; lastName: string }) =>
    t("childName", { firstName: p.firstName, lastName: p.lastName });
  const ts = useTranslations("shop");
  const format = useFormatter();
  return (
    <div className="flex flex-col gap-4">
      <ul className="m-0 list-none divide-y divide-line p-0">
        {order.lines.map((line) => (
          <li key={line.id} className="flex flex-col gap-0.5 py-2">
            <span className="flex justify-between gap-3">
              <span className="font-semibold">
                {t("line", { name: line.name, quantity: line.quantity })}
              </span>
              <span className="tabular-nums">{money(line.lineTotal)}</span>
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
          </li>
        ))}
      </ul>
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        <dt>{t("columns.total")}</dt>
        <dd className="m-0 text-right tabular-nums">{money(order.total)}</dd>
        <dt>{t("columns.tax")}</dt>
        <dd className="m-0 text-right tabular-nums">{money(order.tax)}</dd>
        <dt>{t("delivery")}</dt>
        <dd className="m-0 text-right">
          {order.shippingMethod ? t(`deliveries.${order.shippingMethod}`) : t("deliveries.none")}
        </dd>
        <dt>{t("columns.daybellFee")}</dt>
        <dd className="m-0 text-right tabular-nums">
          {t("fee", {
            amount: money(order.daybellFee.amount),
            percent: formatBasisPoints(order.daybellFee.basisPoints),
          })}
        </dd>
        <dt>{t("columns.cardFee")}</dt>
        <dd className="m-0 text-right tabular-nums">
          {order.cardFee ? money(order.cardFee) : t("pending")}
        </dd>
        <dt>{t("columns.paidToYou")}</dt>
        <dd className="m-0 text-right tabular-nums">
          {order.paidToStudio ? money(order.paidToStudio) : t("pending")}
        </dd>
      </dl>
      {order.shipTo ? (
        <section aria-label={t("shipTo")}>
          <h3 className="m-0 mb-1 text-label">{t("shipTo")}</h3>
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
        </section>
      ) : null}
    </div>
  );
}
