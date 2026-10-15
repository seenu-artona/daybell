"use client";

import { buttonVariants } from "@daybell/ui";
import { ChevronRight, CreditCard, LayoutTemplate, Receipt, Store, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useStudio } from "../me-context";
import {
  SETTINGS_HREF,
  type SettingsSection,
  settingsSectionFor,
  settingsSections,
} from "./sections";

const ICONS: Record<SettingsSection, typeof Users> = {
  team: Users,
  payouts: CreditCard,
  taxes: Receipt,
  templates: LayoutTemplate,
  shop: Store,
};

/**
 * Settings (D151, D154; ADR 0029): sections on the left (Team for everyone, Stripe and Taxes for owners and admins,
 * Templates and Shop for everyone; ADR 0020, 0023, 0033), each an icon tile, its name and a chevron, the current one white and marked
 * with aria-current, not colour alone (D91); the section's content on the right as white cards. On Templates, owners
 * and admins get the green "New template" in the title row. A template's own page has its own header and frame.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const t = useTranslations("app.settings");
  const tt = useTranslations("app.templates");
  const { me } = useStudio();
  const current = settingsSectionFor(usePathname());
  if (current === null) return <>{children}</>;
  const canManage = me.studio.role === "owner" || me.studio.role === "admin";
  return (
    <div className="flex w-full flex-col gap-7 px-10 pt-8 pb-12">
      <div className="flex min-h-11 items-center gap-4">
        <h1 className="m-0 min-w-0 flex-1 text-h1 text-ink">{t("title")}</h1>
        {current === "templates" && canManage ? (
          <Link
            href={`${SETTINGS_HREF.templates}?new=1`}
            scroll={false}
            className={`${buttonVariants({ shape: "pill" })} no-underline`}
          >
            {tt("new")}
          </Link>
        ) : null}
      </div>
      <div className="flex items-start gap-14">
        <nav aria-label={t("sections.label")} className="w-85 shrink-0">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {settingsSections(me.studio.role).map((section) => {
              const Icon = ICONS[section];
              return (
                <li key={section}>
                  <Link
                    href={SETTINGS_HREF[section]}
                    aria-current={current === section ? "page" : undefined}
                    className="group flex min-h-16 items-center gap-4 rounded-lg px-3 text-ink no-underline hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary aria-[current=page]:bg-surface"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary [&_svg]:size-5"
                    >
                      <Icon />
                    </span>
                    <span className="flex-1 text-h3 font-semibold">{t(`sections.${section}`)}</span>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-5 text-line-strong group-hover:text-muted"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}
