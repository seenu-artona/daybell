"use client";

import { SHOP_CONFLICTS, type ShopOrder, type ShopOrderLine } from "@daybell/api";
import { formatOrderReference } from "@daybell/core";
import { Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { isGalleryId, isShopId, shopApi } from "@/lib/shop-client";
import { money, useContents, useRefusal } from "../../_components/format";
import { Loading, MessageScreen } from "../../_components/message-screen";
import { useShop } from "../../_components/shop-context";
import { ShopDialog } from "../../_components/shop-dialog";
import { ShopHeader } from "../../_components/shop-header";
import { ShopTitle } from "../../_components/shop-title";
import { shopButton, shopLink, shopSecondaryButton } from "../../_components/styles";

/** How long the page keeps asking while a payment is being confirmed: 1, 2, 4, 8 and 15 seconds (about 30 in all). */
const POLL_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * The order page (ADR 0023 §6, ADR 0024): Stripe sends the parent here after paying. While the payment is being
 * confirmed it asks again (the API checks with Stripe itself, at most every 5 seconds), backing off for about 30
 * seconds, then says so with Try again. Paid: thank you, the reference, the order's status (and Refunded or Partly
 * refunded) with its tracking once shipped (full view), the lines by child, totals with tax and the studio's tax numbers
 * (the full view only; call 12), a 44px "Download photo {n}" button per photo, Download all (one zip), and, for the
 * gallery that paid while nothing is printed, Cancel order with a confirm step (answer 2). Once paid, the shop's
 * galleries are read again once, so the header's bag count is right (the bag lost what was bought). The title never
 * names a child. Words in the locale files (D96).
 */
