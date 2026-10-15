"use client";

import { canSeePayouts } from "@daybell/core";
import { Button, Card } from "@daybell/ui";
import { Copy } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";
import { useStudio } from "../../me-context";
import { SETTINGS_HREF } from "../sections";

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";

function SoonPill() {
  const t = useTranslations("app.settings.shop");
  return (
    <span className="rounded-full border border-line-strong px-2 text-micro text-muted">
      {t("soon")}
    </span>
  );
}

/** One white card with its heading (D154's Settings frame). */
function ShopCard({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <Card variant="sheet" asChild>
      <section aria-labelledby={id} className="flex flex-col gap-3 px-6 pt-5 pb-4">
        <h2 id={id} className="m-0 text-h3 font-bold">
          {title}
        </h2>
        {children}
      </section>
    </Card>
  );
}

/**
 * Settings › Shop's cards (D157; B3a–B3e): Look (the studio's name as parents see it; a logo upload is Soon; D62),
 * Shop address (the one /shop address with Copy, its result announced), Checkout and Policies (how they work today,
 * with links to Taxes and Stripe for owners and admins, and to Price lists), then Coupons and Gift cards (Soon). Parent
 * email wording stays in Templates › Messages (D157). Nothing here can be changed.
 */
export function ShopSettings({ address }: { address: string }) {
  const t = useTranslations("app.settings.shop");
  const { me } = useStudio();
  const [copied, setCopied] = useState("");
  const managers = canSeePayouts(me.studio.role);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(t("address.copied"));
    } catch {
      setCopied(t("address.copyFailed"));
    }
  }

  return (
    <>
      <p className="m-0 text-muted">{t("intro")}</p>
      <ShopCard title={t("look.title")}>
        <p className="m-0">{t("look.name", { name: me.studio.name })}</p>
        <p className="m-0 text-muted">{t("look.onlyYours")}</p>
        <p className="m-0 flex min-h-11 items-center justify-between gap-3 border-t border-line pt-3 text-muted">
          <span>{t("look.logo")}</span>
          <SoonPill />
        </p>
      </ShopCard>
      <ShopCard title={t("address.title")}>
        <p className="m-0 text-muted">{t("address.body")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="sr-only">{t("address.label")}: </span>
          <code className="rounded-md border border-line bg-subtle px-3 py-2 text-sm text-ink">
            {address}
          </code>
          <Button
            variant="secondary"
            aria-label={t("address.copyLabel")}
            onClick={() => void copy()}
          >
            <Copy aria-hidden="true" />
            {t("address.copy")}
          </Button>
        </div>
        {/* Always rendered, so the result is read out when it arrives (WCAG 4.1.3). */}
        <p role="status" aria-live="polite" className="m-0 text-sm text-muted empty:sr-only">
          {copied}
        </p>
      </ShopCard>
      <ShopCard title={t("checkout.title")}>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
          <li>{t("checkout.pay")}</li>
          <li>{t("checkout.tax")}</li>
          <li>{t("checkout.shipping")}</li>
          <li>{t("checkout.receipt")}</li>
        </ul>
        <div className="flex flex-wrap gap-x-6">
          {managers ? (
            <>
              <Link href={SETTINGS_HREF.taxes} className={LINK}>
                {t("checkout.taxes")}
              </Link>
              <Link href={SETTINGS_HREF.payouts} className={LINK}>
                {t("checkout.stripe")}
              </Link>
            </>
          ) : null}
          <Link href="/app/products" className={LINK}>
            {t("checkout.priceLists")}
          </Link>
        </div>
      </ShopCard>
      <ShopCard title={t("policies.title")}>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
          <li>{t("policies.cancel")}</li>
          <li>{t("policies.refund")}</li>
          <li>{t("policies.downloads")}</li>
        </ul>
      </ShopCard>
      <ShopCard title={t("more.title")}>
        <ul className="m-0 flex list-none flex-col p-0">
          {(["coupons", "giftCards"] as const).map((key) => (
            <li
              key={key}
              className="flex min-h-11 items-center justify-between gap-3 border-b border-line text-muted last:border-b-0"
            >
              <span>{t(`more.${key}`)}</span>
              <SoonPill />
            </li>
          ))}
        </ul>
      </ShopCard>
    </>
  );
}
