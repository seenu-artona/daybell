"use client";

import type { ShopItem, ShopPriceListResponse } from "@daybell/api";
import { OptionCard } from "@daybell/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useState } from "react";
import { bagCount, shopApi } from "@/lib/shop-client";
import { DockedCta } from "../../../../_components/docked-cta";
import { money, useRefusal } from "../../../../_components/format";
import { Loading, MessageScreen } from "../../../../_components/message-screen";
import { useShop } from "../../../../_components/shop-context";
import { ShopHeader } from "../../../../_components/shop-header";
import { ShopTitle } from "../../../../_components/shop-title";
import { shopButton, shopLink } from "../../../../_components/styles";
import { useChildData } from "../../../../_components/use-child";

/** Single prints and downloads: a print or the single download go on to the pose; all digitals has none. */
function Singles() {
  const t = useTranslations("shop");
  const refusal = useRefusal();
  const router = useRouter();
  const { setBagCount } = useShop();
  const photo = useSearchParams().get("photo");
  const { childId, galleryId, child, studio, data, failed, reload } =
    useChildData<ShopPriceListResponse>(shopApi.priceList);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items = data?.priceList?.items ?? [];
  const groups = [
    { key: "prints", items: items.filter((i) => i.kind === "print") },
    {
      key: "downloads",
      items: items.filter((i) => i.kind === "digital_single" || i.kind === "digital_all"),
    },
  ] as const;
  const selected: ShopItem | undefined = items.find(
    (i) => i.id === (chosen ?? groups[0].items[0]?.id ?? groups[1].items[0]?.id),
  );
  const pose = photo ? `?photo=${encodeURIComponent(photo)}` : "";

  const addAll = async (item: ShopItem) => {
    if (!galleryId) return;
    setBusy(true);
    setError(null);
    const result = await shopApi.addLine(galleryId, {
      childId,
      itemId: item.id,
      photoId: null,
      quantity: 1,
    });
    setBusy(false);
    if (!result.ok) {
      setError(refusal(result));
      return;
    }
    setBagCount(galleryId, bagCount(result.data));
    router.push(`/shop/bag?gallery=${encodeURIComponent(galleryId)}`);
  };

  const title = <ShopTitle>{t("titles.singles")}</ShopTitle>;
  if (!child || !data)
    return (
      <>
        {title}
        {failed ? (
          <MessageScreen>
            <button type="button" onClick={() => void reload()} className={shopButton}>
              {t("retry")}
            </button>
          </MessageScreen>
        ) : (
          <Loading label={t("loading")} />
        )}
      </>
    );
  const firstName = child.state === "open" ? child.firstName : t("yourChild");
  return (
    <>
      {title}
      <ShopHeader
        title={t("buy.singlesTitle")}
        back={`/shop/c/${childId}/buy${pose}`}
        gallery={galleryId}
      />
      <main className="px-4 pt-4 pb-32">
        {data.state !== "open" ? (
          <MessageScreen>
            {t(data.state === "closed" ? "gallery.closed" : "gallery.unavailable", { studio })}
          </MessageScreen>
        ) : items.length === 0 ? (
          <MessageScreen>{t("buy.nothing")}</MessageScreen>
        ) : (
          groups.map((group) =>
            group.items.length > 0 ? (
              <fieldset key={group.key} className="m-0 mb-6 flex flex-col gap-3 border-0 p-0">
                <legend className="mb-3 p-0 text-title-sm">{t(`buy.${group.key}`)}</legend>
                {group.items.map((i) => (
                  <OptionCard
                    key={i.id}
                    name="single"
                    value={i.id}
                    checked={selected?.id === i.id}
                    onChange={() => setChosen(i.id)}
                    title={i.name}
                    description={
                      i.kind === "digital_all"
                        ? (i.description ?? t("buy.allDigitalsHint", { name: firstName }))
                        : i.description
                    }
                    price={money(i.price)}
                  />
                ))}
              </fieldset>
            ) : null,
          )
        )}
        <p role="alert" className="m-0 text-caption text-danger">
          {error}
        </p>
        {data.state === "open" ? (
          <p className="m-0 mt-2 text-center">
            <Link href={`/shop/c/${childId}/buy${pose}`} className={shopLink}>
              {t("buy.packagesLink")}
            </Link>
          </p>
        ) : null}
      </main>
      {data.state === "open" && selected ? (
        <DockedCta price={money(selected.price)} label={selected.name}>
          {selected.kind === "digital_all" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void addAll(selected)}
              className={shopButton}
            >
              {t("pose.add")}
            </button>
          ) : (
            <Link href={`/shop/c/${childId}/buy/${selected.id}${pose}`} className={shopButton}>
              {t("buy.continue")}
            </Link>
          )}
        </DockedCta>
      ) : null}
    </>
  );
}

export default function SinglesPage() {
  return (
    <Suspense>
      <Singles />
    </Suspense>
  );
}
