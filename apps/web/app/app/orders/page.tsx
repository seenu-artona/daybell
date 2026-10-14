"use client";

import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { ListPage } from "../list-page";
import { OrdersList, useOrderView } from "./orders-list";

function OrdersPage() {
  const t = useTranslations("app.orders");
  const { status, delivery, viewHref } = useOrderView();
  return (
    <ListPage title={t("title")}>
      {/* A new delivery from the address (Home's To do links) starts the filters again; a new view keeps them. */}
      <OrdersList key={delivery} status={status} initialDelivery={delivery} viewHref={viewHref} />
    </ListPage>
  );
}

/**
 * Orders (ADR 0024; D25, D126, D144): every paid order of the studio, for owners, admins and staff (Q4). The API
 * refuses photographers; the menu still lists the section for everyone (D126), and the page says so in its banner.
 */
export default function Page() {
  return (
    <Suspense>
      <OrdersPage />
    </Suspense>
  );
}
