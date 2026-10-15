"use client";

import type { Job, JobShop, JobShopResponse, JobShopRow } from "@daybell/api";
import { changesDroppedBySwap } from "@daybell/core";
import { Banner, Button, Card } from "@daybell/ui";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { useStudio } from "../../../me-context";
import { priceListHref } from "../../../products/price-text";
import { useJob } from "../job-context";
import { JobSection } from "../job-section";
import { LiveNote } from "../live-note";
import { ProductDialog, type ProductDialogState } from "./add-product-dialog";
import { ChangeListDialog } from "./change-list-dialog";
import { ShopAside } from "./shop-aside";
import { ShopTable } from "./shop-table";
import { jobShopConflictKey } from "./shop-text";

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/**
 * A job's Shop tab (D157; ADR 0033): the job's price list (Change swaps it), "Prices before tax", one line "N changes
 * for this job", and one table (Product, Price list, This job, Sold). For this job only, owners and admins change a
 * price, switch an item off, or add a product only it sells; the shared list never changes. The side holds Delivery
 * and "More for this job" (Soon). Dates, Close shop and numbers stay on Overview (D152). Photographers and staff, and
 * everyone on a closed job, read the same page as text (ADR 0019 answer 8; N10).
 *
 * Every save answers with the whole shop, which replaces the page's (the latest request wins) and is announced in a
 * polite status ("Saved. 2 changes for this job"). Nothing is disabled while a save runs (that would drop keyboard
 * focus, WCAG 2.4.3); the page is aria-busy meanwhile.
 */
