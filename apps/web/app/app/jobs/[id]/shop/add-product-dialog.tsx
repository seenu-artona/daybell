"use client";

import type { JobShop, JobShopResponse, JobShopRow } from "@daybell/api";
import { type Currency, JOB_ITEM_KINDS, type JobItemKind } from "@daybell/core";
import { Banner, Button } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog } from "../../../dialog";
import { ItemForm } from "../../../products/item-form";
import { jobShopConflictKey } from "./shop-text";

export type ProductDialogState = { mode: "add" } | { mode: "edit"; row: JobShopRow } | null;

/**
 * Add a product that only this job sells, or edit one (D157; B2, Seenu: packages and prints, the price list editor's
 * own item dialog, plus Remove). Adding asks the kind first (Package or Print), then shows the item form. Each save
 * answers with the job's whole shop.
 */
export function ProductDialog({
  state,
  onClose,
  jobId,
  currency,
  onDone,
}: {
  state: ProductDialogState;
  onClose: () => void;
  jobId: string;
  currency: Currency;
  /** The job's shop after a save or a removal, and what to announce. */
  onDone: (shop: JobShop, message: (changes: string) => string) => void;
}) {
  const t = useTranslations("app.job.shop");
  const [kind, setKind] = useState<JobItemKind | null>(null);
  const [removing, setRemoving] = useState(false);
  const close = () => {
    setKind(null);
    setRemoving(false);
    onClose();
  };
  const conflict = (form: string | undefined) => {
    const key = jobShopConflictKey(form);
    return key ? t(`conflicts.${key}`) : null;
  };
  const row = state?.mode === "edit" ? state.row : null;
  const title = row
    ? removing
      ? t("removeTitle", { name: row.name })
      : t("editTitle", { name: row.name })
    : t("addTitle");

  return (
    <Dialog open={state !== null} onClose={close} title={title}>
      {state === null ? null : row && removing ? (
        <RemoveProduct
          jobId={jobId}
          row={row}
          conflict={conflict}
          onCancel={() => setRemoving(false)}
          onRemoved={(shop) => {
            close();
            onDone(shop, (changes) => t("removed", { name: row.name, changes }));
          }}
        />
      ) : row ? (
        <ItemForm<JobShopResponse>
          endpoint={{ url: `/jobs/${jobId}/shop/items/${row.itemId}`, method: "PATCH" }}
          kind={row.kind}
          item={{
            id: row.itemId,
            name: row.name,
            description: row.description,
            printSize: row.printSize,
            price: row.price,
            contents: row.contents,
          }}
          currency={currency}
          note={t("jobOnlyNote")}
          conflict={conflict}
          onCancel={close}
          onRemove={() => setRemoving(true)}
          onSaved={(data, name) => {
            close();
            onDone(data.shop, (changes) => t("productSaved", { name, changes }));
          }}
        />
      ) : kind ? (
        <ItemForm<JobShopResponse>
          endpoint={{ url: `/jobs/${jobId}/shop/items`, method: "POST" }}
          kind={kind}
          item={null}
          currency={currency}
          note={t("jobOnlyNote")}
          conflict={conflict}
          onCancel={close}
          onSaved={(data, name) => {
            close();
            onDone(data.shop, (changes) => t("added", { name, changes }));
          }}
        />
      ) : (
        <KindStep onCancel={close} onNext={setKind} />
      )}
    </Dialog>
  );
}

/** "What kind of product?": Package or Print (B2), as radios with a Next button. */
function KindStep({
  onCancel,
  onNext,
}: {
  onCancel: () => void;
  onNext: (kind: JobItemKind) => void;
}) {
  const t = useTranslations("app.job.shop");
  const name = useId();
  const [kind, setKind] = useState<JobItemKind>("package");
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onNext(kind);
      }}
      className="flex flex-col gap-5"
    >
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="mb-2 p-0 text-title-sm">{t("kindLegend")}</legend>
        {JOB_ITEM_KINDS.map((k) => (
          <label
            key={k}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-subtle"
          >
            <input
              type="radio"
              name={name}
              value={k}
              checked={kind === k}
              onChange={() => setKind(k)}
              className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
            <span>{t(`kinds.${k}`)}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit">{t("next")}</Button>
      </div>
    </form>
  );
}

/** Remove a job's own product, after saying that orders already placed keep it. */
function RemoveProduct({
  jobId,
  row,
  conflict,
  onCancel,
  onRemoved,
}: {
  jobId: string;
  row: JobShopRow;
  conflict: (form: string | undefined) => string | null;
  onCancel: () => void;
  onRemoved: (shop: JobShop) => void;
}) {
  const t = useTranslations("app.job.shop");
  const text = useApiText();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const res = await api<JobShopResponse>(`/jobs/${jobId}/shop/items/${row.itemId}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (res.ok) return onRemoved(res.data.shop);
    setProblem(conflict(res.fields.form) ?? text.error(res.code));
  }
  return (
    <div className="flex flex-col gap-5" aria-busy={busy || undefined}>
      {problem ? <Banner tone="danger" title={problem} /> : null}
      <p className="m-0">{t("removeBody")}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button variant="danger" onClick={() => void remove()}>
          {t("removeYes")}
        </Button>
      </div>
    </div>
  );
}
