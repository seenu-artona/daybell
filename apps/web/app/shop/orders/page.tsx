"use client";

import type { ShopOrderSummary } from "@daybell/api";
import { formatOrderReference } from "@daybell/core";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Suspense, useEffect, useState } from "react";
import { isGalleryId, shopApi } from "@/lib/shop-client";
import { useRefusal } from "../_components/format";
import { Loading, MessageScreen } from "../_components/message-screen";
import { useShop } from "../_components/shop-context";
import { ShopHeader } from "../_components/shop-header";
import { ShopTitle } from "../_components/shop-title";
import { shopButton } from "../_components/styles";

/**
 * "Your orders" (ADR 0023 §6; call 12): the paid orders this gallery may see, newest first, with their downloads, and
 * its own checkouts still being confirmed. Re-entering a child's code on another device shows that child's orders
 * again. Each opens the order page. Never an email, an amount in another parent's view, or a last name.
 */
function Orders() {
  const t = useTranslations("shop");
  const format = useFormatter();
  const refusal = useRefusal();
  const router = useRouter();
  const shop = useShop();
  const asked = useSearchParams().get("gallery");
  const gallery = shop.gallery(isGalleryId(asked) ? asked : null);
  const galleryId = gallery?.id ?? null;
  const [orders, setOrders] = useState<ShopOrderSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const status = shop.state.status;

  useEffect(() => {
    if (status === "none" || (status === "ready" && !galleryId)) router.replace("/shop");
  }, [status, galleryId, router]);

  useEffect(() => {
    if (!galleryId) return;
    let live = true;
    void shopApi.orders(galleryId).then((result) => {
      if (!live) return;
      if (result.ok) setOrders(result.data.orders);
      else if (result.status === 401) router.replace("/shop");
      else setProblem(refusal(result));
    });
    return () => {
      live = false;
    };
  }, [galleryId, router, refusal]);

  const children = gallery?.children ?? [];
  const back = children[0] ? `/shop/c/${children[0].id}` : "/shop";
  const names = (order: ShopOrderSummary) =>
    format.list(
      order.children.map((c) => (c.state === "open" ? c.displayName : t("yourChild"))),
      { type: "conjunction" },
    );

  return (
    <>
      <ShopTitle>{t("titles.orders")}</ShopTitle>
      <ShopHeader title={t("orders.title")} back={back} gallery={galleryId} />
      <main className="px-4 pt-4 pb-12">
        {problem ? (
          <p role="alert" className="m-0 text-body text-danger">
            {problem}
          </p>
        ) : !orders ? (
          <Loading label={t("loading")} />
        ) : orders.length === 0 ? (
          <MessageScreen>
            <p className="m-0 mb-4">{t("orders.empty")}</p>
            <Link href={back} className={shopButton}>
              {t("bag.backToPhotos")}
            </Link>
          </MessageScreen>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/shop/orders/${order.id}?gallery=${encodeURIComponent(galleryId ?? "")}`}
                  className="flex min-h-12 flex-col gap-0.5 rounded-lg border border-line px-4 py-3 text-ink no-underline hover:bg-subtle focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-studio-ring"
                >
                  <span className="text-sm font-semibold">
                    {t("orders.item", { reference: formatOrderReference(order.reference) })}
                  </span>
                  <span className="text-caption text-muted">
                    {order.status === "paid" && order.paidAt
                      ? t("orders.paidOn", {
                          date: format.dateTime(new Date(order.paidAt), {
                            month: "long",
                            day: "numeric",
                          }),
                        })
                      : t("orders.confirming")}
                  </span>
                  {order.children.length > 0 ? (
                    <span className="text-caption text-muted">
                      {t("bag.forChild", { name: names(order) })}
                    </span>
                  ) : null}
                  {order.status === "paid" ? (
                    <span className="text-caption">
                      {t("orders.downloads", { count: order.downloads })}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Orders />
    </Suspense>
  );
}
