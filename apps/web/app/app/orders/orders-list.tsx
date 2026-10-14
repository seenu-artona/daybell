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
  SHOP_SHIPPING_METHODS,
  type ShopShippingMethod,
} from "@daybell/core";
import {
  Banner,
  Button,
  ClickableRow,
  ListCard,
  MainTab,
  MainTabs,
  RowChevron,
  RowChevronHead,
  SearchToggle,
  Table,
  TableCell,
  TableHead,
  TableRow,
  ViewBar,
  ViewTab,
  ViewTabs,
} from "@daybell/ui";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LocalTime } from "@/app/_components/local-time";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { createLoadGuard } from "@/lib/load-guard";
import { FilterMenu } from "../filter-menu";
import { useStudio } from "../me-context";
import { orderHref } from "../notification-links";
import { OrderBadges, orderMoney } from "./order-badges";
import { deliveryFrom, orderViewHref, statusFrom } from "./order-view";

const LINK =
  "inline-flex min-h-11 items-center font-bold text-ink no-underline hover:underline group-hover:underline focus-visible:outline-2 focus-visible:outline-primary";
const CHECKBOX =
  "size-5 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const VIEWS = ["", ...ORDER_FULFILMENTS] as const;

/** The filters kept in this browser: the job and the reference search (never in the address, D113). */
interface Filters {
  jobId: string;
  q: string;
}

type ViewHref = (status: OrderFulfilment | "", delivery: ShopShippingMethod | "") => string;

/** The view (?status=) and delivery (?delivery=) in the address, and the address for a view and delivery (D144). */
export function useOrderView() {
  const params = useSearchParams();
  const pathname = usePathname();
  return {
    status: statusFrom(params.get("status")),
    delivery: deliveryFrom(params.get("delivery")),
    viewHref: ((status, delivery) => orderViewHref(pathname, status, delivery)) as ViewHref,
  };
}

/**
 * The studio's paid orders (ADR 0024; D25, D144), shared by the Orders page and a job's Orders tab (which passes
 * `jobId`). One view bar: the status views as links (?status=; pills on the Orders page, dashes under a job's tabs),
 * then the filter icon, whose panel holds Delivery (?delivery=; both stay in the address as enum words, and switching
 * one keeps the other), Job (on the Orders page) and Clear filters, and a reference search (never a name; never in the
 * address, D113). D144, amended Oct 14. Then a table with a caption in a white list card: reference, date, children (first name and last initial), items, total,
 * the status with its refund and dispute badges (words and icons, never colour alone: D91), delivery; a click on a row
 * opens the order, and its reference stays the link. Viewed as Paid or Printed, fully refunded orders are left out, so
 * Home's To do links list what they count (code review N3). Show more by cursor. Owners, admins and staff select orders
 * with a checkbox each (and one for all shown) for Mark printed or Mark delivered to school, in a bar that stays in
 * view; each order's result is counted and announced.
 */
