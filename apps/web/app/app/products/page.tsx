"use client";

import type { PriceListResponse, PriceListSummary, PriceListsResponse } from "@daybell/api";
import { canEditPriceLists } from "@daybell/core";
import {
  Badge,
  Banner,
  Button,
  ClickableRow,
  Field,
  ListCard,
  RowChevron,
  RowChevronHead,
  Table,
  TableCell,
  TableHead,
  TableRow,
} from "@daybell/ui";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog, SelectField } from "../dialog";
import { ListPage } from "../list-page";
import { useStudio } from "../me-context";
import { priceListHref, usePriceText } from "./price-text";

const LINK =
  "inline-flex min-h-11 items-center font-bold text-ink no-underline hover:underline group-hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/**
 * Products › Price lists (ADR 0019, D144; the menu item stays "Products", Claude's call 5). Every member sees the
 * studio's lists, the default first, with what they hold and how many jobs use them, in a white list card; a click on a
 * row opens the list. Owners and admins add a list (blank or a copy) from the view bar's green button, and make one the
 * default or delete one that isn't the default and that no job uses (Claude's call 2) with quiet buttons on its row.
 * Prices are before tax (the card's footer).
 */
export default function PriceListsPage() {
  const t = useTranslations("app.products");
  const text = useApiText();
  const price = usePriceText();
  const router = useRouter();
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
    <ListPage
      title={t("title")}
      actions={
        canManage ? (
          <Button shape="pill" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            {t("add")}
          </Button>
        ) : null
      }
    >
      <p className="m-0 text-muted">{t("intro")}</p>
      <p role="status" aria-live="polite" className="m-0 empty:sr-only">
        {status}
      </p>
      {problem ? <Banner tone="danger" title={problem} /> : null}
      {!lists && !problem ? <p className="m-0 text-muted">{t("loading")}</p> : null}

      {lists ? (
        <ListCard footer={t("beforeTax")}>
          <Table variant="list">
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
                <RowChevronHead />
              </TableRow>
            </thead>
            <tbody>
              {lists.map((list) => (
                <ClickableRow key={list.id} onActivate={() => router.push(priceListHref(list.id))}>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={priceListHref(list.id)} className={LINK}>
                        {list.name}
                      </Link>
                      {list.isDefault ? <Badge tone="info">{t("default")}</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell>{t("itemCounts", list.counts)}</TableCell>
                  <TableCell>{t("usedBy", { count: list.jobs })}</TableCell>
                  {canManage ? (
                    <TableCell className="py-0 text-right">
                      {list.isDefault ? null : (
                        <span className="inline-flex items-center gap-1">
                          <Button
                            variant="quiet"
                            shape="pill"
                            aria-label={t("makeDefaultLabel", { name: list.name })}
                            onClick={() => void makeDefault(list)}
                          >
                            {t("makeDefault")}
                          </Button>
                          {/* A list jobs use can't be deleted (the API answers 409), so say why instead. */}
                          {list.jobs > 0 ? (
                            <span className="inline-flex min-h-11 items-center px-2 text-caption text-muted">
                              {t("inUseNoDelete")}
                            </span>
                          ) : (
                            <Button
                              variant="quiet"
                              shape="pill"
                              aria-label={t("deleteLabel", { name: list.name })}
                              onClick={() => setDeleting(list)}
                            >
                              {t("delete")}
                            </Button>
                          )}
                        </span>
                      )}
                    </TableCell>
                  ) : null}
                  <RowChevron />
                </ClickableRow>
              ))}
            </tbody>
          </Table>
        </ListCard>
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
    </ListPage>
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
