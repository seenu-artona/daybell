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
import { type ReactNode, useEffect, useId, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { onboardingHref, taskHref } from "./checklist-links";
import { ChecklistGroups, ChecklistProgress } from "./checklist-list";
import { useStudio } from "./me-context";

function Panel({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-5 pt-4 pb-3"
    >
      <div>
        <h2 id={titleId} className="m-0 text-[15px] leading-5 font-bold">
          {title}
        </h2>
        {intro ? <p className="m-0 text-caption text-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

const ROW =
  "flex min-h-14 items-center gap-3 py-2 no-underline text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

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
  const content = (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="font-bold">{t(`tasks.${item.task}`)}</span>
      <span className="text-caption text-muted">{tu("row", { job: item.jobName, reason })}</span>
    </span>
  );
  return (
    <li className="border-t border-line first:border-t-0">
      {canDoTask(role, item.task) ? (
        <Link
          href={taskHref(item.jobId, taskTarget(item.task))}
          className={`${ROW} hover:bg-subtle`}
        >
          {content}
        </Link>
      ) : (
        <div className={ROW}>{content}</div>
      )}
    </li>
  );
}

/**
 * Home's checklist (D143; ADR 0017), in place of "Needs you" (Seenu, answer 6). Owners and admins see "Set up your
 * studio" until it is first complete; after that, and for everyone else, "Up next": the three most urgent tasks across
 * the studio's jobs, each with why it was picked, and a link to the Jobs list for the rest.
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
      <Panel title={t("checklistTitle")}>
        <p className="m-0 text-muted">{error}</p>
      </Panel>
    );
  if (!data)
    return (
      <Panel title={t("checklistTitle")}>
        <p className="m-0 text-muted">{t("checking")}</p>
      </Panel>
    );

  if (data.onboarding) {
    // The server sends what is done; the order and "next" come from the same core rule.
    const done = new Map(data.onboarding.tasks.map((task) => [task.key, task.done]));
    const tasks = onboardingChecklist({
      hasJob: done.get("firstJob") === true,
      priceListReviewed: done.get("priceList") === true,
    }).filter((task) => done.has(task.key));
    return (
      <Panel title={t("onboarding.title")}>
        <ChecklistProgress done={tasks.filter((x) => x.done).length} total={tasks.length} />
        <ChecklistGroups
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
      </Panel>
    );
  }

  const upNext = data.upNext ?? { items: [], total: 0 };
  const more = upNext.total - upNext.items.length;
  return (
    <Panel title={t("upNext.title")} intro={t("upNext.intro")}>
      {upNext.items.length === 0 ? (
        <p className="m-0 pb-2 text-muted">{t("upNext.empty")}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {upNext.items.map((item) => (
            <UpNextRow key={item.jobId} item={item} role={role} />
          ))}
        </ul>
      )}
      {more > 0 ? (
        <Link
          href="/app/jobs"
          className="inline-flex min-h-11 items-center self-start font-semibold text-primary no-underline hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {t("upNext.more", { count: more })}
        </Link>
      ) : null}
    </Panel>
  );
}
