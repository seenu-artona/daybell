"use client";

import { type Currency, formatMoney, localeForCurrency } from "@daybell/core";
import { Button, Card, Field } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

type Summary = {
  status: "open" | "complete" | "expired";
  studioName: string;
  currency: string;
  lines: { name: string; quantity: number; amount: number }[];
  shipping: { name: string; amount: number } | null;
  collectsAddress: boolean;
  taxEnabled: boolean;
  subtotal: number;
  processedBy: string | null;
};

/**
 * The fake hosted checkout's form (ADR 0023): what Stripe's own page asks for (an email, a card, and for home delivery
 * the recipient's name and address), with Stripe's test card filled in. Pay tells Daybell through its real webhook;
 * both buttons go where Stripe would send the parent.
 */
export function FakeCheckout({ session, summary }: { session: string; summary: Summary }) {
  const t = useTranslations("shop.devCheckout");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currency = summary.currency.toUpperCase() as Currency;
  const money = (cents: number) => formatMoney({ cents, currency }, localeForCurrency(currency));

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/dev-stripe/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session, ...body }),
      credentials: "same-origin",
    });
    if (!res.ok) {
      setBusy(false);
      setError(t("failed"));
      return;
    }
    const { redirect } = (await res.json()) as { redirect: string };
    window.location.assign(redirect);
  }

  function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    void send({
      action: "pay",
      email: text("email"),
      shipping: summary.collectsAddress
        ? {
            name: text("name"),
            line1: text("line1"),
            line2: text("line2") || null,
            city: text("city"),
            state: text("state") || null,
            postalCode: text("postalCode"),
            country: "CA",
          }
        : null,
    });
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-12">
      <p className="m-0 text-caption text-muted">{t("banner")}</p>
      <h1 className="m-0 text-h1">{summary.studioName}</h1>
      <Card className="flex flex-col gap-2">
        <h2 className="m-0 text-title-sm">{t("summary")}</h2>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {summary.lines.map((line, i) => (
            // Lines are shown as sent; the same item can appear twice (two poses).
            // biome-ignore lint/suspicious/noArrayIndexKey: the list never changes on this page.
            <li key={i} className="flex justify-between gap-3 text-sm">
              <span>{t("line", { name: line.name, quantity: line.quantity })}</span>
              <span className="tabular-nums">{money(line.amount)}</span>
            </li>
          ))}
          {summary.shipping ? (
            <li className="flex justify-between gap-3 text-sm">
              <span>{summary.shipping.name}</span>
              <span className="tabular-nums">{money(summary.shipping.amount)}</span>
            </li>
          ) : null}
        </ul>
        <p className="m-0 text-caption text-muted">
          {summary.taxEnabled ? t("taxOn") : t("taxOff")}
        </p>
        {summary.processedBy ? (
          <p className="m-0 text-caption text-muted">{summary.processedBy}</p>
        ) : null}
      </Card>
      {summary.status !== "open" ? (
        <p role="alert" className="m-0 text-danger">
          {t("notOpen")}
        </p>
      ) : (
        <form onSubmit={pay} className="flex flex-col gap-3" aria-busy={busy}>
          <Field label={t("email")} name="email" type="email" autoComplete="email" required />
          <Field
            label={t("card")}
            name="card"
            inputMode="numeric"
            autoComplete="cc-number"
            defaultValue="4242 4242 4242 4242"
            required
          />
          {summary.collectsAddress ? (
            <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
              <legend className="mb-1 p-0 text-title-sm">{t("shipTo")}</legend>
              <Field
                label={t("name")}
                name="name"
                autoComplete="name"
                defaultValue="Test Parent"
                required
              />
              <Field
                label={t("line1")}
                name="line1"
                autoComplete="address-line1"
                defaultValue="1 Test Street"
                required
              />
              <Field label={t("line2")} name="line2" autoComplete="address-line2" />
              <Field
                label={t("city")}
                name="city"
                autoComplete="address-level2"
                defaultValue="Toronto"
                required
              />
              <Field
                label={t("province")}
                name="state"
                autoComplete="address-level1"
                defaultValue="ON"
              />
              <Field
                label={t("postalCode")}
                name="postalCode"
                autoComplete="postal-code"
                defaultValue="M5V 2T6"
                required
              />
            </fieldset>
          ) : null}
          <p role="alert" className="m-0 min-h-5 text-caption text-danger">
            {error}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy}>
              {t("pay")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void send({ action: "cancel" })}
            >
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
