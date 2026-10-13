"use client";

import type { ShopCartLine, ShopCartResponse } from "@daybell/api";
import { hasQuantity } from "@daybell/core";
import { cn } from "@daybell/ui";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { bagCount, type ShopResult, shopApi } from "@/lib/shop-client";
import { money, useRefusal } from "../_components/format";
import { Loading, MessageScreen } from "../_components/message-screen";
import { ProtectedImage } from "../_components/protected-image";
import { Quantity } from "../_components/quantity";
import { useShop } from "../_components/shop-context";
import { ShopHeader } from "../_components/shop-header";
import { shopButton, shopIconButton } from "../_components/styles";

/**
 * The bag: lines by child, priced now; lines that can't be bought any more are marked and not counted; delivery to
 * school or home (call 9); the total before tax. Paying arrives with checkout (step 10).
 */
export default function BagPage() {
  const t = useTranslations("shop");
  const refusal = useRefusal();
  const router = useRouter();
  const shop = useShop();
  const [cart, setCart] = useState<ShopCartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback(
    (result: ShopResult<ShopCartResponse>) => {
      if (result.ok) {
        setCart(result.data);
        shop.setBagCount(bagCount(result.data));
        setError(null);
      } else if (result.status === 401) {
        router.replace("/shop");
      } else {
        setError(refusal(result));
      }
    },
    [shop.setBagCount, refusal, router],
  );

  useEffect(() => {
    void shopApi.cart().then(apply);
  }, [apply]);

  const act = async (call: () => Promise<ShopResult<ShopCartResponse>>) => {
    setBusy(true);
    apply(await call());
    setBusy(false);
  };

  const children = shop.state.status === "ready" ? shop.state.session.children : [];
  const back = children[0] ? `/shop/c/${children[0].id}` : "/shop";
  if (!cart) return <Loading label={t("loading")} />;

  const groups = children
    .map((c) => ({ child: c, lines: cart.lines.filter((l) => l.childId === c.id) }))
    .filter((g) => g.lines.length > 0);

  const describe = (line: ShopCartLine, firstName: string) =>
    line.kind === "digital_all"
      ? t("buy.allDigitalsHint", { name: firstName })
      : line.printSize
        ? t(`sizes.${line.printSize}`)
        : null;

  return (
    <>
      <ShopHeader title={t("bag.title")} back={back} />
      <main className="px-4 pt-2 pb-12">
        <p role="alert" className="m-0 min-h-5 text-caption text-danger">
          {error}
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
            {groups.map(({ child, lines }) => (
              <section key={child.id} aria-labelledby={`bag-${child.id}`} className="mt-4">
                <h2 id={`bag-${child.id}`} className="m-0 mb-2 text-title-sm">
                  {t("bag.forChild", { name: child.displayName })}
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
                        {describe(line, child.firstName) ? (
                          <p className="m-0 text-caption text-muted">
                            {describe(line, child.firstName)}
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
                              onChange={(q) => void act(() => shopApi.setQuantity(line.id, q))}
                            />
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        aria-label={t("bag.remove", { item: line.name })}
                        disabled={busy}
                        onClick={() => void act(() => shopApi.removeLine(line.id))}
                        className={shopIconButton}
                      >
                        <Trash2 className="size-5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

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
                          checked={cart.shipping.method === method}
                          disabled={busy}
                          onChange={() => void act(() => shopApi.setShipping(method))}
                          className="size-5 accent-studio-ring"
                        />
                        <span className="flex-1 text-sm">{t(`bag.${method}`)}</span>
                        <span className="text-sm font-semibold tabular-nums">
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

            <dl className="m-0 mt-6 flex flex-col gap-1 border-t border-line pt-4 text-sm">
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
          </>
        )}
      </main>
    </>
  );
}
