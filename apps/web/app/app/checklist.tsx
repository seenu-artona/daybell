"use client";

import type { PendingInvite, TeamMember } from "@daybell/api";
import { Badge, Card, CardTitle, JobProgress } from "@daybell/ui";
import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { useStudio } from "./me-context";

interface Step {
  key: "studio" | "team" | "brand" | "products" | "payouts" | "job";
  href?: string;
  done: boolean;
  soon: boolean;
}

/** "Get ready to sell" (D127). Leads Home until every step is done, then disappears. */
export function Checklist() {
  const t = useTranslations("app.checklist");
  const { me, version } = useStudio();
  const [hasTeam, setHasTeam] = useState<boolean | null>(null);
  const canInvite = me.studio.role === "owner" || me.studio.role === "admin";

  // biome-ignore lint/correctness/useExhaustiveDependencies: version re-checks after team changes.
  useEffect(() => {
    Promise.all([
      api<{ team: TeamMember[] }>("/studio/team"),
      canInvite ? api<{ invites: PendingInvite[] }>("/studio/invites") : Promise.resolve(null),
    ]).then(([team, invites]) => {
      const members = team.ok ? team.data.team.length : 1;
      const open = invites?.ok ? invites.data.invites.length : 0;
      setHasTeam(members > 1 || open > 0);
    });
  }, [version, canInvite]);

  if (hasTeam === null) return null;
  const steps: Step[] = [
    { key: "studio", done: true, soon: false },
    { key: "team", href: "/app/settings", done: hasTeam, soon: false },
    { key: "brand", done: false, soon: true },
    { key: "products", done: false, soon: true },
    { key: "payouts", done: false, soon: true },
    { key: "job", done: false, soon: true },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;

  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>{t("title")}</CardTitle>
      <JobProgress
        title={t("progress", { done, total: steps.length })}
        percent={(done / steps.length) * 100}
        label={t("title")}
      />
      <ol className="m-0 flex list-none flex-col p-0">
        {steps.map((step) => {
          const body = (
            <>
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-full border-2 ${step.done ? "border-primary bg-primary text-on-primary" : "border-line-strong"}`}
                aria-hidden="true"
              >
                {step.done ? <Check className="size-4" strokeWidth={3} /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block font-semibold ${step.done ? "text-muted line-through" : ""}`}
                >
                  {t(step.key)}
                </span>
                <span className="block text-caption text-muted">{t(`${step.key}Body`)}</span>
              </span>
              {step.done ? <span className="sr-only">{t("done")}</span> : null}
              {step.soon ? <Badge tone="draft">{t("soon")}</Badge> : null}
              {step.href && !step.done ? (
                <ChevronRight className="size-5 text-muted" aria-hidden="true" />
              ) : null}
            </>
          );
          return (
            <li key={step.key} className="border-b border-line last:border-b-0">
              {step.href && !step.done ? (
                <Link
                  href={step.href}
                  className="flex min-h-14 items-center gap-3 py-2 text-ink no-underline hover:bg-subtle"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex min-h-14 items-center gap-3 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
