"use client";

import { Button, Card } from "@daybell/ui";
import { Hammer } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export function ComingSoon({ section }: { section: string }) {
  const t = useTranslations("app");
  const name = section === "shop" ? t("top.viewShop") : t(`nav.${section as "jobs"}`);
  return (
    <Card className="flex flex-col items-center gap-3 py-12 text-center">
      <span
        className="grid size-14 place-items-center rounded-full bg-lime-soft"
        aria-hidden="true"
      >
        <Hammer className="size-6" />
      </span>
      <h1 className="m-0 text-h2">{t("soon.title", { section: name })}</h1>
      <p className="m-0 max-w-100 text-muted">{t("soon.body")}</p>
      <Button asChild variant="secondary">
        <Link href="/app">{t("soon.back")}</Link>
      </Button>
    </Card>
  );
}
