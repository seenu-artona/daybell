"use client";

import { SHOP_SIBLING_LIMIT } from "@daybell/core";
import { cn } from "@daybell/ui";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useChildName } from "./format";
import { useShop } from "./shop-context";

/**
 * The gallery's children as links (the current one marked), and "Add a brother or sister" while fewer than 5. A child
 * whose shop isn't open is "Your child" (security review M1).
 */
export function ChildSwitcher({ current }: { current: string }) {
  const t = useTranslations("shop.header");
  const childName = useChildName();
  const gallery = useShop().galleryOf(current);
  if (!gallery) return null;
  const children = gallery.children;
  const canAdd = children.length < SHOP_SIBLING_LIMIT;
  if (children.length < 2 && !canAdd) return null;
  return (
    <nav aria-label={t("children")} className="mt-3">
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {children.map((c) => (
          <li key={c.id}>
            <Link
              href={`/shop/c/${c.id}`}
              aria-current={c.id === current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-studio-ring",
                c.id === current
                  ? "border-studio bg-studio text-on-studio"
                  : "border-line-strong bg-surface text-ink",
              )}
            >
              {childName(c)}
            </Link>
          </li>
        ))}
        {canAdd ? (
          <li>
            <Link
              href={`/shop/add?gallery=${encodeURIComponent(gallery.id)}`}
              aria-label={t("addChild")}
              className="grid size-11 place-items-center rounded-full border border-line-strong bg-surface text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-studio-ring"
            >
              <Plus className="size-5" aria-hidden="true" />
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
