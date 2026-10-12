"use client";

import type { PriceList, PriceListItem, PriceListResponse } from "@daybell/api";
import {
  canEditPriceLists,
  moneyInputText,
  moveItem,
  orderedItems,
  PRICE_ITEM_GROUPS,
  type PriceItemGroup,
  type PriceItemKind,
  parseMoneyInput,
  priceItemGroup,
} from "@daybell/core";
import { Badge, Banner, Button, Card, Field } from "@daybell/ui";
import { ArrowDown, ArrowLeft, ArrowUp, Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog } from "../../../dialog";
import { useStudio } from "../../../me-context";
import { PageFrame } from "../../../page-frame";
import { ItemForm } from "../../item-form";
import { MoneyField } from "../../money-field";
import { usePriceText } from "../../price-text";

const BACK =
  "inline-flex min-h-11 items-center gap-2 self-start font-semibold text-primary no-underline hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/** What each group can add. The single digital and "all digitals" are one per list (answer 7). */
const ADDS: Record<PriceItemGroup, PriceItemKind[]> = {
  packages: ["package"],
  prints: ["print"],
  digitals: ["digital_single", "digital_all"],
};

/**
 * One price list (ADR 0019): its name and home shipping fee, then packages, prints and digital downloads with their
 * prices, before tax. Owners and admins add, edit, remove and reorder items (Move up / Move down buttons: no drag,
 * WCAG 2.5.7); photographers and staff see the same page read-only (answer 8). When selling jobs use the list, a note
 * says changes apply to new orders only (answer 5).
 */
