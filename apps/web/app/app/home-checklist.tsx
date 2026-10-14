"use client";

import type { SalesResponse, StudioChecklistResponse, UpNextItem } from "@daybell/api";
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
import { orderTodoHref, type UpNextRow, upNextRows } from "./up-next-rows";

/** The orders waiting, from Home's numbers call; null for people who don't see orders (Q4). */
export interface HomeOrders {
  todo: SalesResponse["todo"] | null;
  failed: boolean;
}

function JobRow({ item, role }: { item: UpNextItem; role: string }) {
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
  const name = tu("row", { task: t(`tasks.${item.task}`), job: item.jobName });
  return canDoTask(role, item.task) ? (
    <HomeLinkRow href={taskHref(item.jobId, taskTarget(item.task))} name={name} detail={reason} />
  ) : (
    <HomeRow>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">{name}</span>
        <span className="text-body text-muted">{reason}</span>
      </span>
    </HomeRow>
  );
}

function Row({ row, role }: { row: UpNextRow; role: string }) {
  const tu = useTranslations("app.home.upNext");
  if (row.kind === "job") return <JobRow item={row.item} role={role} />;
  return (
    <HomeLinkRow
      href={orderTodoHref(row.todo)}
      name={tu(`orders.${row.todo}`, { count: row.count })}
      detail={tu(`ordersWhy.${row.todo}`)}
    />
  );
}

/**
 * Home's one Up next card (D146, amends D143): up to five rows mixing the jobs' tasks with the orders waiting, most
 * urgent first (`upNextRows`), each a plain link with a muted line saying why, and a link to the Jobs list for the jobs
 * not shown (the card's footer). Without the jobs' tasks (the setup checklist is showing, or it couldn't be loaded) it
 * holds the orders waiting alone, and is left out when none are.
 */
function UpNextCard({
  items,
  total,
  orders,
  role,
  ordersOnly = false,
}: {
  items: readonly UpNextItem[];
  total: number;
  orders: HomeOrders | null;
  role: string;
  ordersOnly?: boolean;
}) {
  const t = useTranslations("app.home");
  const loading = orders !== null && !orders.todo && !orders.failed;
  const rows = upNextRows(items, orders?.todo ?? null);
  if (ordersOnly && !loading && rows.length === 0 && !orders?.failed) return null;
  const more = total - rows.filter((row) => row.kind === "job").length;
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
      {loading ? (
        <HomeNote>{t("checking")}</HomeNote>
      ) : rows.length > 0 ? (
        <HomeRows>
          {rows.map((row) => (
            <Row key={row.kind === "job" ? row.item.jobId : row.todo} row={row} role={role} />
          ))}
        </HomeRows>
      ) : orders?.failed ? null : (
        <HomeNote>{t("upNext.empty")}</HomeNote>
      )}
      {orders?.failed ? <HomeNote>{t("upNext.ordersFailed")}</HomeNote> : null}
    </HomeCard>
  );
}

/**
 * Home's checklist (D143; ADR 0017), in place of "Needs you" (Seenu, answer 6). Owners and admins see "Set up your
 * studio" until it is first complete; after that, and for everyone else, "Up next" (D146). The orders waiting come
 * from the page (`orders`, null for people who don't see orders), which already asks for them with its numbers.
 */
export function HomeChecklist({ orders }: { orders: HomeOrders | null }) {
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

  const ordersAlone = orders ? (
    <UpNextCard items={[]} total={0} orders={orders} role={role} ordersOnly />
  ) : null;

  // Until the answer arrives, a neutral title: it may be either the setup checklist or Up next (code review N6).
  if (error)
    return (
      <>
        <HomeCard title={t("checklistTitle")}>
          <HomeNote>{error}</HomeNote>
        </HomeCard>
        {ordersAlone}
      </>
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
      <>
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
        {ordersAlone}
      </>
    );
  }

  const upNext = data.upNext ?? { items: [], total: 0 };
  return <UpNextCard items={upNext.items} total={upNext.total} orders={orders} role={role} />;
}
