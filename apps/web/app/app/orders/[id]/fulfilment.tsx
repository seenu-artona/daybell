"use client";

import type { OrderResponse, StudioOrderDetail } from "@daybell/api";
import {
  CARRIERS,
  type Carrier,
  canFulfil,
  canUndoStatus,
  fulfilmentNext,
  fulfilmentPrevious,
  fulfilmentSteps,
  STATUS_UNDO_REASONS,
  type StatusUndoReason,
} from "@daybell/core";
import { Banner, Button, Field } from "@daybell/ui";
import { Check, Circle, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog, SelectField } from "../../dialog";
import { useStudio } from "../../me-context";
import { useOrderRefusal } from "../order-text";

const LINK =
  "inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";

type Saved = "printed" | "shipped" | "delivered" | "tracking" | "undo";

/**
 * An order's progress and its next step (ADR 0024; answer 4): a stepper (Paid → Printed → Shipped or Delivered to
 * school; Complete for downloads only), each step saying in words whether it is done, current or still to come (never
 * colour alone, D91); then the next step's button for owners, admins and staff: Mark printed, Mark shipped (a dialog:
 * carrier, tracking number, and a link for other carriers) or Mark delivered to school; Change tracking once shipped;
 * and for owners and admins, Undo last step with a reason. The tracking shows with a link to follow it.
 */
