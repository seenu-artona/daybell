"use client";

import type { PriceListItem, PriceListItemResponse } from "@daybell/api";
import {
  type Currency,
  MAX_PACKAGE_LINES,
  moneyInputText,
  PRINT_SIZES,
  type PriceItemKind,
  type PrintSize,
  parseMoneyInput,
} from "@daybell/core";
import { Banner, Button, Field } from "@daybell/ui";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { CheckboxField, SelectField, TextAreaField } from "../dialog";
import { MoneyField } from "./money-field";
import { usePriceText } from "./price-text";

interface Line {
  /** A stable key for React while lines are added and removed. */
  key: number;
  size: PrintSize;
  quantity: string;
}

let nextKey = 1;

function linesOf(item: PriceListItem | null): Line[] {
  if (!item) return [{ key: nextKey++, size: "8x10", quantity: "1" }];
  return item.contents
    .filter((l) => l.kind === "print" && l.printSize)
    .map((l) => ({ key: nextKey++, size: l.printSize as PrintSize, quantity: String(l.quantity) }));
}

/** Package contents compared line by line (a digital line's quantity is always 1). */
function contentsKey(
  lines: { kind: string; printSize?: string | null; quantity?: unknown }[],
): string {
  return lines
    .map((l) => (l.kind === "digital" ? "digital" : `${l.printSize}:${String(l.quantity)}`))
    .join("|");
}

/** A whole number 1–99 from what was typed, or the text itself so the server names the problem. */
function quantityValue(text: string): number | string {
  return /^\d{1,2}$/.test(text.trim()) ? Number(text.trim()) : text;
}

/**
 * Add or edit one price list item (ADR 0019): name, description, price, a print's size, and a package's contents
 * (prints by size and quantity, and whether it includes the digital download of the one pose the parent picks; answer
 * 3). Lines are added and removed with buttons. The price is read into whole cents here; the server checks everything
 * again.
 */
export function ItemForm({
  priceListId,
  kind,
  item,
  currency,
  onCancel,
  onSaved,
}: {
  priceListId: string;
  kind: PriceItemKind;
  /** The item to edit, or null to add one of `kind`. */
  item: PriceListItem | null;
  currency: Currency;
  onCancel: () => void;
  onSaved: (item: PriceListItem) => void;
}) {
  const t = useTranslations("app.products.item");
  const tp = useTranslations("app.products");
  const text = useApiText();
  const price = usePriceText();
  const contentsId = useId();
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [amount, setAmount] = useState(item ? moneyInputText(item.price.cents) : "");
  const [printSize, setPrintSize] = useState<PrintSize>(item?.printSize ?? "8x10");
  const [lines, setLines] = useState<Line[]>(() => linesOf(item));
  const [digital, setDigital] = useState(
    item ? item.contents.some((l) => l.kind === "digital") : true,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sizeOptions = PRINT_SIZES.map((s) => ({ value: s, label: price.size(s) }));
  const setLine = (key: number, change: Partial<Line>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...change } : l)));

  async function save(e: FormEvent) {
    e.preventDefault();
    const cents = parseMoneyInput(amount);
    if (cents === null) return setErrors({ priceCents: "validation.price" });
    setBusy(true);
    setErrors({});
    setProblem(null);
    const contents = [
      ...lines.map((l) => ({
        kind: "print",
        printSize: l.size,
        quantity: quantityValue(l.quantity),
      })),
      ...(digital ? [{ kind: "digital" }] : []),
    ];
    // An edit sends the contents only when they changed: replacing them is a change of its own (ADR 0019).
    const same =
      item !== null &&
      contentsKey(contents) ===
        contentsKey(
          item.contents.map((l) => ({
            kind: l.kind,
            printSize: l.printSize,
            quantity: l.quantity,
          })),
        );
    const body = {
      ...(item ? {} : { kind }),
      name,
      description: description.trim() ? description : null,
      priceCents: cents,
      ...(kind === "print" ? { printSize } : {}),
      ...(kind === "package" && !same ? { contents } : {}),
    };
    const res = await api<PriceListItemResponse>(
      item ? `/price-list-items/${item.id}` : `/price-lists/${priceListId}/items`,
      { method: item ? "PATCH" : "POST", body },
    );
    setBusy(false);
    if (res.ok) return onSaved(res.data.item);
    setErrors(res.fields);
    const known = ["name", "description", "priceCents", "printSize", "contents"];
    if (!Object.keys(res.fields).some((k) => known.some((f) => k.startsWith(f))))
      setProblem(price.conflict(res.fields.form) ?? text.error(res.code));
  }

  const lineError = (index: number, field: "printSize" | "quantity") =>
    text.field(errors[`contents.${index}.${field}`]);

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-5">
      {problem ? <Banner tone="danger" title={problem} /> : null}
      <p className="m-0 text-muted">{t(`about.${kind}`)}</p>
      <Field
        label={t("name")}
        name="name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={text.field(errors.name)}
      />
      <TextAreaField
        label={t("description")}
        help={t("descriptionHelp")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        error={text.field(errors.description)}
      />
      <MoneyField
        label={t("price")}
        name="price"
        value={amount}
        onChange={setAmount}
        currency={currency}
        help={tp("beforeTax")}
        error={text.field(errors.priceCents)}
      />
      {kind === "print" ? (
        <SelectField
          label={t("printSize")}
          value={printSize}
          onChange={(v) => setPrintSize(v as PrintSize)}
          options={sizeOptions}
          error={text.field(errors.printSize)}
        />
      ) : null}
      {kind === "package" ? (
        <fieldset
          className="m-0 flex flex-col gap-3 border-0 p-0"
          aria-describedby={`${contentsId}-help`}
        >
          <legend className="mb-1 p-0 text-title-sm">{t("contents")}</legend>
          <p id={`${contentsId}-help`} className="m-0 text-caption text-muted">
            {t("contentsHelp")}
          </p>
          {errors.contents ? (
            <p className="m-0 text-caption text-danger" role="alert">
              {text.field(errors.contents)}
            </p>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {lines.map((line, index) => (
              <li key={line.key} className="flex items-end gap-3">
                <div className="flex-1">
                  <SelectField
                    label={t("lineSize", { number: index + 1 })}
                    value={line.size}
                    onChange={(v) => setLine(line.key, { size: v as PrintSize })}
                    options={sizeOptions}
                    error={lineError(index, "printSize")}
                  />
                </div>
                <Field
                  className="w-28"
                  label={t("lineQuantity", { number: index + 1 })}
                  inputMode="numeric"
                  value={line.quantity}
                  onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                  error={lineError(index, "quantity")}
                />
                <Button
                  variant="ghost"
                  aria-label={t("removeLine", { number: index + 1 })}
                  onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          {lines.length < MAX_PACKAGE_LINES - 1 ? (
            <Button
              variant="secondary"
              className="self-start"
              onClick={() =>
                setLines((all) => [...all, { key: nextKey++, size: "5x7", quantity: "1" }])
              }
            >
              <Plus aria-hidden="true" />
              {t("addLine")}
            </Button>
          ) : null}
          <CheckboxField label={t("includesDigital")} checked={digital} onChange={setDigital} />
        </fieldset>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {item ? t("save") : t("add")}
        </Button>
      </div>
    </form>
  );
}
