"use client";

import { Button, Card } from "@daybell/ui";
import { Hammer } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * A section still being built (D128). "page" is a whole page with its own h1 and a way back to Home; "section" sits in
 * a job's main area under the job's h1 (D138), so it has an h2 and no back link, in a white sheet card (D140).
 */
export function ComingSoon({
  name,
  variant = "page",
}: {
  /** The section's translated name. */
  name: string;
  variant?: "page" | "section";
}) {
  const t = useTranslations("app.soon");
  const Heading = variant === "page" ? "h1" : "h2";
  return (
    <Card
      variant={variant === "section" ? "sheet" : "default"}
      className="flex flex-col items-center gap-3 py-12 text-center"
    >
      <span
        className="grid size-14 place-items-center rounded-full bg-lime-soft"
        aria-hidden="true"
      >
        <Hammer className="size-6" />
      </span>
      <Heading className="m-0 text-h2">{t("title", { section: name })}</Heading>
      <p className="m-0 max-w-100 text-muted">{t("body")}</p>
      {variant === "page" ? (
        <Button asChild variant="secondary">
          <Link href="/app">{t("back")}</Link>
        </Button>
      ) : null}
    </Card>
  );
}
