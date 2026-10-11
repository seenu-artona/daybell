"use client";

import type { Child } from "@daybell/api";
import { Banner, Button } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog } from "../../dialog";

/**
 * "Remove child?" and the delete itself (D23; ADR 0011): only while the job is a draft, and the child's access code
 * goes too. Opened from the child form and from the People panel's ⋯ menu.
 */
export function RemoveChildDialog({
  child,
  open,
  onClose,
  onRemoved,
}: {
  child: Pick<Child, "id" | "firstName" | "lastName">;
  open: boolean;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const t = useTranslations("app.roster.form");
  const tr = useTranslations("app.roster");
  const text = useApiText();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setProblem(null);
    const res = await api(`/children/${child.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) return onRemoved();
    setProblem(res.code === "conflict" ? tr("lockedNote") : text.error(res.code));
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        setProblem(null);
        onClose();
      }}
      title={t("removeTitle")}
    >
      <div className="flex flex-col gap-5">
        {problem ? <Banner tone="danger" title={problem} /> : null}
        <p className="m-0">{t("removeBody", { name: `${child.firstName} ${child.lastName}` })}</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="danger" onClick={remove} disabled={busy}>
            {busy ? t("removing") : t("removeConfirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
