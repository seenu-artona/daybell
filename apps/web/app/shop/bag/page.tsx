"use client";

import { SHOP_CONFLICTS, type ShopCartLine, type ShopCartResponse } from "@daybell/api";
import {
  checkoutBlocker,
  hasQuantity,
  MIN_CHARGE_CENTS,
  type ShopShippingMethod,
} from "@daybell/core";
import { cn } from "@daybell/ui";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { bagCount, isGalleryId, type ShopResult, shopApi } from "@/lib/shop-client";
import { DockedCta } from "../_components/docked-cta";
import { money, useChildName, useRefusal } from "../_components/format";
import { Loading, MessageScreen } from "../_components/message-screen";
import { ProtectedImage } from "../_components/protected-image";
import { Quantity } from "../_components/quantity";
import { useShop } from "../_components/shop-context";
import { ShopHeader } from "../_components/shop-header";
import { ShopTitle } from "../_components/shop-title";
import { shopButton, shopIconButton } from "../_components/styles";

/**
 * A gallery's bag (`?gallery=`, else the device's first): lines by child, priced now; lines that can't be bought any
 * more are marked and not counted; delivery to school or home (call 9); the total before tax, announced when it
 * changes (code review S2). A delivery choice shows at once and goes back if the bag refuses it, with the reason
 * announced (D91). Pay (ADR 0023) is docked with the total once nothing stops it (otherwise the dock says why) and goes
 * to Stripe's hosted checkout; "Payments processed by Daybell for {studio}" sits under the totals (D104). Coming back
 * from Stripe without paying (`?checkout=canceled`) cancels that checkout, so a stale tab can't pay later, and says the
 * bag is unchanged. A refusal is announced and the bag read again (a line may have become unavailable).
 *
 * The bag is read once when the page opens (and again only after a change the parent makes): code review M1 found the
 * first version refetching in a loop, using up the network's request budget.
 */
