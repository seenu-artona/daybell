"use client";

import type { Child, Job } from "@daybell/api";
import type { GroupLabel } from "@daybell/core";
import { Badge, Button, IconChip, iconButtonVariants } from "@daybell/ui";
import { Ellipsis, Pencil, QrCode, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { MENU_ROW, Popover } from "../../../popover";
import { FloatingPanel } from "../floating-panel";
import { avatarTone, childInitials } from "./avatar";

/**
 * One child in People's floating panel (D140): their avatar and name, the access code large on a dark card, then
 * their details as hairline rows. Roster editors get Edit (the existing child form) and, while the job is a draft,
 * ⋯ › Remove child, and Print QR card (one card, the same on every print; ADR 0015). A child marked Do not photograph
 * gets no card, and the panel says so. Staff only read. The parent's email is not shown here (Seenu, answer 8); it is
 * in the form.
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
  onPrintCard,
}: {
  child: Child;
  job: Pick<Job, "status">;
  word: GroupLabel;
  canEdit: boolean;
  focusKey: string | null;
  onClose: () => void;
  onEdit: () => void;
  onRemove: () => void;
  /** Downloads this child's card; resolves when done. */
  onPrintCard: () => Promise<void>;
}) {
  const t = useTranslations("app.people.panel");
  const tr = useTranslations("app.roster");
  const name = `${child.firstName} ${child.lastName}`;
  const yesNo = (value: boolean) => (value ? t("yes") : t("no"));
  const fields = [
    { key: "group", label: tr("columns.group", { group: word }), value: child.group?.name ?? null },
    { key: "grade", label: tr("columns.grade"), value: child.grade },
    { key: "studentId", label: tr("columns.studentId"), value: child.studentId },
    {
      key: "doNotPhotograph",
      label: tr("badges.doNotPhotograph"),
      value: yesNo(child.doNotPhotograph),
    },
    { key: "doNotPublish", label: tr("badges.doNotPublish"), value: yesNo(child.doNotPublish) },
    { key: "duplicate", label: t("duplicate"), value: yesNo(child.duplicate) },
  ];
  const draft = job.status === "draft";
  const [printing, setPrinting] = useState(false);

  return (
    <FloatingPanel
      title={name}
      lead={
        <IconChip shape="round" tone={avatarTone(child.id)} className="size-13 text-label">
          {childInitials(child.firstName, child.lastName)}
        </IconChip>
      }
      focusKey={focusKey}
      onClose={onClose}
    >
      {child.doNotPhotograph ? (
        <Badge tone="danger" className="h-7 self-start rounded-sm px-2.5 text-label before:hidden">
          {tr("badges.doNotPhotograph")}
        </Badge>
      ) : null}

      <div className="flex flex-col gap-1 rounded-lg bg-ink px-4.5 py-4 text-on-primary">
        <p className="m-0 text-caption font-semibold text-on-primary/80">
          {tr("columns.accessCode")}
        </p>
        {child.accessCode ? (
          <p className="m-0 font-mono text-h2 font-extrabold tracking-wider">{child.accessCode}</p>
        ) : (
          <p className="m-0">{tr("codeUnavailable")}</p>
        )}
      </div>

      <dl className="m-0 flex flex-col border-t border-line">
        {fields.map((f) => (
          <div
            key={f.key}
            className="flex min-h-12 items-center justify-between gap-4 border-b border-line text-sm"
          >
            <dt className="text-muted">{f.label}</dt>
            <dd className="m-0 text-right font-semibold break-words">{f.value ?? t("none")}</dd>
          </div>
        ))}
      </dl>

      {canEdit ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button variant="secondary" shape="pill" onClick={onEdit}>
              <Pencil aria-hidden="true" />
              {t("edit")}
            </Button>
            {child.doNotPhotograph ? null : (
              <Button
                variant="secondary"
                shape="pill"
                disabled={printing}
                onClick={async () => {
                  setPrinting(true);
                  await onPrintCard();
                  setPrinting(false);
                }}
              >
                <QrCode aria-hidden="true" />
                {t("printCard")}
              </Button>
            )}
            {draft ? (
              <Popover
                label={t("moreActions", { name })}
                trigger={<Ellipsis aria-hidden="true" />}
                triggerClassName={iconButtonVariants({ tone: "canvas" })}
                // Opens upwards, inside the panel (which scrolls), since ⋯ sits at its bottom.
                placement="above-start"
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
          {child.doNotPhotograph ? (
            <p className="m-0 text-caption text-muted">{t("noCard")}</p>
          ) : null}
          {draft ? null : <p className="m-0 text-caption text-muted">{tr("lockedNote")}</p>}
        </div>
      ) : null}
    </FloatingPanel>
  );
}
