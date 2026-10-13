"use client";

import { ChevronLeft, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useShop } from "./shop-context";
import { ShopMenu } from "./shop-menu";
import { shopIconButton } from "./styles";

/**
 * The bar on every shop page: back, the page's title (its h1), the gallery's bag with its count, and the ⋯ menu. It
 * is sticky, so globals.css keeps focused controls clear of it (data-shop-header; WCAG 2.4.11, code review S1).
 * `gallery`: which of the device's galleries (studios) the page is in; null for the first.
 */
export function ShopHeader({
  title,
  back,
  gallery = null,
}: {
  title: string;
  back?: string;
  gallery?: string | null;
}) {
  const t = useTranslations("shop.header");
  const shop = useShop();
  const current = shop.gallery(gallery);
  const count = current?.bagCount ?? 0;
  const bag = current ? `/shop/bag?gallery=${encodeURIComponent(current.id)}` : "/shop/bag";
  return (
    <header
      data-shop-header=""
      className="sticky top-0 z-20 flex min-h-14 items-center gap-1 border-b border-line bg-surface px-1.5"
    >
      {back ? (
        <Link href={back} aria-label={t("back")} className={shopIconButton}>
          <ChevronLeft className="size-6" aria-hidden="true" />
        </Link>
      ) : (
        <span className="w-2.5" />
      )}
      <h1 tabIndex={-1} className="m-0 min-w-0 flex-1 truncate text-title-sm focus:outline-none">
        {title}
      </h1>
      <Link href={bag} aria-label={t("bag", { count })} className={shopIconButton}>
        <ShoppingBag className="size-[22px]" aria-hidden="true" />
        {count > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-1 right-0.5 min-w-[18px] rounded-full bg-studio px-1 text-center text-micro text-on-studio"
          >
            {count}
          </span>
        ) : null}
      </Link>
      <ShopMenu gallery={current?.id ?? null} />
    </header>
  );
}
