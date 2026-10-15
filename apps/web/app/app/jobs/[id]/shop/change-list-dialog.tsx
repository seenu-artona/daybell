"use client";

import type { Job, PriceListSummary, PriceListsResponse } from "@daybell/api";
import { Banner, Button } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog, SelectField } from "../../../dialog";
import { usePriceText } from "../../../products/price-text";

/**
 * Change: swap the job's price list (D157; B1, Seenu). The job's own prices and Sold switches on the old list are
 * removed, so when it has any the dialog says how many first ("2 changes for this job will be removed"); products only
 * this job sells stay. Saved through PATCH /jobs/{id} (ADR 0019), which the database follows by dropping the old
 * list's changes. Nothing is disabled while it saves; a second press is ignored.
 */
export function ChangeListDialog({
  open,
  onClose,
  job,
  dropped,
  ownProducts,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  job: Job;
  /** This job's changes on its current list, which a swap removes. */
  dropped: number;
  /** Whether the job sells products of its own (they stay). */
  ownProducts: boolean;
  onChanged: (job: Job, listName: string) => void;
}) {
  const t = useTranslations("app.job.shop");
  return (
    <Dialog open={open} onClose={onClose} title={t("changeDialog.title")}>
      <ChangeListForm
        job={job}
        dropped={dropped}
        ownProducts={ownProducts}
        onCancel={onClose}
        onChanged={onChanged}
      />
    </Dialog>
  );
}

export function ChangeListForm({
  job,
  dropped,
  ownProducts,
  onCancel,
  onChanged,
}: {
  job: Job;
  dropped: number;
  ownProducts: boolean;
  onCancel: () => void;
  onChanged: (job: Job, listName: string) => void;
}) {
  const t = useTranslations("app.job.shop");
  const text = useApiText();
  const price = usePriceText();
  const [lists, setLists] = useState<PriceListSummary[] | null>(null);
  const [chosen, setChosen] = useState(job.priceListId);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api<PriceListsResponse>("/price-lists").then((res) => {
      if (!live) return;
      if (res.ok) setLists(res.data.priceLists);
      else setProblem(text.error(res.code));
    });
    return () => {
      live = false;
    };
  }, [text]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (chosen === job.priceListId) return onCancel();
    setBusy(true);
    setProblem(null);
    const res = await api<{ job: Job }>(`/jobs/${job.id}`, {
      method: "PATCH",
      body: { priceListId: chosen },
    });
    setBusy(false);
    if (!res.ok)
      return setProblem(
        price.conflict(res.fields.form) ??
          text.field(Object.values(res.fields)[0]) ??
          text.error(res.code),
      );
    onChanged(res.data.job, lists?.find((l) => l.id === chosen)?.name ?? "");
  }

  const swapping = chosen !== job.priceListId;
  return (
    <form onSubmit={submit} className="flex flex-col gap-5" aria-busy={busy || undefined}>
      {problem ? <Banner tone="danger" title={problem} /> : null}
      {lists ? (
        <SelectField
          label={t("changeDialog.label")}
          value={chosen}
          onChange={setChosen}
          options={lists.map((l) => ({
            value: l.id,
            label: l.isDefault ? t("defaultOption", { name: l.name }) : l.name,
          }))}
        />
      ) : (
        <p className="m-0 text-muted">{t("loading")}</p>
      )}
      {/* Always rendered, so the warning is read out when another list is chosen (WCAG 4.1.3). */}
      <div role="status" aria-live="polite" className="empty:sr-only">
        {swapping && (dropped > 0 || ownProducts) ? (
          <Banner
            tone="warning"
            title={
              dropped > 0 ? t("changeDialog.warning", { count: dropped }) : t("changeDialog.keep")
            }
          >
            {dropped > 0 && ownProducts ? t("changeDialog.keep") : null}
          </Banner>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit">{t("changeDialog.submit")}</Button>
      </div>
    </form>
  );
}
