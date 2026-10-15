"use client";

import type { JobShop, JobShopRow } from "@daybell/api";
import { Switch, Table, TableCell, TableHead, TableRow } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { usePriceText } from "../../../products/price-text";
import { PriceCell } from "./price-cell";

/**
 * Job › Shop's one table (D157): Product, Price list, This job, Sold. Owners and admins of a job that isn't closed type
 * this job's price into the row (PriceCell) and switch it on or off (Switch, named "Sold: Package A"); a product only
 * this job sells shows — in the Price list column ("Not on the price list" for screen readers) and its name opens the
 * item dialog again. A row switched off is dimmed and its switch says Off, so the state never rests on colour alone
 * (D91). Everyone else reads the same table as text (ADR 0019 answer 8; N10).
 */
export function ShopTable({
  shop,
  editable,
  onPrice,
  onSold,
  onEdit,
}: {
  shop: JobShop;
  editable: boolean;
  onPrice: (row: JobShopRow, cents: number) => Promise<string | null>;
  onSold: (row: JobShopRow, sold: boolean) => void;
  onEdit: (row: JobShopRow) => void;
}) {
  const t = useTranslations("app.job.shop");
  const price = usePriceText();
  return (
    <Table variant="list">
      <caption className="sr-only">{t("tableLabel")}</caption>
      <thead>
        <TableRow>
          <TableHead>{t("columns.product")}</TableHead>
          <TableHead numeric>{t("columns.listPrice")}</TableHead>
          <TableHead>{t("columns.thisJob")}</TableHead>
          <TableHead>{t("columns.sold")}</TableHead>
        </TableRow>
      </thead>
      <tbody>
        {shop.rows.map((row) => {
          const dim = !row.sold;
          return (
            <TableRow key={row.itemId} data-sold={row.sold}>
              <TableCell>
                <span className="flex min-w-0 flex-col">
                  {editable && row.source === "job" ? (
                    <button
                      type="button"
                      aria-label={t("editProduct", { name: row.name })}
                      onClick={() => onEdit(row)}
                      className={`inline-flex min-h-11 items-center self-start text-left font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary ${dim ? "text-muted" : "text-ink"}`}
                    >
                      {row.name}
                    </button>
                  ) : (
                    <span className={`font-semibold ${dim ? "text-muted" : "text-ink"}`}>
                      {row.name}
                    </span>
                  )}
                  {row.kind === "package" && row.contents.length > 0 ? (
                    <span className="text-caption text-muted">{price.contents(row.contents)}</span>
                  ) : null}
                </span>
              </TableCell>
              <TableCell numeric className={dim ? "text-muted" : undefined}>
                {row.listPrice ? (
                  price.money(row.listPrice)
                ) : (
                  <>
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">{t("notOnList")}</span>
                  </>
                )}
              </TableCell>
              <TableCell className={dim ? "text-muted" : undefined}>
                {editable ? (
                  <PriceCell
                    name={row.name}
                    cents={row.price.cents}
                    currency={row.price.currency}
                    onSave={(cents) => onPrice(row, cents)}
                  />
                ) : (
                  <span className="tabular-nums">{price.money(row.price)}</span>
                )}
              </TableCell>
              <TableCell>
                {editable ? (
                  <Switch
                    checked={row.sold}
                    onCheckedChange={(sold) => onSold(row, sold)}
                    label={t("soldLabel", { name: row.name })}
                    onText={t("on")}
                    offText={t("off")}
                  />
                ) : (
                  <span className={dim ? "text-muted" : undefined}>
                    {row.sold ? t("on") : t("off")}
                  </span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </tbody>
    </Table>
  );
}
