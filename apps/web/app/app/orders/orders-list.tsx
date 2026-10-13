"use client";

import type {
  BulkOrderStatusResponse,
  JobsResponse,
  OrdersResponse,
  StudioOrder,
} from "@daybell/api";
import {
  canFulfil,
  formatOrderReference,
  ORDER_FULFILMENTS,
  type OrderFulfilment,
} from "@daybell/core";
import { Banner, Button, Field, Table, TableCell, TableHead, TableRow } from "@daybell/ui";
import { Search } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { SelectField } from "../dialog";
import { useStudio } from "../me-context";
import { orderHref } from "../notification-links";
import { OrderBadges, orderMoney } from "./order-badges";

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";
const CHECKBOX =
  "size-5 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

interface Filters {
  status: OrderFulfilment | "";
  jobId: string;
  q: string;
}

/**
 * The studio's paid orders (ADR 0024; D25), shared by the Orders page and a job's Orders tab (which passes `jobId`):
 * a table with a caption; reference, date, children (first name and last initial), items, total, the status with its
 * refund and dispute badges (words and icons, never colour alone: D91), delivery. Filters: status, job (on the Orders
 * page) and a reference search (never a name, and nothing personal in the URL). Load more by cursor. Owners, admins
 * and staff select orders with a checkbox each (and one for all shown) for Mark printed or Mark delivered to school,
 * in a bar that stays in view; each order's result is counted and announced.
 */
