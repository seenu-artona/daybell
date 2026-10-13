"use client";

import { ORDER_FULFILMENTS, type OrderFulfilment } from "@daybell/core";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { PageFrame } from "../page-frame";
import { OrdersList } from "./orders-list";

/** A status from the address (Home's To do links here with ?status=paid or printed); anything else is ignored. */
function statusFrom(value: string | null): OrderFulfilment | "" {
  return (ORDER_FULFILMENTS as readonly string[]).includes(value ?? "")
    ? (value as OrderFulfilment)
    : "";
}

function OrdersPage() {
  const t = useTranslations("app.orders");
  const status = statusFrom(useSearchParams().get("status"));
  return (
    <PageFrame>
      <div>
        <h1 className="m-0 text-h1">{t("title")}</h1>
        <p className="mt-1 mb-0 text-muted">{t("intro")}</p>
      </div>
      <OrdersList key={status} initialStatus={status} />
    </PageFrame>
  );
}

/**
 * Orders (ADR 0024; D25, D126): every paid order of the studio, for owners, admins and staff (Q4). The API refuses
 * photographers; the menu still lists the section for everyone (D126), and the page says so in its banner.
 */
export default function Page() {
  return (
    <Suspense>
      <OrdersPage />
    </Suspense>
  );
}
