"use client";

import { canSeePayouts } from "@daybell/core";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useStudio } from "../me-context";
import { PageFrame } from "../page-frame";

const TAB =
  "inline-flex min-h-11 items-center rounded-full px-4 font-semibold no-underline text-muted hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-[current=page]:bg-ink aria-[current=page]:text-white";

/**
 * Settings (ADR 0020): the heading and its sections, Team for everyone, and Payouts and Taxes (ADR 0023) for owners
 * and admins only (Seenu, answer 1: photographers and staff don't see them). The current section is marked with aria-current, not
 * colour alone (D91).
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const t = useTranslations("app.settings");
  const { me } = useStudio();
  const path = usePathname().replace(/\/+$/, "");
  const sections = [
    { href: "/app/settings", label: t("sections.team") },
    ...(canSeePayouts(me.studio.role)
      ? [
          { href: "/app/settings/payouts", label: t("sections.payouts") },
          // Taxes go with payouts: owners and admins see them, the owner changes them (ADR 0023, call 6).
          { href: "/app/settings/taxes", label: t("sections.taxes") },
        ]
      : []),
  ];
  return (
    <PageFrame>
      <h1 className="m-0 text-h1">{t("title")}</h1>
      <nav aria-label={t("sections.label")}>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {sections.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className={TAB}
                aria-current={path === s.href ? "page" : undefined}
              >
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </PageFrame>
  );
}
