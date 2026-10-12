"use client";

import type {
  Job,
  PriceList,
  PriceListResponse,
  PriceListSummary,
  PriceListsResponse,
} from "@daybell/api";
import { orderedItems, PRICE_ITEM_GROUPS, priceItemGroup } from "@daybell/core";
import { Banner, Button, Card } from "@daybell/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { CheckboxField, SelectField } from "../../../dialog";
import { useStudio } from "../../../me-context";
import { priceListHref, usePriceText } from "../../../products/price-text";
import { useJob } from "../job-context";
import { JobSection } from "../job-section";

const LINK =
  "inline-flex min-h-11 items-center self-start font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/**
 * A job's Shop tab (ADR 0019): which price list the job sells from and what parents can buy from it, before tax; and
 * delivery: the list's flat home shipping fee, and free delivery to school, off unless turned on (Claude's call 6).
 * Owners and admins change both while the job is a draft or selling (new orders only; answer 5, call 4); a closed
 * job's don't change. Everyone else reads.
 *
 * Keyboard (D91, WCAG 2.4.3 and 3.2.2): the list is picked, then saved with its own button, so arrowing through the
 * select saves nothing on the way. Nothing is disabled while a save runs (that would drop focus to the page); input
 * that arrives meanwhile is ignored, and the tab is marked aria-busy.
 */
export default function ShopPage() {
  const t = useTranslations("app.job.shop");
  const tt = useTranslations("app.job.tabs");
  const tp = useTranslations("app.products");
  const text = useApiText();
  const price = usePriceText();
  const { changed } = useStudio();
  const { job, setJob, canManage } = useJob();
  const [lists, setLists] = useState<PriceListSummary[] | null>(null);
  const [list, setList] = useState<PriceList | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  // Read and set synchronously, so two quick toggles can't both start a save.
  const saving = useRef(false);
  const [chosen, setChosen] = useState(job.priceListId);
  const listTitle = useId();
  const deliveryTitle = useId();
  const closed = job.status === "closed";
  const canChange = canManage && !closed;

  useEffect(() => {
    if (!canChange) return;
    api<PriceListsResponse>("/price-lists").then((res) => {
      if (res.ok) setLists(res.data.priceLists);
    });
  }, [canChange]);

  // A new list: the picker follows it, and an earlier load error no longer applies.
  useEffect(() => {
    setChosen(job.priceListId);
    setProblem(null);
  }, [job.priceListId]);

  useEffect(() => {
    let live = true;
    setList(null);
    api<PriceListResponse>(`/price-lists/${job.priceListId}`).then((res) => {
      if (!live) return;
      if (res.ok) setList(res.data.priceList);
      else setProblem(text.error(res.code));
    });
    return () => {
      live = false;
    };
  }, [job.priceListId, text]);

  async function save(change: { priceListId: string } | { deliverToSchool: boolean }) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setProblem(null);
    const res = await api<{ job: Job }>(`/jobs/${job.id}`, { method: "PATCH", body: change });
    saving.current = false;
    setBusy(false);
    if (!res.ok)
      return setProblem(
        price.conflict(res.fields.form) ??
          text.field(Object.values(res.fields)[0]) ??
          text.error(res.code),
      );
    setJob(res.data.job);
    changed();
    setStatus(
      "priceListId" in change
        ? t("saved")
        : res.data.job.deliverToSchool
          ? t("toSchoolOn")
          : t("toSchoolOff"),
    );
  }

  function saveList(event: FormEvent) {
    event.preventDefault();
    if (chosen !== job.priceListId) void save({ priceListId: chosen });
  }

  const items = list ? orderedItems(list.items) : [];

  return (
    <JobSection title={tt("shop")} subline={tp("beforeTax")}>
      <div className="flex flex-col gap-4" aria-busy={busy || undefined}>
        {job.status === "selling" ? <Banner tone="info" title={t("live")} /> : null}
        {closed ? <Banner tone="info" title={t("closed")} /> : null}
        {!canManage ? <p className="m-0 text-muted">{t("readOnly")}</p> : null}
        <p role="status" aria-live="polite" className="m-0 empty:sr-only">
          {status}
        </p>
        {problem ? <Banner tone="danger" title={problem} /> : null}

        <Card variant="sheet" asChild>
          <section aria-labelledby={listTitle} className="flex flex-col gap-3 px-6 pt-5 pb-4">
            <h3 id={listTitle} className="m-0 text-h3 font-bold">
              {t("priceList")}
            </h3>
            {canChange && lists ? (
              <form onSubmit={saveList} className="flex max-w-xl flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1">
                  <SelectField
                    label={t("chooseLabel")}
                    value={chosen}
                    onChange={setChosen}
                    options={lists.map((l) => ({
                      value: l.id,
                      label: l.isDefault ? t("defaultOption", { name: l.name }) : l.name,
                    }))}
                  />
                </div>
                <Button type="submit" variant="secondary">
                  {t("saveList")}
                </Button>
              </form>
            ) : (
              <p className="m-0 font-semibold">{list?.name ?? t("loading")}</p>
            )}
            <Link href={priceListHref(job.priceListId)} className={LINK}>
              {canManage ? t("edit") : t("view")}
            </Link>
            <h4 className="m-0 mt-2 text-label text-muted">{t("items")}</h4>
            {list ? (
              <div className="flex flex-col gap-3">
                {PRICE_ITEM_GROUPS.map((group) => {
                  const rows = items.filter((i) => priceItemGroup(i.kind) === group);
                  if (rows.length === 0) return null;
                  return (
                    <div key={group} className="flex flex-col">
                      <h5 className="m-0 pb-1 text-micro tracking-wide text-muted uppercase">
                        {tp(`editor.groups.${group}`)}
                      </h5>
                      <ul className="m-0 list-none p-0">
                        {rows.map((item) => (
                          <li
                            key={item.id}
                            className="flex min-h-11 items-center gap-3 border-b border-line py-1.5 last:border-b-0"
                          >
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="font-semibold">{item.name}</span>
                              {item.kind === "package" ? (
                                <span className="text-caption text-muted">
                                  {price.contents(item.contents)}
                                </span>
                              ) : null}
                            </span>
                            <span className="font-semibold tabular-nums">
                              {price.money(item.price)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="m-0 text-muted">{t("loading")}</p>
            )}
          </section>
        </Card>

        <Card variant="sheet" asChild>
          <section aria-labelledby={deliveryTitle} className="flex flex-col gap-3 px-6 pt-5 pb-4">
            <h3 id={deliveryTitle} className="m-0 text-h3 font-bold">
              {t("delivery")}
            </h3>
            <div className="flex flex-col">
              <span className="text-label text-ink">{t("homeShipping")}</span>
              <span className="text-muted">
                {list
                  ? t("homeShippingNote", { fee: price.money(list.homeShipping) })
                  : t("loading")}
              </span>
            </div>
            <CheckboxField
              label={t("toSchool")}
              help={t("toSchoolHelp")}
              checked={job.deliverToSchool}
              disabled={!canChange}
              onChange={(deliverToSchool) => void save({ deliverToSchool })}
            />
          </section>
        </Card>
      </div>
    </JobSection>
  );
}
