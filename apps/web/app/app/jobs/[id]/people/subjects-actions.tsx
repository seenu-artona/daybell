"use client";

import { Button, buttonVariants } from "@daybell/ui";
import { ChevronDown, Plus, QrCode, Upload } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MENU_ROW, Popover } from "../../../popover";
import { JobTabActions } from "../job-context";

/**
 * Subjects' actions at the right end of the job's tab row (D147, amends D145): a white Print QR cards once the roster
 * has children, then the green Add subjects menu (Add child, Import roster), for roster editors only.
 */
export function SubjectsActions({
  hasRows,
  canEdit,
  importHref,
  onPrint,
  onAdd,
}: {
  /** False while the roster loads or is empty: only Add subjects shows. */
  hasRows: boolean;
  canEdit: boolean;
  importHref: string;
  onPrint: () => void;
  onAdd: () => void;
}) {
  const t = useTranslations("app.people");
  const tr = useTranslations("app.roster");
  const tq = useTranslations("app.qrCards");
  if (!canEdit) return null;
  return (
    <JobTabActions>
      {hasRows ? (
        <Button variant="white" shape="pill" onClick={onPrint}>
          <QrCode aria-hidden="true" />
          {tq("button")}
        </Button>
      ) : null}
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
    </JobTabActions>
  );
}