export function FulfilmentPanel({
  order,
  onChanged,
}: {
  order: StudioOrderDetail;
  onChanged: (order: StudioOrderDetail, saved: Saved) => void;
}) {
  const t = useTranslations("app.orders.detail");
  const ts = useTranslations("app.orders.statuses");
  const refusal = useOrderRefusal();
  const { me } = useStudio();
  const role = me.studio.role;
  const [problem, setProblem] = useState<string | null>(null);
  const [shipping, setShipping] = useState<"ship" | "tracking" | null>(null);
  const [undoing, setUndoing] = useState(false);
  const busy = useRef(false);
  const titleId = useId();

  const steps =
    order.fulfilment === "complete"
      ? (["complete"] as const)
      : fulfilmentSteps(order.shippingMethod);
  const at = steps.indexOf(order.fulfilment as (typeof steps)[number]);
  const next = fulfilmentNext(order.fulfilment, order.shippingMethod);
  const previous = fulfilmentPrevious(order.fulfilment);
  const blocked = order.refund === "refunded" || order.fulfilment === "canceled";

  async function mark(status: "printed" | "delivered") {
    if (busy.current) return;
    busy.current = true;
    setProblem(null);
    const res = await api<OrderResponse>(`/orders/${order.id}/status`, { body: { status } });
    busy.current = false;
    if (!res.ok) return setProblem(refusal(res));
    onChanged(res.data.order, status);
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className="m-0 text-h3">
        {t("progress")}
      </h2>
      {order.fulfilment === "canceled" ? null : (
        <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
          {steps.map((step, i) => {
            const state = i < at ? "done" : i === at ? "current" : "todo";
            return (
              <li
                key={step}
                aria-current={state === "current" ? "step" : undefined}
                className={`flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm ${
                  state === "todo"
                    ? "border-line text-muted"
                    : "border-primary bg-primary-soft font-semibold text-ink"
                }`}
              >
                {state === "todo" ? (
                  <Circle className="size-4" aria-hidden="true" />
                ) : (
                  <Check className="size-4" aria-hidden="true" />
                )}
                <span>{t(`steps.${step}`)}</span>
                <span className="sr-only">{t("stepState", { state })}</span>
              </li>
            );
          })}
        </ol>
      )}

      {order.tracking ? (
        <div className="flex flex-col">
          <span className="text-label">{t("tracking")}</span>
          <span>
            {t("trackingLine", {
              carrier: t(`ship.carriers.${order.tracking.carrier}`),
              number: order.tracking.number,
            })}
          </span>
          {order.tracking.link ? (
            <a
              href={order.tracking.link}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK}
            >
              {t("trackingOpen")}
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}

      {problem ? <Banner tone="danger" title={problem} /> : null}

      {canFulfil(role) && !blocked ? (
        <div className="flex flex-wrap gap-2">
          {next === "printed" ? (
            <Button onClick={() => void mark("printed")}>{t("markPrinted")}</Button>
          ) : null}
          {next === "shipped" ? (
            <Button onClick={() => setShipping("ship")}>{t("markShipped")}</Button>
          ) : null}
          {next === "delivered" ? (
            <Button onClick={() => void mark("delivered")}>{t("markDelivered")}</Button>
          ) : null}
          {order.fulfilment === "shipped" ? (
            <Button variant="secondary" onClick={() => setShipping("tracking")}>
              {t("editTracking")}
            </Button>
          ) : null}
          {canUndoStatus(role) && previous ? (
            <Button variant="ghost" onClick={() => setUndoing(true)}>
              {t("undo")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog
        open={shipping !== null}
        onClose={() => setShipping(null)}
        title={shipping === "tracking" ? t("ship.trackingTitle") : t("ship.title")}
      >
        <ShipForm
          order={order}
          mode={shipping ?? "ship"}
          onCancel={() => setShipping(null)}
          onSaved={(saved) => {
            setShipping(null);
            onChanged(saved, shipping === "tracking" ? "tracking" : "shipped");
          }}
        />
      </Dialog>
      <Dialog open={undoing} onClose={() => setUndoing(false)} title={t("undoDialog.title")}>
        {previous ? (
          <UndoForm
            order={order}
            from={ts(order.fulfilment)}
            to={ts(previous)}
            onCancel={() => setUndoing(false)}
            onSaved={(saved) => {
              setUndoing(false);
              onChanged(saved, "undo");
            }}
          />
        ) : null}
      </Dialog>
    </section>
  );
}

function ShipForm({
  order,
  mode,
  onCancel,
  onSaved,
}: {
  order: StudioOrderDetail;
  mode: "ship" | "tracking";
  onCancel: () => void;
  onSaved: (order: StudioOrderDetail) => void;
}) {
  const t = useTranslations("app.orders.detail.ship");
  const text = useApiText();
  const refusal = useOrderRefusal();
  const [carrier, setCarrier] = useState<Carrier>(order.tracking?.carrier ?? "canada_post");
  const [number, setNumber] = useState(order.tracking?.number ?? "");
  const [url, setUrl] = useState(order.tracking?.url ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setProblem(null);
    const tracking = {
      carrier,
      trackingNumber: number,
      trackingUrl: carrier === "other" && url.trim() ? url.trim() : null,
    };
    const res =
      mode === "tracking"
        ? await api<OrderResponse>(`/orders/${order.id}/tracking`, {
            method: "PATCH",
            body: tracking,
          })
        : await api<OrderResponse>(`/orders/${order.id}/status`, {
            body: { status: "shipped", ...tracking },
          });
    busy.current = false;
    if (res.ok) return onSaved(res.data.order);
    if (res.status === 400 && !res.fields.form) {
      setErrors(
        Object.fromEntries(
          Object.entries(res.fields).map(([k, v]) => [k, text.field(v) ?? text.error(res.code)]),
        ),
      );
      return;
    }
    setProblem(refusal(res));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {problem ? <Banner tone="danger" title={problem} /> : null}
      <SelectField
        label={t("carrier")}
        value={carrier}
        onChange={(v) => setCarrier(v as Carrier)}
        options={CARRIERS.map((c) => ({ value: c, label: t(`carriers.${c}`) }))}
        error={errors.carrier}
        required
      />
      <Field
        label={t("number")}
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        error={errors.trackingNumber}
        autoComplete="off"
        spellCheck={false}
        maxLength={60}
        required
      />
      {carrier === "other" ? (
        <Field
          label={t("url")}
          help={t("urlHelp")}
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={errors.trackingUrl}
          maxLength={500}
        />
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit">{mode === "tracking" ? t("saveTracking") : t("save")}</Button>
      </div>
    </form>
  );
}

function UndoForm({
  order,
  from,
  to,
  onCancel,
  onSaved,
}: {
  order: StudioOrderDetail;
  from: string;
  to: string;
  onCancel: () => void;
  onSaved: (order: StudioOrderDetail) => void;
}) {
  const t = useTranslations("app.orders.detail.undoDialog");
  const refusal = useOrderRefusal();
  const [reason, setReason] = useState<StatusUndoReason>("marked_by_mistake");
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const res = await api<OrderResponse>(`/orders/${order.id}/status/undo`, { body: { reason } });
    busy.current = false;
    if (res.ok) return onSaved(res.data.order);
    setProblem(refusal(res));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {problem ? <Banner tone="danger" title={problem} /> : null}
      <p className="m-0">{t("body", { from, to })}</p>
      <SelectField
        label={t("reason")}
        value={reason}
        onChange={(v) => setReason(v as StatusUndoReason)}
        options={STATUS_UNDO_REASONS.map((r) => ({ value: r, label: t(`reasons.${r}`) }))}
        required
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit">{t("confirm")}</Button>
      </div>
    </form>
  );
}
