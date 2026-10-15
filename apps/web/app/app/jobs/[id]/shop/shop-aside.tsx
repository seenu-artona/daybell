"use client";

import type { JobShop } from "@daybell/api";
import { Card, Switch } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { usePriceText } from "../../../products/price-text";

const SOON = ["earlyBird", "prepay", "yearbook", "reorders"] as const;

/**
 * Job › Shop's side (D157): Delivery (free delivery to the school as a switch, N9: the same data and API as before;
 * home shipping from the list) and "More for this job", each row marked Soon. Dates, Close shop and numbers stay on
 * Overview (D152).
 */
export function ShopAside({
  shop,
  deliverToSchool,
  editable,
  onSchool,
}: {
  shop: JobShop | null;
  deliverToSchool: boolean;
  editable: boolean;
  onSchool: (on: boolean) => void;
}) {
  const t = useTranslations("app.job.shop");
  const price = usePriceText();
  const deliveryTitle = useId();
  const moreTitle = useId();
  const schoolHelp = useId();
  return (
    <aside className="flex min-w-0 flex-col gap-5">
      <Card variant="sheet" asChild>
        <section aria-labelledby={deliveryTitle} className="flex flex-col gap-3 px-6 pt-5 pb-4">
          <h3 id={deliveryTitle} className="m-0 text-h3 font-bold">
            {t("delivery")}
          </h3>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="text-label text-ink">{t("toSchool")}</span>
              <span id={schoolHelp} className="text-caption text-muted">
                {t("toSchoolHelp")}
              </span>
            </div>
            {editable ? (
              <Switch
                checked={deliverToSchool}
                onCheckedChange={onSchool}
                label={t("toSchool")}
                aria-describedby={schoolHelp}
                onText={t("on")}
                offText={t("off")}
              />
            ) : (
              <span className="min-h-11 pt-2 text-sm font-semibold">
                {deliverToSchool ? t("on") : t("off")}
              </span>
            )}
          </div>
          <div className="flex flex-col border-t border-line pt-3">
            <span className="text-label text-ink">{t("homeShipping")}</span>
            <span className="text-caption text-muted">
              {shop
                ? t("homeShippingNote", { fee: price.money(shop.priceList.homeShipping) })
                : t("loading")}
            </span>
          </div>
        </section>
      </Card>
      <Card variant="sheet" asChild>
        <section aria-labelledby={moreTitle} className="flex flex-col gap-1 px-6 pt-5 pb-4">
          <h3 id={moreTitle} className="m-0 mb-1 text-h3 font-bold">
            {t("more.title")}
          </h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {SOON.map((key) => (
              <li
                key={key}
                className="flex min-h-11 items-center justify-between gap-3 border-b border-line text-muted last:border-b-0"
              >
                <span>{t(`more.${key}`)}</span>
                <span className="rounded-full border border-line-strong px-2 text-micro text-muted">
                  {t("more.soon")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </Card>
    </aside>
  );
}