function Bag() {
  const t = useTranslations("shop");
  const refusal = useRefusal();
  const childName = useChildName();
  const router = useRouter();
  const shop = useShop();
  const params = useSearchParams();
  const asked = params.get("gallery");
  const canceled = params.get("checkout") === "canceled";
  const gallery = shop.gallery(isGalleryId(asked) ? asked : null);
  const galleryId = gallery?.id ?? null;
  const [cart, setCart] = useState<ShopCartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  // The delivery the parent just chose, shown checked at once while the bag saves it (e2e: a radio that waited for
  // the answer didn't change when clicked); cleared when the answer comes, so a refusal puts the saved one back.
  const [choosing, setChoosing] = useState<ShopShippingMethod | null>(null);
  const choice = useRef(0);
  const deliveryId = useId();

  // The latest way to apply an answer, without making the load below depend on it.
  const apply = useRef<(result: ShopResult<ShopCartResponse>) => void>(() => {});
  apply.current = (result) => {
    if (result.ok) {
      setCart(result.data);
      if (galleryId) shop.setBagCount(galleryId, bagCount(result.data));
      setError(null);
    } else if (result.status === 401) {
      router.replace("/shop");
    } else {
      setError(refusal(result));
    }
  };

  const status = shop.state.status;
  useEffect(() => {
    if (status === "none" || (status === "ready" && !galleryId)) router.replace("/shop");
  }, [status, galleryId, router]);

  useEffect(() => {
    if (!galleryId) return;
    let live = true;
    void shopApi.cart(galleryId).then((result) => {
      if (live) apply.current(result);
    });
    return () => {
      live = false;
    };
  }, [galleryId]);

  // Back from Stripe without paying: that checkout can't be paid later (ADR 0023). Once per arrival.
  useEffect(() => {
    if (!galleryId || !canceled) return;
    router.replace(`/shop/bag?gallery=${encodeURIComponent(galleryId)}`);
    void shopApi.cancelCheckout(galleryId).then((result) => {
      setNotice(result.ok ? t("checkout.canceled") : refusal(result));
    });
  }, [galleryId, canceled, router, t, refusal]);

  // Pay (ADR 0023): the server prices the bag again and answers Stripe's address; the page goes straight there.
  const pay = async () => {
    if (!galleryId || paying) return;
    setPaying(true);
    setNotice(null);
    const result = await shopApi.checkout(galleryId);
    if (result.ok) {
      window.location.assign(result.data.url);
      return;
    }
    setPaying(false);
    if (result.form === SHOP_CONFLICTS.alreadyPaid && result.fields.orderId) {
      router.push(
        `/shop/orders/${encodeURIComponent(result.fields.orderId)}?gallery=${encodeURIComponent(galleryId)}`,
      );
      return;
    }
    if (result.status === 401) {
      router.replace("/shop");
      return;
    }
    setError(refusal(result));
    const fresh = await shopApi.cart(galleryId);
    if (fresh.ok) {
      setCart(fresh.data);
      shop.setBagCount(galleryId, bagCount(fresh.data));
    }
  };

  const act = async (call: (gallery: string) => Promise<ShopResult<ShopCartResponse>>) => {
    if (!galleryId) return;
    setBusy(true);
    apply.current(await call(galleryId));
    setBusy(false);
  };

  // Only the latest choice's answer counts. The radios stay enabled while it saves so focus and arrow keys keep working.
  const choose = async (method: ShopShippingMethod) => {
    if (!galleryId) return;
    const mine = ++choice.current;
    setChoosing(method);
    const result = await shopApi.setShipping(galleryId, method);
    if (mine !== choice.current) return;
    apply.current(result);
    setChoosing(null);
  };

  const children = gallery?.children ?? [];
  const back = children[0] ? `/shop/c/${children[0].id}` : "/shop";
  const title = <ShopTitle>{t("titles.bag")}</ShopTitle>;
  if (!cart)
    return (
      <>
        {title}
        {status === "error" ? (
          <MessageScreen>
            <button type="button" onClick={() => void shop.refresh()} className={shopButton}>
              {t("retry")}
            </button>
          </MessageScreen>
        ) : (
          <Loading label={t("loading")} />
        )}
      </>
    );

  const groups = children
    .map((c) => ({ child: c, lines: cart.lines.filter((l) => l.childId === c.id) }))
    .filter((g) => g.lines.length > 0);

  const currency = cart.subtotal.currency;
  const blocker = checkoutBlocker({
    lines: cart.lines,
    totalCents: cart.total?.cents ?? null,
    currency,
  });
  const blockerText =
    blocker === "unavailable"
      ? t("checkout.blocked.unavailable")
      : blocker === "chooseDelivery"
        ? t("checkout.blocked.chooseDelivery")
        : blocker === "belowMinimum"
          ? t("checkout.blocked.belowMinimum", {
              amount: money({ cents: MIN_CHARGE_CENTS[currency], currency }),
            })
          : null;

  const describe = (line: ShopCartLine, firstName: string) =>
    line.kind === "digital_all"
      ? t("buy.allDigitalsHint", { name: firstName })
      : line.printSize
        ? t(`sizes.${line.printSize}`)
        : null;

  return (
    <>
      {title}
      <ShopHeader title={t("bag.title")} back={back} gallery={galleryId} />
      <main className="px-4 pt-2 pb-32">
        <p role="alert" className="m-0 min-h-5 text-caption text-danger">
          {error}
        </p>
        <p role="status" className="m-0 text-body empty:hidden">
          {notice}
        </p>
        {cart.lines.length === 0 ? (
          <MessageScreen>
            <p className="m-0 mb-4">{t("bag.empty")}</p>
            <Link href={back} className={shopButton}>
              {t("bag.backToPhotos")}
            </Link>
          </MessageScreen>
        ) : (
          <>
            {groups.map(({ child, lines }) => {
              const name = childName(child);
              const firstName = child.state === "open" ? child.firstName : name;
              return (
                <section key={child.id} aria-labelledby={`bag-${child.id}`} className="mt-4">
                  <h2 id={`bag-${child.id}`} className="m-0 mb-2 text-title-sm">
                    {t("bag.forChild", { name })}
                  </h2>
                  <ul className="m-0 list-none divide-y divide-line p-0">
                    {lines.map((line) => (
                      <li
                        key={line.id}
                        className={cn("flex gap-3 py-3", !line.available && "opacity-60")}
                      >
                        <div className="size-16 shrink-0 overflow-hidden rounded-md bg-subtle">
                          {line.photo?.thumbUrl ? (
                            <ProtectedImage src={line.photo.thumbUrl} alt="" />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="m-0 text-sm font-semibold">{line.name}</p>
                          {describe(line, firstName) ? (
                            <p className="m-0 text-caption text-muted">
                              {describe(line, firstName)}
                            </p>
                          ) : null}
                          {line.available ? (
                            <p className="m-0 mt-0.5 text-sm font-bold tabular-nums">
                              {money(line.lineTotal)}
                            </p>
                          ) : (
                            <p className="m-0 mt-0.5 text-caption font-semibold text-danger">
                              {t("bag.unavailable")}
                            </p>
                          )}
                          {hasQuantity(line.kind) && line.available ? (
                            <div className="mt-1">
                              <Quantity
                                label={t("bag.quantity", { item: line.name })}
                                value={line.quantity}
                                disabled={busy}
                                onChange={(q) =>
                                  void act((g) => shopApi.setQuantity(g, line.id, q))
                                }
                              />
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          aria-label={t("bag.remove", { item: line.name })}
                          disabled={busy}
                          onClick={() => void act((g) => shopApi.removeLine(g, line.id))}
                          className={shopIconButton}
                        >
                          <Trash2 className="size-5" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}

            {cart.shipping.needed ? (
              <fieldset className="m-0 mt-6 border-0 p-0">
                <legend className="mb-2 p-0 text-title-sm">{t("bag.delivery")}</legend>
                {cart.shipping.school ? (
                  <div className="flex flex-col gap-2">
                    {(["school", "home"] as const).map((method) => (
                      <label
                        key={method}
                        className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-line-strong px-3 has-checked:border-studio-ring has-focus-visible:outline-3 has-focus-visible:outline-studio-ring"
                      >
                        <input
                          type="radio"
                          name="delivery"
                          value={method}
                          checked={(choosing ?? cart.shipping.method) === method}
                          aria-labelledby={`${deliveryId}-${method}`}
                          aria-describedby={`${deliveryId}-${method}-price`}
                          onChange={() => void choose(method)}
                          className="size-5 accent-studio-ring"
                        />
                        <span id={`${deliveryId}-${method}`} className="flex-1 text-sm">
                          {t(`bag.${method}`)}
                        </span>
                        <span
                          id={`${deliveryId}-${method}-price`}
                          className="text-sm font-semibold tabular-nums"
                        >
                          {method === "school" ? t("bag.free") : money(cart.shipping.home)}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="m-0 flex justify-between text-sm">
                    <span>{t("bag.home")}</span>
                    <span className="font-semibold tabular-nums">{money(cart.shipping.home)}</span>
                  </p>
                )}
              </fieldset>
            ) : null}

            {/* Announced as a whole when delivery or a quantity changes it (code review S2). */}
            <div aria-live="polite" aria-atomic="true" className="mt-6 border-t border-line pt-4">
              <dl className="m-0 flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <dt>{t("bag.subtotal")}</dt>
                  <dd className="m-0 tabular-nums">{money(cart.subtotal)}</dd>
                </div>
                {cart.shipping.needed ? (
                  <div className="flex justify-between">
                    <dt>{t("bag.delivery")}</dt>
                    <dd className="m-0 tabular-nums">
                      {cart.shipping.cost === null
                        ? t("bag.chooseDelivery")
                        : cart.shipping.cost.cents === 0
                          ? t("bag.free")
                          : money(cart.shipping.cost)}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {cart.total ? (
                <p className="m-0 mt-3 flex items-baseline justify-between">
                  <strong className="text-title-sm">
                    {t("bag.total", { amount: money(cart.total) })}
                  </strong>
                  <span className="text-caption text-muted">{t("bag.plusTax")}</span>
                </p>
              ) : null}
            </div>
            {gallery ? (
              <p className="m-0 mt-4 text-caption text-muted">
                {t("checkout.processedBy", { studio: gallery.studio.name })}
              </p>
            ) : null}
          </>
        )}
      </main>
      {cart.lines.length > 0 ? (
        blocker || !cart.total ? (
          <DockedCta>
            <p className="m-0 py-2 text-center text-sm text-muted">{blockerText}</p>
          </DockedCta>
        ) : (
          <DockedCta price={money(cart.total)} label={t("bag.plusTax")}>
            <button
              type="button"
              onClick={() => void pay()}
              aria-busy={paying || undefined}
              aria-disabled={paying || undefined}
              className={shopButton}
            >
              {paying ? t("checkout.paying") : t("checkout.pay")}
            </button>
          </DockedCta>
        )
      ) : null}
    </>
  );
}

export default function BagPage() {
  return (
    <Suspense>
      <Bag />
    </Suspense>
  );
}
