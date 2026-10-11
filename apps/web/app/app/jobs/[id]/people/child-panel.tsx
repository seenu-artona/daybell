"use client";

import type { Child, Job } from "@daybell/api";
import type { GroupLabel } from "@daybell/core";
import { Button } from "@daybell/ui";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { MENU_ROW, Popover } from "../../../popover";
import { HIT_44 } from "../hit-area";
import { SidePanel } from "../side-panel";

/**
 * One child in People's side panel (D137, D138): the access code large, then their details. Roster editors get Edit
 * (the existing child form) and, while the job is a draft, ⋯ › Remove child. Staff only read.
 */
export function ChildPanel({
  child,
  job,
  word,
  canEdit,
  focusKey,
  onClose,
  onEdit,
  onRemove,
}: {
  child: Child;
  job: Pick<Job, "status">;
  word: GroupLabel;
  canEdit: boolean;
  focusKey: string | null;
  onClose: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("app.people.panel");
  const tr = useTranslations("app.roster");
  const name = `${child.firstName} ${child.lastName}`;
  const yesNo = (value: boolean) => (value ? t("yes") : t("no"));
  const fields = [
    { key: "group", label: tr("columns.group", { group: word }), value: child.group?.name ?? null },
    { key: "studentId", label: tr("columns.studentId"), value: child.studentId },
    { key: "grade", label: tr("columns.grade"), value: child.grade },
    { key: "parentEmail", label: tr("form.parentEmail"), value: child.parentEmail },
    {
      key: "doNotPhotograph",
      label: tr("badges.doNotPhotograph"),
      value: yesNo(child.doNotPhotograph),
    },
    { key: "doNotPublish", label: tr("badges.doNotPublish"), value: yesNo(child.doNotPublish) },
    { key: "duplicate", label: t("duplicate"), value: yesNo(child.duplicate) },
  ];
  const draft = job.status === "draft";

  return (
    <SidePanel title={name} focusKey={focusKey} onClose={onClose}>
      <div className="rounded-lg bg-canvas px-4 py-3">
        <p className="m-0 text-caption font-semibold text-muted">{tr("columns.accessCode")}</p>
        {child.accessCode ? (
          <p className="m-0 font-mono text-h2 tracking-wider">{child.accessCode}</p>
        ) : (
          <p className="m-0 text-muted">{tr("codeUnavailable")}</p>
        )}
      </div>

      <dl className="m-0 flex flex-col gap-3">
        {fields.map((f) => (
          <div key={f.key} className="flex flex-col">
            <dt className="text-caption font-semibold text-muted">{f.label}</dt>
            <dd className="m-0 text-sm break-words">{f.value ?? t("none")}</dd>
          </div>
        ))}
      </dl>

      {canEdit ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" className={HIT_44} onClick={onEdit}>
              <Pencil aria-hidden="true" />
              {t("edit")}
            </Button>
            {draft ? (
              <Popover
                label={t("moreActions", { name })}
                trigger={<Ellipsis aria-hidden="true" />}
                placement="below-start"
                panelClassName="w-56"
              >
                {(close) => (
                  <button
                    type="button"
                    className={`${MENU_ROW} text-danger [&_svg]:text-danger`}
                    onClick={() => {
                      close();
                      onRemove();
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                    {tr("form.remove")}
                  </button>
                )}
              </Popover>
            ) : null}
          </div>
          {draft ? null : <p className="m-0 text-caption text-muted">{tr("lockedNote")}</p>}
        </div>
      ) : null}
    </SidePanel>
  );
}