export default function ShopPage() {
  const t = useTranslations("app.job.shop");
  const tt = useTranslations("app.job.tabs");
  const tp = useTranslations("app.products");
  const text = useApiText();
  const { changed } = useStudio();
  const { job, setJob, canManage } = useJob();
  const editable = canManage && job.status !== "closed";
  const [shop, setShop] = useState<JobShop | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(0);
  const [changing, setChanging] = useState(false);
  const [product, setProduct] = useState<ProductDialogState>(null);
  const titleId = useId();
  // Each write's answer is the whole shop; only the latest request's replaces the page.
  const sent = useRef(0);
  const applied = useRef(0);

  const load = useCallback(async () => {
    const mine = ++sent.current;
    const res = await api<JobShopResponse>(`/jobs/${job.id}/shop`);
    if (mine < applied.current) return;
    applied.current = mine;
    setFailed(!res.ok);
    if (res.ok) setShop(res.data.shop);
  }, [job.id]);

  // The job's list decides the rows: load again when it changes (Change, or another admin).
  // biome-ignore lint/correctness/useExhaustiveDependencies: priceListId is the reason to load again.
  useEffect(() => {
    void load();
  }, [load, job.priceListId]);

  const changesText = (count: number) => t("changes", { count });

  /** Sends one change; answers the words of a refusal (shown by the caller) or null once the shop is saved. */
  async function write(
    path: string,
    body: unknown,
    announce: (changes: string) => string,
  ): Promise<string | null> {
    const mine = ++sent.current;
    setBusy((n) => n + 1);
    setProblem(null);
    const res = await api<JobShopResponse>(path, { method: "PATCH", body });
    setBusy((n) => n - 1);
    if (res.ok) {
      if (mine >= applied.current) {
        applied.current = mine;
        setShop(res.data.shop);
      }
      setStatus(announce(changesText(res.data.shop.changes)));
      return null;
    }
    const key = jobShopConflictKey(res.fields.form);
    // The list was swapped meanwhile: show the job's current list.
    if (key === "notOnList") void load();
    return key
      ? t(`conflicts.${key}`)
      : (text.field(Object.values(res.fields)[0]) ?? text.error(res.code));
  }

  const rowPath = (row: JobShopRow) =>
    row.source === "list"
      ? `/jobs/${job.id}/shop/prices/${row.itemId}`
      : `/jobs/${job.id}/shop/items/${row.itemId}`;

  // A price's refusal shows under its own field (PriceCell).
  const onPrice = (row: JobShopRow, cents: number) =>
    write(rowPath(row), { priceCents: cents }, (changes) => t("savedChanges", { changes }));

  const onSold = (row: JobShopRow, sold: boolean) => {
    void write(rowPath(row), { sold }, (changes) => t("savedChanges", { changes })).then(
      (refused) => {
        if (refused) setProblem(refused);
      },
    );
  };

  async function onSchool(deliverToSchool: boolean) {
    setBusy((n) => n + 1);
    setProblem(null);
    const res = await api<{ job: Job }>(`/jobs/${job.id}`, {
      method: "PATCH",
      body: { deliverToSchool },
    });
    setBusy((n) => n - 1);
    if (!res.ok)
      return setProblem(
        res.fields.form === "priceLists.jobClosed" ? t("closed") : text.error(res.code),
      );
    setJob(res.data.job);
    changed();
    setStatus(res.data.job.deliverToSchool ? t("toSchoolOn") : t("toSchoolOff"));
  }

  const dropped = shop ? changesDroppedBySwap(shop.rows.map(factsOf)) : 0;
  const ownProducts = shop?.rows.some((r) => r.source === "job") ?? false;

  return (
    <JobSection title={tt("shop")}>
      <div
        className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start gap-x-14 gap-y-5"
        aria-busy={busy > 0 || undefined}
      >
        <div className="flex min-w-0 flex-col gap-4">
          {/* Always rendered so screen readers announce the words when they arrive (WCAG 4.1.3). */}
          <p role="status" aria-live="polite" className="m-0 text-sm text-muted empty:sr-only">
            {status}
          </p>
          <LiveNote />
          {job.status === "closed" ? <Banner tone="info" title={t("closed")} /> : null}
          {!canManage ? <p className="m-0 text-muted">{t("readOnly")}</p> : null}
          {problem ? <Banner tone="danger" title={problem} /> : null}
          {failed && !shop ? (
            <Banner
              tone="danger"
              title={
                <span className="flex flex-wrap items-center gap-3">
                  <span>{t("loadFailed")}</span>
                  <Button variant="secondary" onClick={() => void load()}>
                    {t("retry")}
                  </Button>
                </span>
              }
            />
          ) : null}
          <Card variant="sheet" asChild>
            <section aria-labelledby={titleId} className="flex flex-col gap-3 pt-5 pb-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-caption text-muted">{t("priceList")}</span>
                  <h3 id={titleId} className="m-0 text-h3 font-bold">
                    {shop?.priceList.name ?? t("loading")}
                  </h3>
                </div>
                {editable ? (
                  <Button
                    variant="secondary"
                    aria-label={t("changeLabel")}
                    onClick={() => setChanging(true)}
                  >
                    {t("change")}
                  </Button>
                ) : null}
                <Link href={priceListHref(job.priceListId)} className={LINK}>
                  {canManage ? t("edit") : t("view")}
                </Link>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6">
                <p className="m-0 flex-1 text-body text-muted">
                  {tp("beforeTax")}
                  {shop ? (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="text-ink">{changesText(shop.changes)}</span>
                    </>
                  ) : null}
                </p>
                {editable && shop ? (
                  <Button variant="secondary" onClick={() => setProduct({ mode: "add" })}>
                    <Plus aria-hidden="true" />
                    {t("add")}
                  </Button>
                ) : null}
              </div>
              {shop ? (
                <ShopTable
                  shop={shop}
                  editable={editable}
                  onPrice={onPrice}
                  onSold={onSold}
                  onEdit={(row) => setProduct({ mode: "edit", row })}
                />
              ) : failed ? null : (
                <p className="m-0 px-6 pb-3 text-muted">{t("loading")}</p>
              )}
            </section>
          </Card>
        </div>
        <ShopAside
          shop={shop}
          deliverToSchool={job.deliverToSchool}
          editable={editable}
          onSchool={(on) => void onSchool(on)}
        />
      </div>
      {editable ? (
        <ChangeListDialog
          open={changing}
          onClose={() => setChanging(false)}
          job={job}
          dropped={dropped}
          ownProducts={ownProducts}
          onChanged={(next, name) => {
            setChanging(false);
            setJob(next);
            changed();
            setStatus(t("listChanged", { name }));
          }}
        />
      ) : null}
      {editable && shop ? (
        <ProductDialog
          state={product}
          onClose={() => setProduct(null)}
          jobId={job.id}
          currency={shop.priceList.homeShipping.currency}
          onDone={(next, message) => {
            sent.current += 1;
            applied.current = sent.current;
            setShop(next);
            setStatus(message(changesText(next.changes)));
          }}
        />
      ) : null}
    </JobSection>
  );
}

/** A row's facts for core's change rules. */
function factsOf(row: JobShopRow) {
  return {
    source: row.source,
    listPriceCents: row.listPrice?.cents ?? null,
    priceCents: row.price.cents,
    sold: row.sold,
  };
}
