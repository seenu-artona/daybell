"use client";

import type { Group } from "@daybell/api";
import type { GroupLabel } from "@daybell/core";
import { Button } from "@daybell/ui";
import { ChevronRight, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { forwardRef } from "react";
import { FloatingPanel } from "../floating-panel";

/** The DOM id of a class's Rename button, so focus can return to it when the rename dialog closes. */
export const renameButtonId = (groupId: string) => `rename-class-${groupId}`;

/**
 * Under Subjects' list, for roster editors (D147, Seenu's answer of Oct 14): one row in the job-details style (a white
 * card row with its value and a chevron), "Classes 3 ›", that opens the classes panel.
 */
export const ClassesRow = forwardRef<
  HTMLButtonElement,
  { count: number; word: GroupLabel; open: boolean; onOpen: () => void }
>(function ClassesRow({ count, word, open, onOpen }, ref) {
  const t = useTranslations("app.people.classes");
  return (
    <div className="overflow-hidden rounded-list bg-surface shadow-card">
      <button
        ref={ref}
        type="button"
        aria-expanded={open}
        onClick={onOpen}
        className="group flex min-h-14 w-full items-center gap-3 px-6 text-left text-body-lg text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      >
        <span className="flex-1 font-semibold">{t("row", { group: word })}</span>
        <span className="text-muted">{t("count", { count })}</span>
        <ChevronRight aria-hidden="true" className="size-5 text-line-strong group-hover:text-ink" />
      </button>
    </div>
  );
});

/**
 * The job's classes in the floating panel (D140, D147): each with how many children it has and a Rename button that
 * opens the existing class form in rename mode. Roster editors only; the page decides.
 */
export function ClassesPanel({
  groups,
  word,
  focusKey,
  onClose,
  onRename,
}: {
  groups: readonly Group[];
  word: GroupLabel;
  focusKey: string | null;
  onClose: () => void;
  onRename: (group: Group) => void;
}) {
  const t = useTranslations("app.people");
  return (
    <FloatingPanel
      title={t("classes.title", { group: word })}
      meta={t("classes.meta")}
      focusKey={focusKey}
      onClose={onClose}
    >
      <ul className="m-0 flex list-none flex-col p-0">
        {groups.map((group) => (
          <li
            key={group.id}
            className="flex min-h-14 items-center gap-3 border-b border-line last:border-b-0"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-semibold break-words">{group.name}</span>
              <span className="block text-label text-muted">
                {t("classes.children", { count: group.childCount })}
              </span>
            </span>
            <Button
              id={renameButtonId(group.id)}
              variant="secondary"
              shape="pill"
              aria-label={t("renameLabel", { group: word, name: group.name })}
              onClick={() => onRename(group)}
            >
              <Pencil aria-hidden="true" />
              {t("rename")}
            </Button>
          </li>
        ))}
      </ul>
    </FloatingPanel>
  );
}
