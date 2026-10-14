"use client";

import { canSeeOrders } from "@daybell/core";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { ComingSoon } from "../../[section]/coming-soon";
import { useStudio } from "../../me-context";
import { PeoplePage } from "../people-page";

/**
 * People › Families (D150; Seenu's answer 2): waits for parent accounts, so it is a coming-soon panel (D128). Families
 * hold parents' orders, so people who don't see order data (photographers) have no Families tab, and this address
 * takes them to Clients.
 */
export default function FamiliesPage() {
  const t = useTranslations("app.peoplePage");
  const { me } = useStudio();
  const router = useRouter();
  const allowed = canSeeOrders(me.studio.role);

  useEffect(() => {
    if (!allowed) router.replace("/app/people/clients");
  }, [allowed, router]);

  if (!allowed) return null;
  return (
    <PeoplePage current="families">
      <ComingSoon name={t("sections.families")} variant="section" />
    </PeoplePage>
  );
}
