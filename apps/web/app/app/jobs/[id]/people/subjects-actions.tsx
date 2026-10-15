"use client";

import { buttonVariants } from "@daybell/ui";
import { ChevronDown, Plus, QrCode, Upload } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MENU_ROW, Popover } from "../../../popover";
import { JobTabActions } from "../job-context";

const WHITE = `${buttonVariants({ variant: "white", shape: "pill" })} [&_svg]:size-4`;

/**
 * Subjects' actions at the right end of the job's tab row (D153, amending D147): a white "Print ▾" (QR cards, once the
 * roster has subjects) and a white "Add subjects ▾" (Upload a list, Add one by one), for roster editors only. The
 * job's one green action stays in its header (D151).
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
  if (!canEdit) return null;
  return (
    <JobTabActions>
      {hasRows ? (
        <Popover
          trigger={
            <>
              <span>{t("print")}</span>
              <ChevronDown aria-hidden="true" />
            </>
          }
          triggerClassName={WHITE}
          panelClassName="w-60"
        >
          {(close) => (
            <button
              type="button"
              className={MENU_ROW}
              onClick={() => {
                close();
                onPrint();
              }}
            >
              <QrCode aria-hidden="true" />
              {t("printQrCards")}
            </button>
          )}
        </Popover>
      ) : null}
      <Popover
        trigger={
          <>
            <span>{t("addSubjects")}</span>
            <ChevronDown aria-hidden="true" />
          </>
        }
        triggerClassName={WHITE}
        panelClassName="w-60"
      >
        {(close) => (
          <>
            <Link href={importHref} className={MENU_ROW} onClick={close}>
              <Upload aria-hidden="true" />
              {t("uploadList")}
            </Link>
            <button
              type="button"
              className={MENU_ROW}
              onClick={() => {
                close();
                onAdd();
              }}
            >
              <Plus aria-hidden="true" />
              {t("addOneByOne")}
            </button>
          </>
        )}
      </Popover>
    </JobTabActions>
  );
}
