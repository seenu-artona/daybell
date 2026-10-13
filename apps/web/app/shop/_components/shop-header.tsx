"use client";

import { ChevronLeft, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useShop } from "./shop-context";
import { ShopMenu } from "./shop-menu";
import { shopIconButton } from "./styles";

/** The bar on every shop page: back, the page's title (its h1), the bag with its count, and the ⋯ menu. */
export function ShopHeader({ title, back }: { title: string; back?: string }) {
  const t = useTranslations("shop.header");
  const { state } = useShop();
  const count = state.status === "ready" ? state.session.bagCount : 0;
  return (
    <header className="sticky top-0 z-20 flex min-h-14 items-center gap-1 border-b border-line bg-surface px-1.5">
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
      <Link href="/shop/bag" aria-label={t("bag", { count })} className={shopIconButton}>
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
      <ShopMenu />
    </header>
  );
}
