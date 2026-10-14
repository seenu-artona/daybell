"use client";

import { type PeoplePage as PeopleSection, peopleSections } from "@daybell/core";
import { MainTab, MainTabs } from "@daybell/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ListPage } from "../list-page";
import { useStudio } from "../me-context";

/**
 * People (D150; ADR 0028): the h1 "People" with the section's one green action (Clients: New client, Contacts: New
 * contact), then the pill tabs Clients · Contacts · Families · Subjects (links with aria-current) and, at the right of
 * that row, a muted line saying what the section holds. Families is left out for people who don't see order data
 * (Seenu's answer 2).
 */
export function PeoplePage({
  current,
  action,
  children,
}: {
  current: PeopleSection;
  action?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("app.peoplePage");
  const { me } = useStudio();
  return (
    <ListPage
      title={t("title")}
      action={action}
      sections={
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <MainTabs label={t("sectionsLabel")}>
            {peopleSections(me.studio.role).map((section) => (
              <MainTab key={section} asChild current={section === current}>
                <Link href={`/app/people/${section}`}>{t(`sections.${section}`)}</Link>
              </MainTab>
            ))}
          </MainTabs>
          <p className="m-0 ml-auto text-body text-muted">{t(`about.${current}`)}</p>
        </div>
      }
    >
      {children}
    </ListPage>
  );
}
