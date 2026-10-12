"use client";

import type { PriceListResponse, PriceListSummary, PriceListsResponse } from "@daybell/api";
import { canEditPriceLists } from "@daybell/core";
import { Badge, Banner, Button, Field, Table, TableCell, TableHead, TableRow } from "@daybell/ui";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog, SelectField } from "../dialog";
import { useStudio } from "../me-context";
import { PageFrame } from "../page-frame";
import { priceListHref, usePriceText } from "./price-text";

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-ink no-underline hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/**
 * Products › Price lists (ADR 0019; the menu item stays "Products", Claude's call 5). Every member sees the studio's
 * lists, the default first, with what they hold and how many jobs use them; owners and admins add a list (blank or a
 * copy), make one the default, and delete one that isn't the default and that no job uses (Claude's call 2). Prices
 * are before tax.
 */
export default function PriceListsPage() {
  const t = useTranslations("app.products");
  const text = useApiText();
  const price = usePriceText();
  const { me } = useStudio();
  const canManage = canEditPriceLists(me.studio.role);
  const [lists, setLists] = useState<PriceListSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<PriceListSummary | null>(null);

  const load = useCallback(async () => {
    const res = await api<PriceListsResponse>("/price-lists");
    if (res.ok) setLists(res.data.priceLists);
    else setProblem(text.error(res.code));
  }, [text]);

  useEffect(() => {
    void load();
  }, [load]);

  async function makeDefault(list: PriceListSummary) {
    setProblem(null);
    const res = await api(`/price-lists/${list.id}/default`, { method: "POST" });
    if (!res.ok) return setProblem(price.conflict(res.fields.form) ?? text.error(res.code));
    setStatus(t("madeDefault", { name: list.name }));
    await load();
  }

  return (
    <PageFrame>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-h1">{t("title")}</h1>
          <p className="m-0 text-muted">{t("beforeTax")}</p>
        </div>
        {canManage ? (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            {t("add")}
          </Button>
        ) : null}
      </div>
      <p className="m-0 text-muted">{t("intro")}</p>
      <p role="status" aria-live="polite" className="m-0 empty:sr-only">
        {status}
      </p>
      {problem ? <Banner tone="danger" title={problem} /> : null}
      {!lists && !problem ? <p className="m-0 text-muted">{t("loading")}</p> : null}

      {lists ? (
        <Table>
          <thead>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.items")}</TableHead>
              <TableHead>{t("columns.usedBy")}</TableHead>
              {canManage ? (
                <TableHead>
                  <span className="sr-only">{t("columns.actions")}</span>
                </TableHead>
              ) : null}
            </TableRow>
          </thead>
          <tbody>
            {lists.map((list) => (
              <TableRow key={list.id}>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={priceListHref(list.id)} className={LINK}>
                      {list.name}
                    </Link>
                    {list.isDefault ? <Badge tone="selling">{t("default")}</Badge> : null}
                  </span>
                </TableCell>
                <TableCell>{t("itemCounts", list.counts)}</TableCell>
                <TableCell>{t("usedBy", { count: list.jobs })}</TableCell>
                {canManage ? (
                  <TableCell className="text-right">
                    {list.isDefault ? null : (
                      <span className="inline-flex gap-1">
                        <Button
                          variant="ghost"
                          aria-label={t("makeDefaultLabel", { name: list.name })}
                          onClick={() => void makeDefault(list)}
                        >
                          {t("makeDefault")}
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={t("deleteLabel", { name: list.name })}
                          onClick={() => setDeleting(list)}
                        >
                          {t("delete")}
                        </Button>
                      </span>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </tbody>
        </Table>
      ) : null}

      <Dialog open={adding} onClose={() => setAdding(false)} title={t("add")}>
        {adding && lists ? (
          <NewPriceListForm lists={lists} onCancel={() => setAdding(false)} />
        ) : null}
      </Dialog>
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t("deleteDialog.title")}
      >
        {deleting ? (
          <DeleteConfirm
            list={deleting}
            onCancel={() => setDeleting(null)}
            onDeleted={() => {
              setStatus(t("deleted", { name: deleting.name }));
              setDeleting(null);
              void load();
            }}
          />
        ) : null}
      </Dialog>
    </PageFrame>
  );
}

/** A new list: a name, and whether it starts empty or as a copy of one of the studio's lists. */
function NewPriceListForm({
  lists,
  onCancel,
}: {
  lists: PriceListSummary[];
  onCancel: () => void;
}) {
  const t = useTranslations("app.products");
  const text = useApiText();
  const price = usePriceText();
  const router = useRouter();
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setProblem(null);
    const res = await api<PriceListResponse>("/price-lists", {
      body: { name, ...(from ? { copyFromId: from } : {}) },
    });
    setBusy(false);
    if (res.ok) return router.push(priceListHref(res.data.priceList.id));
    setErrors(res.fields);
    if (!res.fields.name && !res.fields.copyFromId)
      setProblem(price.conflict(res.fields.form) ?? text.error(res.code));
  }

  return (
    <form onSubmit={create} noValidate className="flex flex-col gap-5">
      {problem ? <Banner tone="danger" title={problem} /> : null}
      <Field
        label={t("newForm.name")}
        name="name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={text.field(errors.name)}
      />
      <SelectField
        label={t("newForm.startFrom")}
        value={from}
        onChange={setFrom}
        error={text.field(errors.copyFromId)}
        options={[
          { value: "", label: t("newForm.blank") },
          ...lists.map((l) => ({ value: l.id, label: t("newForm.copyOf", { name: l.name }) })),
        ]}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("newForm.cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {t("newForm.create")}
        </Button>
      </div>
    </form>
  );
}

function DeleteConfirm({
  list,
  onCancel,
  onDeleted,
}: {
  list: PriceListSummary;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("app.products");
  const text = useApiText();
  const price = usePriceText();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    setProblem(null);
    const res = await api(`/price-lists/${list.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) return onDeleted();
    setProblem(price.conflict(res.fields.form) ?? text.error(res.code));
  }

  return (
    <div className="flex flex-col gap-5">
      {problem ? <Banner tone="danger" title={problem} /> : null}
      <p className="m-0">{t("deleteDialog.body", { name: list.name })}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("deleteDialog.cancel")}
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => void remove()}>
          {t("deleteDialog.confirm")}
        </Button>
      </div>
    </div>
  );
}
