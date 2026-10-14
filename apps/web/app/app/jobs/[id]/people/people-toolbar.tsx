"use client";

import type { Group } from "@daybell/api";
import type { GroupLabel } from "@daybell/core";
import { Button, buttonVariants, SearchToggle, ViewTab, ViewTabs } from "@daybell/ui";
import { ChevronDown, Plus, QrCode, Upload } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MENU_ROW, Popover } from "../../../popover";
import { QuietMenu } from "../../../quiet-menu";
import {
  type ClassChoice,
  classChoiceFrom,
  classChoiceValue,
  SUBJECT_VIEWS,
  type SubjectView,
  subjectsHref,
} from "./views";

export type GroupBy = "group" | "none";

/** Subjects' views (D144): links to ?show=, the current one marked with aria-current. */
export function SubjectsViews({ base, view }: { base: string; view: SubjectView }) {
  const t = useTranslations("app.people");
  return (
    <ViewTabs label={t("views.label")}>
      {SUBJECT_VIEWS.map((v) => (
        <ViewTab key={v} asChild current={v === view}>
          <Link href={subjectsHref(base, v)} scroll={false}>
            {v === "all" ? t("views.all") : t(`flags.${v}`)}
          </Link>
        </ViewTab>
      ))}
    </ViewTabs>
  );
}

/**
 * Subjects' tools at the right end of the view bar (D138, D144), in order: quiet menus for the class, the grade (only
 * when the roster has grades) and grouping; a quiet Print QR cards; the search; and the green Add subjects menu (Add
 * child, Import roster) for roster editors. The search text, class and grade stay in this browser: they are never sent
 * or put in the address (D113).
 */
export function SubjectsTools({
  hasRows,
  query,
  onQuery,
  classChoice,
  onClassChoice,
  grade,
  onGrade,
  groupBy,
  onGroupBy,
  groups,
  grades,
  word,
  canEdit,
  importHref,
  onPrint,
  onAdd,
}: {
  /** False while the roster loads or is empty: only Add subjects shows. */
  hasRows: boolean;
  query: string;
  onQuery: (query: string) => void;
  classChoice: ClassChoice;
  onClassChoice: (choice: ClassChoice) => void;
  grade: string;
  onGrade: (grade: string) => void;
  groupBy: GroupBy;
  onGroupBy: (groupBy: GroupBy) => void;
  groups: Group[];
  grades: string[];
  word: GroupLabel;
  canEdit: boolean;
  importHref: string;
  onPrint: () => void;
  onAdd: () => void;
}) {
  const t = useTranslations("app.people");
  const tr = useTranslations("app.roster");
  const tq = useTranslations("app.qrCards");
  const noGroup = tr("noGroup", { group: word });
  const className =
    classChoice.kind === "all"
      ? t("all")
      : classChoice.kind === "none"
        ? noGroup
        : (groups.find((g) => g.id === classChoice.id)?.name ?? t("all"));

  return (
    <>
      {hasRows ? (
        <>
          <QuietMenu
            label={t("classMenu", { group: word, value: className })}
            legend={tr("filter", { group: word })}
            value={classChoiceValue(classChoice)}
            onChange={(v) => onClassChoice(classChoiceFrom(v))}
            options={[
              { value: "", label: t("all") },
              ...groups.map((g) => ({ value: g.id, label: g.name })),
              { value: "none", label: noGroup },
            ]}
          />
          {grades.length > 0 ? (
            <QuietMenu
              label={t("gradeMenu", { value: grade || t("all") })}
              legend={t("grade")}
              value={grade}
              onChange={onGrade}
              options={[
                { value: "", label: t("all") },
                ...grades.map((g) => ({ value: g, label: g })),
              ]}
            />
          ) : null}
          <QuietMenu
            label={t("groupBy", {
              by: groupBy === "group" ? tr("filter", { group: word }) : t("groupNone"),
            })}
            legend={t("groupByLegend")}
            value={groupBy}
            onChange={(v) => onGroupBy(v as GroupBy)}
            options={[
              { value: "group", label: tr("filter", { group: word }) },
              { value: "none", label: t("groupNone") },
            ]}
          />
          {canEdit ? (
            <Button variant="quiet" shape="pill" onClick={onPrint}>
              <QrCode aria-hidden="true" />
              {tq("button")}
            </Button>
          ) : null}
          <SearchToggle label={t("searchLabel")} value={query} onChange={onQuery} />
        </>
      ) : null}
      {canEdit ? (
        <Popover
          trigger={
            <>
              <span>{t("addSubjects")}</span>
              <ChevronDown aria-hidden="true" />
            </>
          }
          triggerClassName={`${buttonVariants({ shape: "pill" })} hover:bg-primary-hover [&_svg]:size-4`}
          panelClassName="w-60"
        >
          {(close) => (
            <>
              <button
                type="button"
                className={MENU_ROW}
                onClick={() => {
                  close();
                  onAdd();
                }}
              >
                <Plus aria-hidden="true" />
                {tr("add")}
              </button>
              <Link href={importHref} className={MENU_ROW} onClick={close}>
                <Upload aria-hidden="true" />
                {tr("import")}
              </Link>
            </>
          )}
        </Popover>
      ) : null}
    </>
  );
}
