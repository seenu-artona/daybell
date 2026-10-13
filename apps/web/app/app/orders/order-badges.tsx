"use client";

import type { MoneyAmount } from "@daybell/api";
import {
  formatMoney,
  localeForCurrency,
  type OrderFulfilment,
  type RefundBadge as RefundBadgeKind,
} from "@daybell/core";
import { Badge, type BadgeProps } from "@daybell/ui";
import {
  Ban,
  CircleAlert,
  CircleCheck,
  Clock,
  Printer,
  RotateCcw,
  School,
  Truck,
} from "lucide-react";
import { useTranslations } from "next-intl";

/** Money as its own customers read it ("$25.00" in both regions), in whole cents (D96). */
export const orderMoney = (m: MoneyAmount) => formatMoney(m, localeForCurrency(m.currency));

const STATUS: Record<OrderFulfilment, { tone: BadgeProps["tone"]; Icon: typeof Clock }> = {
  paid: { tone: "warning", Icon: Clock },
  printed: { tone: "info", Icon: Printer },
  shipped: { tone: "selling", Icon: Truck },
  delivered: { tone: "selling", Icon: School },
  complete: { tone: "selling", Icon: CircleCheck },
  canceled: { tone: "draft", Icon: Ban },
};

const ICON = "size-3.5 shrink-0";

/**
 * An order's status (ADR 0024): its word and an icon; the colour only supports them (D91: never colour alone). The
 * badge's dot is dropped for the icon.
 */
export function OrderStatusBadge({ status }: { status: OrderFulfilment }) {
  const t = useTranslations("app.orders.statuses");
  const { tone, Icon } = STATUS[status];
  return (
    <Badge tone={tone} className="before:hidden">
      <Icon className={ICON} aria-hidden="true" />
      {t(status)}
    </Badge>
  );
}

/** Refunded or Partly refunded: a badge apart from the status (Claude's call). */
export function RefundBadge({ refund }: { refund: RefundBadgeKind }) {
  const t = useTranslations("app.orders.refundBadges");
  return (
    <Badge tone="danger" className="before:hidden">
      <RotateCcw className={ICON} aria-hidden="true" />
      {t(refund)}
    </Badge>
  );
}

/** A dispute was opened on the payment (a flag only in Phase 1). */
export function DisputeBadge() {
  const t = useTranslations("app.orders");
  return (
    <Badge tone="danger" className="before:hidden">
      <CircleAlert className={ICON} aria-hidden="true" />
      {t("disputed")}
    </Badge>
  );
}

/** The status, the refund badge and the dispute flag together, wrapping on narrow cells. */
export function OrderBadges({
  status,
  refund,
  disputed,
}: {
  status: OrderFulfilment;
  refund: RefundBadgeKind | null;
  disputed: boolean;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <OrderStatusBadge status={status} />
      {refund ? <RefundBadge refund={refund} /> : null}
      {disputed ? <DisputeBadge /> : null}
    </span>
  );
}