export default function PriceListPage() {
  const t = useTranslations("app.products");
  const text = useApiText();
  const price = usePriceText();
  const { id } = useParams<{ id: string }>();
  const { me } = useStudio();
  const canManage = canEditPriceLists(me.studio.role);
  const [list, setList] = useState<PriceList | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<{
    kind: PriceItemKind;
    item: PriceListItem | null;
  } | null>(null);
  const [removing, setRemoving] = useState<PriceListItem | null>(null);
  const [focusAfterMove, setFocusAfterMove] = useState<{ id: string; by: -1 | 1 } | null>(null);

  const load = useCallback(async () => {
    const res = await api<PriceListResponse>(`/price-lists/${encodeURIComponent(id)}`);
    if (res.ok) setList(res.data.priceList);
    else setProblem(res.code === "not_found" ? t("editor.notFound") : text.error(res.code));
  }, [id, t, text]);

  useEffect(() => {
    void load();
  }, [load]);

  // After a move, keep focus on the moved item's button (or its other one, at the edge of its group).
  useEffect(() => {
    if (!focusAfterMove || !list) return;
    const { id: itemId, by } = focusAfterMove;
    const same = document.getElementById(`move-${by}-${itemId}`) as HTMLButtonElement | null;
    const other = document.getElementById(`move-${-by}-${itemId}`) as HTMLButtonElement | null;
    (same && !same.disabled ? same : other)?.focus();
    setFocusAfterMove(null);
  }, [focusAfterMove, list]);

  async function move(item: PriceListItem, by: -1 | 1) {
    if (!list) return;
    setProblem(null);
    const itemIds = moveItem(list.items, item.id, by);
    const res = await api(`/price-lists/${list.id}/items/order`, {
      method: "PUT",
      body: { itemIds },
    });
    if (!res.ok) return setProblem(text.field(res.fields.itemIds) ?? text.error(res.code));
    const position = new Map(itemIds.map((itemId, i) => [itemId, i + 1]));
    setList({
      ...list,
      items: list.items.map((i) => ({ ...i, position: position.get(i.id) ?? i.position })),
    });
    setStatus(t("editor.moved", { name: item.name }));
    setFocusAfterMove({ id: item.id, by });
  }

  if (!list)
    return (
      <PageFrame>
        <Link href="/app/products" className={BACK}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("editor.back")}
        </Link>
        {problem ? (
          <Banner tone="danger" title={problem} />
        ) : (
          <p className="m-0 text-muted">{t("loading")}</p>
        )}
      </PageFrame>
    );

  const items = orderedItems(list.items);
  const has = (kind: PriceItemKind) => list.items.some((i) => i.kind === kind);

  return (
    <PageFrame>
      <Link href="/app/products" className={BACK}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("editor.back")}
      </Link>
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 text-h1">{list.name}</h1>
          {list.isDefault ? <Badge tone="info">{t("default")}</Badge> : null}
        </div>
        <p className="m-0 text-muted">{t("beforeTax")}</p>
      </div>
      {list.sellingJobs > 0 ? (
        <Banner tone="info" title={t("editor.live", { count: list.sellingJobs })} />
      ) : null}
      {canManage ? null : <p className="m-0 text-muted">{t("editor.readOnly")}</p>}
      <p role="status" aria-live="polite" className="m-0 empty:sr-only">
        {status}
      </p>
      {problem ? <Banner tone="danger" title={problem} /> : null}

      <SettingsCard
        list={list}
        canManage={canManage}
        onSaved={(saved) => {
          setList(saved);
          setStatus(t("editor.saved"));
        }}
      />

      {PRICE_ITEM_GROUPS.map((group) => {
        const rows = items.filter((i) => priceItemGroup(i.kind) === group);
        return (
          <ItemGroup
            key={group}
            title={t(`editor.groups.${group}`)}
            empty={t(`editor.empty.${group}`)}
            actions={
              canManage
                ? ADDS[group]
                    .filter((kind) => kind === "package" || kind === "print" || !has(kind))
                    .map((kind) => (
                      <Button
                        key={kind}
                        variant="secondary"
                        onClick={() => setEditing({ kind, item: null })}
                      >
                        <Plus aria-hidden="true" />
                        {t(`editor.addKind.${kind}`)}
                      </Button>
                    ))
                : null
            }
          >
            {rows.map((item, index) => (
              <li
                key={item.id}
                className="flex min-h-14 items-center gap-3.5 border-b border-line py-2 last:border-b-0"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{item.name}</span>
                  {item.kind === "package" ? (
                    <span className="text-caption text-muted">{price.contents(item.contents)}</span>
                  ) : item.description ? (
                    <span className="text-caption text-muted">{item.description}</span>
                  ) : null}
                </div>
                <span className="font-semibold tabular-nums">{price.money(item.price)}</span>
                {canManage ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      id={`move--1-${item.id}`}
                      aria-label={t("editor.moveUpLabel", { name: item.name })}
                      disabled={index === 0}
                      onClick={() => void move(item, -1)}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      id={`move-1-${item.id}`}
                      aria-label={t("editor.moveDownLabel", { name: item.name })}
                      disabled={index === rows.length - 1}
                      onClick={() => void move(item, 1)}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={t("editor.editLabel", { name: item.name })}
                      onClick={() => setEditing({ kind: item.kind, item })}
                    >
                      {t("editor.edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={t("editor.removeLabel", { name: item.name })}
                      onClick={() => setRemoving(item)}
                    >
                      {t("editor.remove")}
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ItemGroup>
        );
      })}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing?.item
            ? t("item.editTitle", { name: editing.item.name })
            : editing
              ? t(`item.addTitle.${editing.kind}`)
              : ""
        }
      >
        {editing ? (
          <ItemForm
            priceListId={list.id}
            kind={editing.kind}
            item={editing.item}
            currency={list.currency}
            onCancel={() => setEditing(null)}
            onSaved={(saved) => {
              setEditing(null);
              setStatus(t("editor.itemSaved", { name: saved.name }));
              void load();
            }}
          />
        ) : null}
      </Dialog>
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("editor.removeDialog.title")}
      >
        {removing ? (
          <RemoveConfirm
            item={removing}
            onCancel={() => setRemoving(null)}
            onRemoved={() => {
              setStatus(t("editor.removed", { name: removing.name }));
              setRemoving(null);
              void load();
            }}
          />
        ) : null}
      </Dialog>
    </PageFrame>
  );
}

/** A white card with a heading, its add buttons and its rows. */
function ItemGroup({
  title,
  empty,
  actions,
  children,
}: {
  title: string;
  empty: string;
  actions: ReactNode;
  children: ReactNode[];
}) {
  const titleId = useId();
  return (
    <Card variant="sheet" asChild>
      <section aria-labelledby={titleId} className="flex flex-col gap-2 px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={titleId} className="m-0 flex-1 text-h3 font-bold">
            {title}
          </h2>
          {actions}
        </div>
        {children.length === 0 ? (
          <p className="m-0 text-muted">{empty}</p>
        ) : (
          <ul className="m-0 list-none p-0">{children}</ul>
        )}
      </section>
    </Card>
  );
}

/** The list's name and home shipping fee: a form for owners and admins, plain text for everyone else. */
function SettingsCard({
  list,
  canManage,
  onSaved,
}: {
  list: PriceList;
  canManage: boolean;
  onSaved: (list: PriceList) => void;
}) {
  const t = useTranslations("app.products.editor");
  const text = useApiText();
  const price = usePriceText();
  const titleId = useId();
  const [name, setName] = useState(list.name);
  const [shipping, setShipping] = useState(moneyInputText(list.homeShipping.cents));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const cents = parseMoneyInput(shipping);
    if (cents === null) return setErrors({ homeShippingCents: "validation.shipping" });
    setBusy(true);
    setErrors({});
    setProblem(null);
    const res = await api<PriceListResponse>(`/price-lists/${list.id}`, {
      method: "PATCH",
      body: { name, homeShippingCents: cents },
    });
    setBusy(false);
    if (res.ok) return onSaved(res.data.priceList);
    setErrors(res.fields);
    if (!res.fields.name && !res.fields.homeShippingCents) setProblem(text.error(res.code));
  }

  return (
    <Card variant="sheet" asChild>
      <section aria-labelledby={titleId} className="flex flex-col gap-4 px-6 pt-5 pb-5">
        <h2 id={titleId} className="m-0 text-h3 font-bold">
          {t("settings")}
        </h2>
        {canManage ? (
          <form onSubmit={save} noValidate className="flex flex-wrap items-start gap-5">
            {problem ? <Banner tone="danger" title={problem} className="w-full" /> : null}
            <Field
              className="w-72"
              label={t("name")}
              name="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={text.field(errors.name)}
            />
            <div className="max-w-sm">
              <MoneyField
                label={t("homeShipping")}
                name="homeShipping"
                value={shipping}
                onChange={setShipping}
                currency={list.currency}
                help={t("homeShippingHelp")}
                error={text.field(errors.homeShippingCents)}
              />
            </div>
            <Button type="submit" className="mt-7" disabled={busy}>
              {t("save")}
            </Button>
          </form>
        ) : (
          <p className="m-0">{t("homeShippingValue", { fee: price.money(list.homeShipping) })}</p>
        )}
      </section>
    </Card>
  );
}

function RemoveConfirm({
  item,
  onCancel,
  onRemoved,
}: {
  item: PriceListItem;
  onCancel: () => void;
  onRemoved: () => void;
}) {
  const t = useTranslations("app.products.editor.removeDialog");
  const text = useApiText();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const res = await api(`/price-list-items/${item.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) return onRemoved();
    setProblem(text.error(res.code));
  }

  return (
    <div className="flex flex-col gap-5">
      {problem ? <Banner tone="danger" title={problem} /> : null}
      <p className="m-0">{t("body", { name: item.name })}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => void remove()}>
          {t("confirm")}
        </Button>
      </div>
    </div>
  );
}
