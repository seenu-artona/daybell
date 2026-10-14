"use client";

import type { StudioOrderDetail } from "@daybell/api";
import { Table, TableCell, TableHead, TableRow } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { Fragment, useId } from "react";
import { LocalTime } from "@/app/_components/local-time";
import { orderMoney } from "../order-badges";

/**
 * An order's money in the ledger (ADR 0006, 0023, 0024; owners and admins only, Q4): each transaction (the sale, each
 * refund, a failed refund's mirror, an absorbed shortfall) with its entries, which add up to zero.
 */
export function LedgerSection({ order }: { order: StudioOrderDetail }) {
  const t = useTranslations("app.orders.detail.money");
  const titleId = useId();
  const ledger = order.ledger ?? [];
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className="m-0 text-h3">
        {t("title")}
      </h2>
      {ledger.length === 0 ? (
        <p className="m-0 text-muted">{t("none")}</p>
      ) : (
        <Table>
          <caption className="sr-only">{t("caption")}</caption>
          <thead>
            <TableRow>
              <TableHead>{t("columns.when")}</TableHead>
              <TableHead>{t("columns.what")}</TableHead>
              <TableHead>{t("columns.account")}</TableHead>
              <TableHead numeric>{t("columns.amount")}</TableHead>
            </TableRow>
          </thead>
          <tbody>
            {ledger.map((txn) => (
              <Fragment key={txn.id}>
                {txn.entries.map((entry, j) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">
                      {j === 0 ? (
                        <LocalTime
                          value={txn.createdAt}
                          options={{ dateStyle: "medium", timeStyle: "short" }}
                        />
                      ) : null}
                    </TableCell>
                    <TableCell>{j === 0 ? t(`kinds.${txn.kind}`) : null}</TableCell>
                    <TableCell>
                      {t(`accounts.${entry.account}` as Parameters<typeof t>[0])}
                    </TableCell>
                    <TableCell numeric>{orderMoney(entry.amount)}</TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}
      <p className="m-0 text-caption text-muted">{t("note")}</p>
    </section>
  );
}