export function OrdersList({
  jobId,
  initialStatus = "",
}: {
  jobId?: string;
  initialStatus?: OrderFulfilment | "";
}) {
  const t = useTranslations("app.orders");
  const text = useApiText();
  const format = useFormatter();
  const { me } = useStudio();
  const canMark = canFulfil(me.studio.role);
  const [filters, setFilters] = useState<Filters>({ status: initialStatus, jobId: "", q: "" });
  const [typed, setTyped] = useState("");
  const [orders, setOrders] = useState<StudioOrder[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [jobs, setJobs] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const filterTitle = useId();
  const barTitle = useId();

  const query = useCallback(
    (after: string | null) => {
      const q = new URLSearchParams();
      if (jobId) q.set("jobId", jobId);
      else if (filters.jobId) q.set("jobId", filters.jobId);
      if (filters.status) q.set("status", filters.status);
      if (filters.q) q.set("q", filters.q);
      if (after) q.set("cursor", after);
      const s = q.toString();
      return `/orders${s ? `?${s}` : ""}`;
    },
    [jobId, filters],
  );

  const load = useCallback(
    async (after: string | null) => {
      const res = await api<OrdersResponse>(query(after));
      if (!res.ok) {
        setProblem(text.field(res.fields.q) ?? text.error(res.code));
        if (!after) setOrders([]);
        return;
      }
      setProblem(null);
      setOrders((prev) => (after && prev ? [...prev, ...res.data.orders] : res.data.orders));
      setCursor(res.data.nextCursor);
    },
    [query, text],
  );

  useEffect(() => {
    setOrders(null);
    setSelected(new Set());
    void load(null);
  }, [load]);

  // The job filter (Orders page only): the studio's jobs, by name.
  useEffect(() => {
    if (jobId) return;
    void api<JobsResponse>("/jobs?limit=100").then((res) => {
      if (res.ok) setJobs(res.data.jobs.map((j) => ({ id: j.id, name: j.name })));
    });
  }, [jobId]);

  function search(event: FormEvent) {
    event.preventDefault();
    setFilters((f) => ({ ...f, q: typed.trim() }));
  }

  function toggle(id: string, on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function mark(target: "printed" | "delivered") {
    if (busy.current || selected.size === 0) return;
    busy.current = true;
    setWorking(true);
    const res = await api<BulkOrderStatusResponse>("/orders/status", {
      body: { orderIds: [...selected], status: target },
    });
    busy.current = false;
    setWorking(false);
    if (!res.ok) return setProblem(text.error(res.code));
    const ok = res.data.results.filter((r) => r.outcome === "ok").length;
    const refused = res.data.results.length - ok;
    setStatus(
      [t("bulk.done", { ok }), refused > 0 ? t("bulk.refused", { count: refused }) : ""]
        .filter(Boolean)
        .join(" "),
    );
    setSelected(new Set(res.data.results.filter((r) => r.outcome !== "ok").map((r) => r.orderId)));
    await load(null);
  }

  const shown = orders ?? [];
  const allSelected = shown.length > 0 && shown.every((o) => selected.has(o.id));
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });

  return (
    <div className="flex flex-col gap-4" aria-busy={working || undefined}>
      <section aria-labelledby={filterTitle} className="flex flex-wrap items-end gap-3">
        <h2 id={filterTitle} className="sr-only">
          {t("filters.label")}
        </h2>
        <div className="min-w-48">
          <SelectField
            label={t("filters.status")}
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v as Filters["status"] }))}
            options={[
              { value: "", label: t("filters.anyStatus") },
              ...ORDER_FULFILMENTS.map((s) => ({ value: s, label: t(`statuses.${s}`) })),
            ]}
          />
        </div>
        {jobId ? null : (
          <div className="min-w-56">
            <SelectField
              label={t("filters.job")}
              value={filters.jobId}
              onChange={(v) => setFilters((f) => ({ ...f, jobId: v }))}
              options={[
                { value: "", label: t("filters.anyJob") },
                ...jobs.map((j) => ({ value: j.id, label: j.name })),
              ]}
            />
          </div>
        )}
        <form onSubmit={search} role="search" className="flex items-end gap-2">
          <Field
            label={t("filters.reference")}
            help={t("filters.referenceHelp")}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            maxLength={12}
          />
          <Button type="submit" variant="secondary" className="mb-6">
            <Search aria-hidden="true" />
            {t("filters.search")}
          </Button>
        </form>
        {filters.status || filters.jobId || filters.q ? (
          <Button
            variant="ghost"
            className="mb-6"
            onClick={() => {
              setTyped("");
              setFilters({ status: "", jobId: "", q: "" });
            }}
          >
            {t("filters.clear")}
          </Button>
        ) : null}
      </section>

      <p role="status" aria-live="polite" className="m-0 empty:sr-only">
        {status}
      </p>
      {problem ? <Banner tone="danger" title={problem} /> : null}

      {!orders ? (
        <p className="m-0 text-muted">{t("loading")}</p>
      ) : orders.length === 0 ? (
        <p className="m-0 text-muted">
          {filters.status || filters.jobId || filters.q ? t("emptyFiltered") : t("empty")}
        </p>
      ) : (
        <Table>
          <caption className="sr-only">{jobId ? t("captionJob") : t("caption")}</caption>
          <thead>
            <TableRow>
              {canMark ? (
                <TableHead className="w-12">
                  <label className="grid size-11 cursor-pointer place-items-center">
                    <span className="sr-only">{t("selectAll")}</span>
                    <input
                      type="checkbox"
                      className={CHECKBOX}
                      checked={allSelected}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(shown.map((o) => o.id)) : new Set())
                      }
                    />
                  </label>
                </TableHead>
              ) : null}
              <TableHead>{t("columns.order")}</TableHead>
              <TableHead>{t("columns.date")}</TableHead>
              <TableHead>{t("columns.for")}</TableHead>
              <TableHead numeric>{t("columns.items")}</TableHead>
              <TableHead numeric>{t("columns.total")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead>{t("columns.delivery")}</TableHead>
            </TableRow>
          </thead>
          <tbody>
            {orders.map((o) => {
              const reference = formatOrderReference(o.reference);
              return (
                <TableRow key={o.id}>
                  {canMark ? (
                    <TableCell className="w-12 py-0">
                      <label className="grid size-11 cursor-pointer place-items-center">
                        <span className="sr-only">{t("selectOrder", { reference })}</span>
                        <input
                          type="checkbox"
                          className={CHECKBOX}
                          checked={selected.has(o.id)}
                          onChange={(e) => toggle(o.id, e.target.checked)}
                        />
                      </label>
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Link href={orderHref(o.id)} className={LINK}>
                      {reference}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{date(o.paidAt)}</TableCell>
                  <TableCell>
                    {o.children.length > 0
                      ? format.list(o.children.map((c) => c.displayName))
                      : t("noChildren")}
                  </TableCell>
                  <TableCell numeric>{o.items}</TableCell>
                  <TableCell numeric>{orderMoney(o.total)}</TableCell>
                  <TableCell>
                    <OrderBadges status={o.fulfilment} refund={o.refund} disputed={o.disputed} />
                  </TableCell>
                  <TableCell>{t(`deliveries.${o.shippingMethod ?? "none"}`)}</TableCell>
                </TableRow>
              );
            })}
          </tbody>
        </Table>
      )}
      {cursor ? (
        <Button variant="secondary" className="self-start" onClick={() => void load(cursor)}>
          {t("loadMore")}
        </Button>
      ) : null}

      {canMark && selected.size > 0 ? (
        <section
          aria-labelledby={barTitle}
          className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-lg"
        >
          <h2 id={barTitle} className="sr-only">
            {t("bulk.label")}
          </h2>
          <p className="m-0 flex-1 font-semibold">{t("bulk.selected", { count: selected.size })}</p>
          <Button onClick={() => void mark("printed")}>{t("bulk.markPrinted")}</Button>
          <Button variant="secondary" onClick={() => void mark("delivered")}>
            {t("bulk.markDelivered")}
          </Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            {t("bulk.clear")}
          </Button>
        </section>
      ) : null}
    </div>
  );
}
