"use client";

import type { ShopItem, ShopPriceListResponse } from "@daybell/api";
import { OptionCard } from "@daybell/ui";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useState } from "react";
import { shopApi } from "@/lib/shop-client";
import { DockedCta } from "../../../_components/docked-cta";
import { money, useContents } from "../../../_components/format";
import { Loading, MessageScreen } from "../../../_components/message-screen";
import { ShopHeader } from "../../../_components/shop-header";
import { shopButton, shopLink } from "../../../_components/styles";
import { useChildData } from "../../../_components/use-child";

/** "Choose a package" (D24: package, then pose): a radio list, with the price docked beside Continue. */
function Packages() {
  const t = useTranslations("shop");
  const contents = useContents();
  const photo = useSearchParams().get("photo");
  const { childId, child, studio, data } = useChildData<ShopPriceListResponse>(shopApi.priceList);
  const packages = data?.priceList?.items.filter((i) => i.kind === "package") ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    if (!chosen && packages[0]) setChosen(packages[0].id);
  }, [chosen, packages]);
  const selected: ShopItem | undefined = packages.find((p) => p.id === chosen);
  const pose = photo ? `?photo=${encodeURIComponent(photo)}` : "";
  const back = `/shop/c/${childId}`;

  if (!child || !data) return <Loading label={t("loading")} />;
  return (
    <>
      <ShopHeader title={t("buy.packagesTitle")} back={back} />
      <main className="px-4 pt-4 pb-32">
        {data.state !== "open" ? (
          <MessageScreen>
            {t(data.state === "closed" ? "gallery.closed" : "gallery.unavailable", { studio })}
          </MessageScreen>
        ) : (
          <>
            {packages.length === 0 ? (
              <MessageScreen>{t("buy.nothing")}</MessageScreen>
            ) : (
              <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
                <legend className="sr-only">{t("buy.packagesTitle")}</legend>
                {packages.map((p) => (
                  <OptionCard
                    key={p.id}
                    name="package"
                    value={p.id}
                    checked={chosen === p.id}
                    onChange={() => setChosen(p.id)}
                    title={p.name}
                    description={p.description ?? contents(p.contents)}
                    price={money(p.price)}
                  />
                ))}
              </fieldset>
            )}
            <p className="m-0 mt-4 text-center">
              <Link href={`/shop/c/${childId}/buy/singles${pose}`} className={shopLink}>
                {t("buy.singlesLink")}
              </Link>
            </p>
          </>
        )}
      </main>
      {data.state === "open" && selected ? (
        <DockedCta price={money(selected.price)} label={selected.name}>
          <Link href={`/shop/c/${childId}/buy/${selected.id}${pose}`} className={shopButton}>
            {t("buy.continue")}
          </Link>
        </DockedCta>
      ) : null}
    </>
  );
}

export default function PackagesPage() {
  return (
    <Suspense>
      <Packages />
    </Suspense>
  );
}