function OrderPage() {
  const t = useTranslations("shop");
  const contents = useContents();
  const refusal = useRefusal();
  const router = useRouter();
  const shop = useShop();
  const { orderId } = useParams<{ orderId: string }>();
  const asked = useSearchParams().get("gallery");
  const gallery = shop.gallery(isGalleryId(asked) ? asked : null);
  const galleryId = gallery?.id ?? null;
  const [order, setOrder] = useState<ShopOrder | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [orderNote, setOrderNote] = useState<string | null>(null);
  const attempt = useRef(0);
  const refreshed = useRef(false);
  const status = shop.state.status;
  const refreshShop = shop.refresh;

  useEffect(() => {
    if (status === "none" || (status === "ready" && !galleryId)) router.replace("/shop");
  }, [status, galleryId, router]);

  const load = useCallback(async () => {
    if (!galleryId || !isShopId(orderId)) return null;
    const result = await shopApi.order(galleryId, orderId);
    if (result.ok) {
      setOrder(result.data.order);
      setProblem(null);
      return result.data.order;
    }
    if (result.status === 401) router.replace("/shop");
    else setProblem(result.status === 404 ? t("order.notFound") : refusal(result));
    return null;
  }, [galleryId, orderId, router, t, refusal]);

  // Asks again while the payment is pending, backing off; then stops and offers Try again.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const current = await load();
      if (!live || current?.status !== "pending") return;
      const wait = POLL_MS[attempt.current];
      attempt.current += 1;
      if (wait === undefined) {
        setSlow(true);
        return;
      }
      timer = setTimeout(() => void run(), wait);
    };
    void run();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  // The bag lost what was bought when the order was paid: the header's count is read again, once (the bag badge).
  useEffect(() => {
    if (order?.status !== "paid" || refreshed.current) return;
    refreshed.current = true;
    void refreshShop();
  }, [order?.status, refreshShop]);

  const retry = async () => {
    setSlow(false);
    attempt.current = POLL_MS.length - 1;
    const current = await load();
    if (current?.status === "pending") setSlow(true);
  };

  // One download at a time: a second tap while one is being signed is ignored (a ref, so even a tap before the next
  // render is), so a double tap never signs twice or opens the file twice.
  const downloadBusy = useRef(false);
  const download = async (photoId: string, n: number) => {
    if (!galleryId || !order || downloadBusy.current) return;
    downloadBusy.current = true;
    setDownloading(photoId);
    setDownloadNote(null);
    const result = await shopApi.download(galleryId, order.id, photoId).finally(() => {
      downloadBusy.current = false;
    });
    setDownloading(null);
    if (result.ok) {
      // The signed link saves the file (an attachment); the page stays.
      window.location.assign(result.data.url);
      setDownloadNote(t("order.downloadStarted", { n }));
    } else if (result.form === SHOP_CONFLICTS.downloadPreparing) {
      setDownloadNote(t("refusals.downloadPreparing"));
    } else {
      setDownloadNote(refusal(result));
    }
  };

  // One cancel at a time (answer 2): the server refunds everything left, shipping included.
  const cancelBusy = useRef(false);
  const cancelOrder = async () => {
    if (!galleryId || !order || cancelBusy.current) return;
    cancelBusy.current = true;
    const result = await shopApi.cancelOrder(galleryId, order.id).finally(() => {
      cancelBusy.current = false;
    });
    setConfirmCancel(false);
    if (result.ok) {
      setOrder(result.data.order);
      setOrderNote(
        result.data.order.fulfilment === "canceled"
          ? t("order.canceled")
          : t("order.cancelProcessing"),
      );
    } else setOrderNote(refusal(result));
  };

  const zipBusy = useRef(false);
  const downloadAll = async () => {
    if (!galleryId || !order || zipBusy.current) return;
    zipBusy.current = true;
    setDownloadNote(null);
    const result = await shopApi.downloadAll(galleryId, order.id).finally(() => {
      zipBusy.current = false;
    });
    if (result.ok) setDownloadNote(t("order.downloadAllStarted"));
    else if (result.form === SHOP_CONFLICTS.downloadPreparing)
      setDownloadNote(t("refusals.downloadPreparing"));
    else setDownloadNote(refusal(result));
  };

  const title = <ShopTitle>{t("titles.order")}</ShopTitle>;
  const back = galleryId ? `/shop/orders?gallery=${encodeURIComponent(galleryId)}` : "/shop";
  if (!order)
    return (
      <>
        {title}
        <ShopHeader title={t("order.title")} back={back} gallery={galleryId} />
        <main className="px-4 pb-12">
          {problem ? (
            <MessageScreen>
              <p role="alert" className="m-0">
                {problem}
              </p>
            </MessageScreen>
          ) : (
            <Loading label={t("order.loading")} />
          )}
        </main>
      </>
    );

  const full = order.view === "full";
  const childName = (id: string | null) => {
    const child = order.children.find((c) => c.id === id);
    return child?.state === "open" ? child.displayName : t("yourChild");
  };
  const groups = order.children
    .map((c) => ({ id: c.id, lines: order.lines.filter((l) => l.childId === c.id) }))
    .filter((g) => g.lines.length > 0);
  const others = order.lines.filter((l) => !order.children.some((c) => c.id === l.childId));
  const describe = (line: ShopOrderLine) =>
    line.kind === "package" && line.contents.length > 0
      ? contents(line.contents)
      : line.printSize
        ? t(`sizes.${line.printSize}`)
        : null;
  const renderLines = (lines: ShopOrderLine[]) => (
    <ul className="m-0 list-none divide-y divide-line p-0">
      {lines.map((line) => (
        <li key={line.id} className="py-3">
          <div className="flex justify-between gap-3">
            <p className="m-0 text-sm font-semibold">
              {t("order.line", { name: line.name, quantity: line.quantity })}
            </p>
            {line.lineTotal ? (
              <p className="m-0 text-sm font-semibold tabular-nums">{money(line.lineTotal)}</p>
            ) : null}
          </div>
          {describe(line) ? <p className="m-0 text-caption text-muted">{describe(line)}</p> : null}
          {line.refundedQuantity > 0 ? (
            <p className="m-0 text-caption font-semibold">
              {t("order.refundedQuantity", { count: line.refundedQuantity })}
            </p>
          ) : null}
          {order.status === "paid" && line.downloads.length > 0 ? (
            <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
              {line.downloads.map((d) => (
                <li key={d.photoId}>
                  <button
                    type="button"
                    onClick={() => void download(d.photoId, d.n)}
                    aria-busy={downloading === d.photoId || undefined}
                    className={shopSecondaryButton}
                  >
                    <Download className="mr-2 size-5" aria-hidden="true" />
                    {t("order.download", { n: d.n })}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {title}
      <ShopHeader title={t("order.title")} back={back} gallery={galleryId} />
      <main className="px-4 pt-4 pb-12">
        {order.status === "pending" ? (
          <div role="status" className="rounded-lg bg-subtle px-5 py-6 text-center">
            <p className="m-0 text-body">{t("order.confirming")}</p>
            {slow ? (
              <>
                <p className="m-0 mt-2 text-caption text-muted">{t("order.slow")}</p>
                <button type="button" onClick={() => void retry()} className={`${shopButton} mt-4`}>
                  {t("retry")}
                </button>
              </>
            ) : null}
          </div>
        ) : order.status === "paid" ? (
          <section aria-labelledby="order-thanks">
            <h2 id="order-thanks" className="m-0 text-title">
              {full ? t("order.thanks") : t("order.paidTitle")}
            </h2>
            <p className="m-0 mt-1 text-body">
              {t("order.reference", { reference: formatOrderReference(order.reference) })}
            </p>
            {full ? <p className="m-0 mt-1 text-caption text-muted">{t("order.receipt")}</p> : null}
            {!full ? (
              <p className="m-0 mt-1 text-caption text-muted">{t("order.childView")}</p>
            ) : null}
            {order.fulfilment ? (
              <p className="m-0 mt-3 text-body">
                <span className="font-semibold">{t("order.status")}: </span>
                {t(`order.fulfilment.${order.fulfilment}`)}
                {order.refund ? ` · ${t(`order.refundBadges.${order.refund}`)}` : null}
              </p>
            ) : null}
            {order.tracking ? (
              <div className="mt-2">
                <p className="m-0 text-body">
                  <span className="font-semibold">{t("order.tracking")}: </span>
                  {t("order.trackingLine", {
                    carrier: t(`order.carriers.${order.tracking.carrier}`),
                    number: order.tracking.number,
                  })}
                </p>
                {order.tracking.link ? (
                  <a
                    href={order.tracking.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={shopLink}
                  >
                    {t("order.trackPackage")}
                    <ExternalLink className="ml-1 size-4" aria-hidden="true" />
                  </a>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : (
          <MessageScreen>
            <p className="m-0">{t("order.notPaid")}</p>
          </MessageScreen>
        )}

        <p role="status" className="m-0 mt-3 min-h-5 text-caption">
          {orderNote}
        </p>
        <p role="status" className="m-0 min-h-5 text-caption">
          {downloadNote}
        </p>
        {order.status === "paid" && downloadCount(order) > 1 ? (
          <button type="button" onClick={() => void downloadAll()} className={shopSecondaryButton}>
            <Download className="mr-2 size-5" aria-hidden="true" />
            {t("order.downloadAll")}
          </button>
        ) : null}

        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`order-${g.id}`} className="mt-4">
            <h2 id={`order-${g.id}`} className="m-0 mb-1 text-title-sm">
              {t("bag.forChild", { name: childName(g.id) })}
            </h2>
            {renderLines(g.lines)}
          </section>
        ))}
        {others.length > 0 ? <section className="mt-4">{renderLines(others)}</section> : null}

        {full && order.totals ? (
          <div className="mt-6 border-t border-line pt-4">
            <dl className="m-0 flex flex-col gap-1 text-sm">
              <div className="flex justify-between">
                <dt>{t("bag.subtotal")}</dt>
                <dd className="m-0 tabular-nums">{money(order.totals.products)}</dd>
              </div>
              {order.shippingMethod ? (
                <div className="flex justify-between">
                  <dt>{t(`bag.${order.shippingMethod}`)}</dt>
                  <dd className="m-0 tabular-nums">
                    {order.totals.shipping.cents === 0
                      ? t("bag.free")
                      : money(order.totals.shipping)}
                  </dd>
                </div>
              ) : null}
              {order.totals.tax ? (
                <div className="flex justify-between">
                  <dt>{t("order.tax")}</dt>
                  <dd className="m-0 tabular-nums">{money(order.totals.tax)}</dd>
                </div>
              ) : null}
              {order.totals.total ? (
                <div className="flex justify-between font-bold">
                  <dt>{t("order.total")}</dt>
                  <dd className="m-0 tabular-nums">{money(order.totals.total)}</dd>
                </div>
              ) : null}
              {order.totals.refunded.cents > 0 ? (
                <div className="flex justify-between">
                  <dt>{t("order.refunded")}</dt>
                  <dd className="m-0 tabular-nums">{money(order.totals.refunded)}</dd>
                </div>
              ) : null}
            </dl>
            {order.registrations.length > 0 ? (
              <ul className="m-0 mt-3 list-none p-0 text-caption text-muted">
                {order.registrations.map((r) => (
                  <li key={`${r.kind}-${r.province ?? ""}`}>
                    {r.kind === "gst_hst"
                      ? t("order.gstHst", { number: r.number })
                      : t("order.pst", { province: r.province ?? "", number: r.number })}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {order.canCancel && full && order.totals?.total ? (
          <section className="mt-6 border-t border-line pt-4">
            <p className="m-0 text-caption text-muted">{t("order.cancelHelp")}</p>
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className={`${shopSecondaryButton} mt-2`}
            >
              {t("order.cancel")}
            </button>
            <ShopDialog
              open={confirmCancel}
              onClose={() => setConfirmCancel(false)}
              title={t("order.cancelTitle")}
            >
              <p className="m-0 mt-2 text-body">
                {t("order.cancelBody", {
                  amount: money({
                    cents: order.totals.total.cents - order.totals.refunded.cents,
                    currency: order.totals.total.currency,
                  }),
                })}
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <button type="button" onClick={() => void cancelOrder()} className={shopButton}>
                  {t("order.cancelConfirm")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCancel(false)}
                  className={shopSecondaryButton}
                >
                  {t("order.cancelKeep")}
                </button>
              </div>
            </ShopDialog>
          </section>
        ) : null}

        <p className="m-0 mt-6 text-caption text-muted">
          {t("checkout.processedBy", { studio: order.studio.name })}
        </p>
        <p className="m-0 mt-4">
          <Link href={back} className={shopLink}>
            {t("order.allOrders")}
          </Link>
        </p>
      </main>
    </>
  );
}

/** How many photos the order's lines unlock (Download all is offered for more than one). */
function downloadCount(order: ShopOrder): number {
  return order.lines.reduce((n, l) => n + l.downloads.length, 0);
}

export default function Page() {
  return (
    <Suspense>
      <OrderPage />
    </Suspense>
  );
}
