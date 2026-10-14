"use client";

import type { Refund, RefundResponse, StudioOrderDetail } from "@daybell/api";
import {
  formatOrderReference,
  parseMoneyInput,
  REFUND_REASONS,
  type RefundReason,
  RefundRefused,
  type RefundSplit,
  refundSplit,
} from "@daybell/core";
import { Banner, Button, Field, Table, TableCell, TableHead, TableRow } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useMemo, useRef, useState } from "react";
import { LocalTime } from "@/app/_components/local-time";
import { api } from "@/lib/client-api";
import { CheckboxField, Dialog, SelectField } from "../../dialog";
import { MoneyField } from "../../products/money-field";
import { orderMoney } from "../order-badges";
import { useOrderRefusal } from "../order-text";

/**
 * An order's refunds (ADR 0024; answer 3: owners and admins only, Q4: staff never see this section): the history, and
 * Refund, which opens the refund dialog. Refunds wait until Stripe has settled the payment (its fee must be known).
 */
export function RefundsSection({
  order,
  onRefunded,
}: {
  order: StudioOrderDetail;
  onRefunded: (refund: Refund) => void;
}) {
  const t = useTranslations("app.orders.detail.refunds");
  const td = useTranslations("app.orders.detail.refundDialog");
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const refunds = order.refunds ?? [];
  const left = order.refundable;
  const nothingLeft = left ? left.products.cents + left.shipping.cents === 0 : true;
  const owed = refunds.reduce((sum, r) => sum + r.unrecovered.cents, 0);

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="m-0 text-h3">
          {t("title")}
        </h2>
        {!nothingLeft && order.feesSettled && !order.refundInFlight ? (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            {t("refund")}
          </Button>
        ) : null}
      </div>
      {!order.feesSettled ? <p className="m-0 text-muted">{t("feesPending")}</p> : null}
      {order.refundInFlight ? <p className="m-0 text-muted">{t("inFlight")}</p> : null}
      {nothingLeft ? <p className="m-0 text-muted">{t("nothingLeft")}</p> : null}
      {owed > 0 ? (
        <p className="m-0 text-muted">
          {t("unrecovered", {
            amount: orderMoney({ cents: owed, currency: order.total.currency }),
          })}
        </p>
      ) : null}
      {refunds.length === 0 ? (
        <p className="m-0 text-muted">{t("none")}</p>
      ) : (
        <Table>
          <caption className="sr-only">{t("caption")}</caption>
          <thead>
            <TableRow>
              <TableHead>{t("columns.date")}</TableHead>
              <TableHead>{t("columns.what")}</TableHead>
              <TableHead>{t("columns.reason")}</TableHead>
              <TableHead numeric>{t("columns.amount")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
            </TableRow>
          </thead>
          <tbody>
            {refunds.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">
                  <LocalTime value={r.createdAt} />
                </TableCell>
                <TableCell>{t(`kinds.${r.kind}`)}</TableCell>
                <TableCell>{r.reason ? t(`reasons.${r.reason}`) : t("noReason")}</TableCell>
                <TableCell numeric>{orderMoney(r.amount)}</TableCell>
                <TableCell>{t(`statuses.${r.status}`)}</TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      )}
      <p className="m-0 text-caption text-muted">{t("cardFeeNote")}</p>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={td("title", { reference: formatOrderReference(order.reference) })}
      >
        <RefundForm
          order={order}
          onCancel={() => setOpen(false)}
          onDone={(refund) => {
            setOpen(false);
            onRefunded(refund);
          }}
        />
      </Dialog>
    </section>
  );
}

/**
 * The refund dialog (ADR 0024; Q3): items (a quantity for each line, up to what is left) and, if asked, the shipping
 * left; or a custom amount of products before tax. Then a reason from the list (or none; never free text). A live
 * summary computed with the same rule as the database (core refundSplit): products, shipping, tax pro rata, what the
 * parent gets back, Daybell's fee returned to the studio and that Stripe's card fee isn't. Review, then a confirm step
 * that says the amount; the request carries an id made when the dialog opened, so a double tap is one refund. After a
 * refusal (Stripe refused it, or the amounts were wrong) the next try gets a new id (code review N2). By item with no
 * items but the shipping is a shipping-only refund (code review S5).
 */
export function RefundForm({
  order,
  onCancel,
  onDone,
}: {
  order: StudioOrderDetail;
  onCancel: () => void;
  onDone: (refund: Refund) => void;
}) {
  const t = useTranslations("app.orders.detail.refundDialog");
  const tr = useTranslations("app.orders.detail.refunds");
  const refusal = useOrderRefusal();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [mode, setMode] = useState<"lines" | "custom">("lines");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [shipping, setShipping] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState<RefundReason | "">("");
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);
  const modeName = useId();
  const currency = order.total.currency;
  const money = (cents: number) => orderMoney({ cents, currency });
  const left = order.refundable;

  const lines = order.lines
    .map((l) => ({ line: l, left: l.quantity - l.refundedQuantity }))
    .filter((x) => x.left > 0);

  const asked = useMemo(() => {
    if (mode === "custom") {
      const cents = amountText.trim() === "" ? 0 : parseMoneyInput(amountText);
      return cents === null ? null : cents;
    }
    return lines.reduce((sum, x) => sum + x.line.unitPrice.cents * (quantities[x.line.id] ?? 0), 0);
  }, [mode, amountText, lines, quantities]);

  const split = useMemo((): { ok: RefundSplit } | { error: string } => {
    if (!left) return { error: t("chooseSomething") };
    if (asked === null) return { error: t("badAmount") };
    try {
      return {
        ok: refundSplit(
          {
            productsCents: order.products.cents,
            shippingCents: order.shipping.cents,
            taxCents: order.tax.cents,
            daybellFeeCents: order.daybellFee.amount.cents,
            daybellFeeBps: order.daybellFee.basisPoints,
          },
          {
            productsCents: order.products.cents - left.products.cents,
            shippingCents: order.shipping.cents - left.shipping.cents,
            taxCents: order.tax.cents - left.tax.cents,
            feeCents: order.daybellFee.amount.cents - left.daybellFee.cents,
          },
          { productsCents: asked, shippingCents: shipping ? left.shipping.cents : 0 },
        ),
      };
    } catch (err) {
      return {
        error:
          err instanceof RefundRefused && err.code === "over_refund"
            ? t("tooMuch")
            : t("chooseSomething"),
      };
    }
  }, [asked, shipping, left, order, t]);

  function review(event: FormEvent) {
    event.preventDefault();
    if ("ok" in split) setStep("confirm");
  }

  async function confirm() {
    if (busy.current || !("ok" in split)) return;
    busy.current = true;
    setProblem(null);
    const body =
      mode === "lines"
        ? {
            requestId,
            kind: "lines" as const,
            lines: lines
              .filter((x) => (quantities[x.line.id] ?? 0) > 0)
              .map((x) => ({ lineId: x.line.id, quantity: quantities[x.line.id] ?? 0 })),
            shipping,
            reason: reason || null,
          }
        : {
            requestId,
            kind: "custom" as const,
            amountCents: asked ?? 0,
            shipping,
            reason: reason || null,
          };
    const res = await api<RefundResponse>(`/orders/${order.id}/refunds`, { body });
    busy.current = false;
    if (res.ok) return onDone(res.data.refund);
    // A refusal is final for this id: the next try is a new refund. A lost connection keeps the id (same refund).
    if (res.status >= 400 && res.status < 500) setRequestId(crypto.randomUUID());
    setStep("edit");
    setProblem(refusal(res));
  }

  const summary =
    "ok" in split ? (
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        <dt>{t("summaryProducts")}</dt>
        <dd className="m-0 text-right tabular-nums">{money(split.ok.productsCents)}</dd>
        {split.ok.shippingCents > 0 ? (
          <>
            <dt>{t("summaryShipping")}</dt>
            <dd className="m-0 text-right tabular-nums">{money(split.ok.shippingCents)}</dd>
          </>
        ) : null}
        <dt>{t("summaryTax")}</dt>
        <dd className="m-0 text-right tabular-nums">{money(split.ok.taxCents)}</dd>
        <dt className="font-bold">{t("summaryTotal")}</dt>
        <dd className="m-0 text-right font-bold tabular-nums">{money(split.ok.amountCents)}</dd>
        <dt>{t("summaryFee")}</dt>
        <dd className="m-0 text-right tabular-nums">{money(split.ok.feeCents)}</dd>
        <dt>{t("summaryShare")}</dt>
        <dd className="m-0 text-right tabular-nums">{money(split.ok.studioCents)}</dd>
      </dl>
    ) : null;

  if (step === "confirm" && "ok" in split)
    return (
      <div className="flex flex-col gap-4">
        <p className="m-0">{t("confirmBody", { amount: money(split.ok.amountCents) })}</p>
        {summary}
        <p className="m-0 text-caption text-muted">{t("summaryCardFee")}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setStep("edit")}>
            {t("back")}
          </Button>
          <Button type="button" variant="danger" onClick={() => void confirm()}>
            {t("confirm", { amount: money(split.ok.amountCents) })}
          </Button>
        </div>
      </div>
    );

  return (
    <form onSubmit={review} className="flex flex-col gap-4" noValidate>
      {problem ? <Banner tone="danger" title={problem} /> : null}
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="mb-1 text-label">{t("mode")}</legend>
        {(["lines", "custom"] as const).map((m) => (
          <label
            key={m}
            className="flex min-h-11 cursor-pointer items-center gap-3 self-start text-sm"
          >
            <input
              type="radio"
              name={modeName}
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
              className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
            {m === "lines" ? t("byItem") : t("custom")}
          </label>
        ))}
      </fieldset>

      {mode === "lines" ? (
        <div className="flex flex-col gap-3">
          {lines.map(({ line, left: count }) => (
            <QuantityField
              key={line.id}
              label={t("quantity", { name: line.name })}
              help={t("quantityHelp", { count })}
              max={count}
              value={quantities[line.id] ?? 0}
              onChange={(n) => setQuantities((q) => ({ ...q, [line.id]: n }))}
            />
          ))}
        </div>
      ) : (
        <MoneyField
          label={t("amount")}
          help={t("amountHelp", { max: money(left?.products.cents ?? 0) })}
          value={amountText}
          onChange={setAmountText}
          currency={currency}
        />
      )}
      {left && left.shipping.cents > 0 ? (
        <CheckboxField
          label={t("shipping", { amount: money(left.shipping.cents) })}
          checked={shipping}
          onChange={setShipping}
        />
      ) : null}
      <SelectField
        label={t("reason")}
        value={reason}
        onChange={(v) => setReason(v as RefundReason | "")}
        options={[
          { value: "", label: t("noReason") },
          ...REFUND_REASONS.map((r) => ({ value: r, label: tr(`reasons.${r}`) })),
        ]}
      />
      <section aria-label={t("summary")} className="rounded-md bg-subtle p-4">
        <h3 className="m-0 mb-2 text-label">{t("summary")}</h3>
        {"ok" in split ? (
          summary
        ) : (
          <p role="status" className="m-0 text-sm text-muted">
            {split.error}
          </p>
        )}
        <p className="m-0 mt-2 text-caption text-muted">{t("summaryCardFee")}</p>
      </section>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={!("ok" in split)}>
          {t("review")}
        </Button>
      </div>
    </form>
  );
}

/** A whole number from 0 to `max` with its visible label, a 44px input and what is left as help (D91). */
function QuantityField({
  label,
  help,
  max,
  value,
  onChange,
}: {
  label: string;
  help: string;
  max: number;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <Field
      label={label}
      help={help}
      type="number"
      inputMode="numeric"
      min={0}
      max={max}
      step={1}
      value={String(value)}
      onChange={(e) => {
        const n = Number.parseInt(e.target.value, 10);
        onChange(Number.isNaN(n) ? 0 : Math.max(0, Math.min(max, n)));
      }}
      className="max-w-56"
    />
  );
}