export function OrdersList({
  jobId,
  level = "main",
  status = "",
  delivery = "",
  viewHref,
}: {
  jobId?: string;
  /**
   * "main" on the Orders page, where the views are the page's first row of tabs (pills, no line under them); "sub" on
   * a job's Orders tab, under the job's pill tabs (dashes on a hairline). D144, amended Oct 14.
   */
  level?: "main" | "sub";
  /** The current view, from the page's address. */
  status?: OrderFulfilment | "";
  /** The delivery filter, from the page's address. */
  delivery?: ShopShippingMethod | "";
  /** The address for a view and delivery; by default this page's path with ?status= and ?delivery=. */
  viewHref?: ViewHref;
}) {
  const t = useTranslations("app.orders");
  const text = useApiText();
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const hrefFor: ViewHref = viewHref ?? ((s, d) => orderViewHref(pathname, s, d));
  const { me } = useStudio();
  const canMark = canFulfil(me.studio.role);
  const [filters, setFilters] = useState<Filters>({ jobId: "", q: "" });
  const [typed, setTyped] = useState("");
  const [guard] = useState(createLoadGuard);
  const [orders, setOrders] = useState<StudioOrder[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [jobs, setJobs] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const barTitle = useId();

  const query = useCallback(
    (after: string | null) => {
      const q = new URLSearchParams();
      if (jobId) q.set("jobId", jobId);
      else if (filters.jobId) q.set("jobId", filters.jobId);
      if (status) q.set("status", status);
      if (delivery) q.set("delivery", delivery);
      if (filters.q) q.set("q", filters.q);
      if (after) q.set("cursor", after);
      const s = q.toString();
      return `/orders${s ? `?${s}` : ""}`;
    },
    [jobId, status, delivery, filters],
  );
  const load = useCallback(
    async (after: string | null) => {
      // Answers that a newer view, filter or search overtook are dropped; Show more runs once at a time.
      const ticket = after ? guard.more() : guard.first();
      if (!ticket) return;
      const res = await api<OrdersResponse>(query(after));
      if (!ticket.finish()) return;
      if (!res.ok) {
        setProblem(text.field(res.fields.q) ?? text.error(res.code));
        if (!after) setOrders([]);
        return;
      }
      setProblem(null);
      setOrders((prev) => (after && prev ? [...prev, ...res.data.orders] : res.data.orders));
      setCursor(res.data.nextCursor);
    },
    [query, text, guard],
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
    setMessage(
      [t("bulk.done", { ok }), refused > 0 ? t("bulk.refused", { count: refused }) : ""]
        .filter(Boolean)
        .join(" "),
    );
    setSelected(new Set(res.data.results.filter((r) => r.outcome !== "ok").map((r) => r.orderId)));
    await load(null);
  }

  const shown = orders ?? [];
  const allSelected = shown.length > 0 && shown.every((o) => selected.has(o.id));

  const filtered = Boolean(delivery || filters.jobId || filters.q);

  /** The filter panel's Clear filters: the delivery (in the address) and the job. The search keeps its own box. */
  function clearFilters() {
    setFilters((f) => ({ ...f, jobId: "" }));
    if (delivery) router.replace(hrefFor(status, ""), { scroll: false });
  }
  const [Tabs, Tab] = level === "main" ? [MainTabs, MainTab] : [ViewTabs, ViewTab];

  return (
    <div className="flex flex-col gap-4" aria-busy={working || undefined}>
      <ViewBar
        variant={level}
        tabs={
          <Tabs label={t("views.label")}>
            {VIEWS.map((view) => (
              <Tab key={view || "all"} asChild current={status === view}>
                <Link href={hrefFor(view, delivery)} scroll={false}>
                  {view ? t(`statuses.${view}`) : t("views.all")}
                </Link>
              </Tab>
            ))}
          </Tabs>
        }
        actions={
          <>
            <FilterMenu
              onClear={clearFilters}
              groups={[
                {
                  key: "delivery",
                  legend: t("filters.delivery"),
                  value: delivery,
                  onChange: (v) =>
                    router.replace(hrefFor(status, deliveryFrom(v)), { scroll: false }),
                  options: [
                    { value: "", label: t("filters.any") },
                    ...SHOP_SHIPPING_METHODS.map((m) => ({
                      value: m,
                      label: t(`filters.deliveryShort.${m}`),
                    })),
                  ],
                },
                // The job filter is the Orders page's only: a job's Orders tab is that job's already.
                ...(jobId
                  ? []
                  : [
                      {
                        key: "job",
                        legend: t("filters.job"),
                        value: filters.jobId,
                        onChange: (v: string) => setFilters((f) => ({ ...f, jobId: v })),
                        options: [
                          { value: "", label: t("filters.any") },
                          ...jobs.map((j) => ({ value: j.id, label: j.name })),
                        ],
                      },
                    ]),
              ]}
            />
            <SearchToggle
              label={t("filters.searchLabel")}
              description={t("filters.referenceHelp")}
              maxLength={12}
              value={typed}
              onChange={(v) => {
                setTyped(v);
                // An emptied box closes, so its search can't stay applied out of sight.
                if (v.trim() === "") setFilters((f) => (f.q ? { ...f, q: "" } : f));
              }}
              onSubmit={(v) => setFilters((f) => ({ ...f, q: v.trim() }))}
            />
          </>
        }
      />

      <p role="status" aria-live="polite" className="m-0 empty:sr-only">
        {message}
      </p>
      {problem ? <Banner tone="danger" title={problem} /> : null}

      {!orders ? (
        <p className="m-0 text-muted">{t("loading")}</p>
      ) : orders.length === 0 ? (
        <p className="m-0 rounded-list bg-surface px-6 py-10 text-center text-muted shadow-card">
          {status || filtered ? t("emptyFiltered") : t("empty")}
        </p>
      ) : (
        <ListCard
          footer={
            cursor ? (
              <Button variant="quiet" shape="pill" onClick={() => void load(cursor)}>
                {t("loadMore")}
              </Button>
            ) : null
          }
        >
          <Table variant="list">
            <caption className="sr-only">{jobId ? t("captionJob") : t("caption")}</caption>
            <thead>
              <TableRow>
                {canMark ? (
                  <TableHead className="w-12 py-0">
                    <label className="grid size-11 cursor-pointer place-items-center">
                      <span className="sr-only">{t("selectAll")}</span>
                      <input
                        type="checkbox"
                        className={CHECKBOX}
                        checked={allSelected}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked ? new Set(shown.map((o) => o.id)) : new Set(),
                          )
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
                <RowChevronHead />
              </TableRow>
            </thead>
            <tbody>
              {orders.map((o) => {
                const reference = formatOrderReference(o.reference);
                return (
                  <ClickableRow key={o.id} onActivate={() => router.push(orderHref(o.id))}>
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
                    <TableCell className="whitespace-nowrap">
                      <LocalTime value={o.paidAt} />
                    </TableCell>
                    <TableCell>
                      {o.children.length > 0
                        ? format.list(o.children.map((c) => c.displayName))
                        : t("noChildren")}
                    </TableCell>
                    <TableCell numeric>{o.items}</TableCell>
                    <TableCell numeric className="font-semibold">
                      {orderMoney(o.total)}
                    </TableCell>
                    <TableCell>
                      <OrderBadges status={o.fulfilment} refund={o.refund} disputed={o.disputed} />
                    </TableCell>
                    <TableCell>{t(`deliveries.${o.shippingMethod ?? "none"}`)}</TableCell>
                    <RowChevron />
                  </ClickableRow>
                );
              })}
            </tbody>
          </Table>
        </ListCard>
      )}

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
