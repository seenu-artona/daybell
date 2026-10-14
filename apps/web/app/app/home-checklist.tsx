"use client";

import type { StudioChecklistResponse, UpNextItem } from "@daybell/api";
import {
  canDoOnboardingTask,
  canDoTask,
  localDay,
  onboardingChecklist,
  taskTarget,
} from "@daybell/core";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { onboardingHref, taskHref } from "./checklist-links";
import { ChecklistGroups, ChecklistProgress } from "./checklist-list";
import { HOME_FOOTER_LINK, HomeCard, HomeLinkRow, HomeNote, HomeRow, HomeRows } from "./home-card";
import { useStudio } from "./me-context";

function UpNextRow({ item, role }: { item: UpNextItem; role: string }) {
  const t = useTranslations("app.checklist");
  const tu = useTranslations("app.home.upNext");
  const r = item.reason;
  const reason =
    r.kind === "brokenPhotos"
      ? tu("reasons.brokenPhotos", { count: r.count })
      : r.kind === "taggingProblems"
        ? tu("reasons.taggingProblems", { leftovers: r.leftovers, flagged: r.flagged })
        : r.kind === "nextStep"
          ? tu("reasons.nextStep")
          : tu(`reasons.${r.kind}`, { days: r.days });
  const task = t(`tasks.${item.task}`);
  const why = tu("row", { job: item.jobName, reason });
  return canDoTask(role, item.task) ? (
    <HomeLinkRow href={taskHref(item.jobId, taskTarget(item.task))} name={task} detail={why} />
  ) : (
    <HomeRow>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">{task}</span>
        <span className="text-body text-muted">{why}</span>
      </span>
    </HomeRow>
  );
}

/**
 * Home's checklist (D143; ADR 0017), in place of "Needs you" (Seenu, answer 6). Owners and admins see "Set up your
 * studio" until it is first complete; after that, and for everyone else, "Up next": the three most urgent tasks across
 * the studio's jobs, each with why it was picked, and a link to the Jobs list for the rest (the card's footer). A list
 * card whose rows open where the work happens (D145, amends D144).
 */
export function HomeChecklist() {
  const t = useTranslations("app.home");
  const text = useApiText();
  const { me, version } = useStudio();
  const role = me.studio.role;
  const [data, setData] = useState<StudioChecklistResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version re-checks after job changes.
  useEffect(() => {
    api<StudioChecklistResponse>(`/studio/checklist?today=${localDay(new Date())}`).then((res) => {
      if (res.ok) setData(res.data);
      else setError(text.error(res.code));
    });
  }, [version, text]);

  // Until the answer arrives, a neutral title: it may be either the setup checklist or Up next (code review N6).
  if (error)
    return (
      <HomeCard title={t("checklistTitle")}>
        <HomeNote>{error}</HomeNote>
      </HomeCard>
    );
  if (!data)
    return (
      <HomeCard title={t("checklistTitle")}>
        <HomeNote>{t("checking")}</HomeNote>
      </HomeCard>
    );

  if (data.onboarding) {
    // The server sends what is done; the order and "next" come from the same core rule.
    const done = new Map(data.onboarding.tasks.map((task) => [task.key, task.done]));
    const tasks = onboardingChecklist({
      hasJob: done.get("firstJob") === true,
      priceListReviewed: done.get("priceList") === true,
      payoutsConnected: done.get("payouts") === true,
    }).filter((task) => done.has(task.key));
    return (
      <HomeCard title={t("onboarding.title")}>
        <div className="px-6 pb-4">
          <ChecklistProgress done={tasks.filter((x) => x.done).length} total={tasks.length} />
        </div>
        <ChecklistGroups
          look="rows"
          groups={[
            {
              key: "onboarding",
              rows: tasks.map((task) => ({
                key: task.key,
                label: t(`onboarding.tasks.${task.key}`),
                state: task.state,
                href: canDoOnboardingTask(role, task.key) ? onboardingHref(task.key) : null,
              })),
            },
          ]}
        />
      </HomeCard>
    );
  }

  const upNext = data.upNext ?? { items: [], total: 0 };
  const more = upNext.total - upNext.items.length;
  return (
    <HomeCard
      title={t("upNext.title")}
      intro={t("upNext.intro")}
      footer={
        more > 0 ? (
          <Link href="/app/jobs" className={HOME_FOOTER_LINK}>
            {t("upNext.more", { count: more })}
          </Link>
        ) : null
      }
    >
      {upNext.items.length === 0 ? (
        <HomeNote>{t("upNext.empty")}</HomeNote>
      ) : (
        <HomeRows>
          {upNext.items.map((item) => (
            <UpNextRow key={item.jobId} item={item} role={role} />
          ))}
        </HomeRows>
      )}
    </HomeCard>
  );
}
