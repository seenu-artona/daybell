"use client";

import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { ListPage } from "../list-page";
import { OrdersList } from "./orders-list";

function OrdersPage() {
  const t = useTranslations("app.orders");
  return (
    <ListPage title={t("title")}>
      {/* The chip lives in the address (Home's Up next links set it); the reference search stays in this browser. */}
      <OrdersList />
    </ListPage>
  );
}

/**
 * Orders (ADR 0024; D25, D126, D144, D147): every paid order of the studio, for owners, admins and staff (Q4). The API
 * refuses photographers; the menu still lists the section for everyone (D126), and the page says so in its banner.
 */
export default function Page() {
  return (
    <Suspense>
      <OrdersPage />
    </Suspense>
  );
}
