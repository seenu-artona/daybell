"use client";

import type { GroupLabel, Milestone, Todo, TodoKey } from "@daybell/core";
import { Button, Card, CardRow, IconChip, type IconChipTone } from "@daybell/ui";
import {
  BadgeDollarSign,
  Check,
  Landmark,
  QrCode,
  Store,
  Tags,
  Truck,
  Upload,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";
import { tabHref } from "./tabs";

const ICONS: Record<TodoKey, typeof Check> = {
  jobCreated: Check,
  rosterAdded: Users,
  printQrCards: QrCode,
  uploadPhotos: Upload,
  tagPhotos: Tags,
  choosePriceList: BadgeDollarSign,
  connectPayouts: Landmark,
  startSelling: Store,
  sendToLab: Truck,
};

/** Done to-dos get a lime chip with a check; open ones green; Soon ones grey. Decorative: the row says its state. */
function chipFor(todo: Todo): IconChipTone {
  if (todo.done) return "lime";
  return todo.soon ? "neutral" : "primary";
}

/**
 * The current milestone's to-dos (D140), beside Recent activity: one hairline row each, with a pastel chip, the
 * to-do, a short note and its state in words ("Done", "To do", "Soon"). "Roster added" links to People while there
 * is no roster (for people who can edit it); Soon items have no link or button until their step ships.
 */
export function MilestoneTodos({
  milestone,
  todos,
  jobId,
  createdOn,
  roster,
  canEditRoster,
}: {
  milestone: Milestone;
  todos: Todo[];
  jobId: string;
  /** The day the job was created, already formatted. */
  createdOn: string;
  roster: { children: number; groups: number; duplicates: number; word: GroupLabel };
  canEditRoster: boolean;
}) {
  const t = useTranslations("app.job");
  const tr = useTranslations("app.roster");
  const titleId = useId();
  const done = todos.filter((todo) => todo.done).length;
  const people = tabHref(jobId, "people");

  const note = (todo: Todo): ReactNode => {
    switch (todo.key) {
      case "jobCreated":
        return t("todos.notes.jobCreated", { date: createdOn });
      case "rosterAdded":
        if (roster.children === 0)
          return canEditRoster ? t("todos.notes.rosterMissing") : tr("emptyReadOnly");
        return (
          <>
            {t("todos.notes.rosterAdded", {
              children: roster.children,
              groups: roster.groups,
              group: roster.word,
            })}
            {roster.duplicates > 0 ? (
              <>
                <span aria-hidden="true"> · </span>
                <Link
                  href={`${people}?show=duplicates`}
                  className="font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {t("todos.notes.duplicates", { count: roster.duplicates })}
                </Link>
              </>
            ) : null}
          </>
        );
      default:
        return t(`todos.notes.${todo.key}`);
    }
  };

  const state = (todo: Todo): ReactNode => {
    if (todo.done)
      return <span className="text-label font-bold text-muted">{t("todos.done")}</span>;
    if (todo.soon)
      return (
        <span className="inline-flex h-8 items-center rounded-full bg-subtle px-3 text-label font-bold text-muted">
          {t("todos.soon")}
        </span>
      );
    const todoText = <span className="text-label font-bold text-ink">{t("todos.todo")}</span>;
    if (todo.key === "rosterAdded" && canEditRoster)
      return (
        <span className="flex items-center gap-3">
          {todoText}
          <Button asChild variant="secondary" shape="pill">
            <Link href={people}>{t("todos.addRoster")}</Link>
          </Button>
        </span>
      );
    return todoText;
  };

  return (
    <Card variant="sheet" asChild>
      <section aria-labelledby={titleId}>
        <CardRow>
          <h2 id={titleId} className="m-0 flex-1 text-h3 font-bold">
            {t("todos.title", { milestone: t(`timeline.milestones.${milestone}`) })}
          </h2>
          <p className="m-0 text-label text-muted">
            {t("todos.progress", { done, total: todos.length })}
          </p>
        </CardRow>
        <ul className="m-0 list-none p-0">
          {todos.map((todo) => {
            const Icon = ICONS[todo.key];
            return (
              <CardRow key={todo.key} asChild>
                <li className="py-2">
                  <IconChip tone={chipFor(todo)}>
                    <Icon />
                  </IconChip>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={`text-title-sm ${todo.done ? "font-semibold text-muted" : "text-ink"}`}
                    >
                      {t(`todos.items.${todo.key}`)}
                    </span>
                    <span className="text-label font-medium text-muted">{note(todo)}</span>
                  </span>
                  {state(todo)}
                </li>
              </CardRow>
            );
          })}
        </ul>
      </section>
    </Card>
  );
}
