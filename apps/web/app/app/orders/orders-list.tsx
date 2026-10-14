"use client";

import type {
  BulkOrderStatusResponse,
  JobsResponse,
  ListFilterChip,
  OrdersResponse,
  StudioOrder,
} from "@daybell/api";
import { canFulfil, formatOrderReference } from "@daybell/core";
import {
  Banner,
  Button,
  ClickableRow,
  ListCard,
  RowChevron,
  RowChevronHead,
  SearchToggle,
  Table,
  TableCell,
  TableHead,
  TableRow,
} from "@daybell/ui";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { LocalTime } from "@/app/_components/local-time";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { createLoadGuard } from "@/lib/load-guard";
import type { AddFilterChoice } from "../filter-chips/add-filter-menu";
import { type ChipItem, ChipRow } from "../filter-chips/chip-row";
import { useListFilters } from "../filter-chips/use-list-filters";
import { jobName, recordKey, useRecordNames } from "../filter-chips/use-record-names";
import { useStudio } from "../me-context";
import { orderHref } from "../notification-links";
import { OrderBadges, orderMoney } from "./order-badges";
import {
  ALL_ORDERS,
  BUILT_IN_ORDER_CHIPS,
  type OrderChip,
  orderChipFrom,
  orderChipFromSaved,
  orderChipHref,
  orderChipQuery,
  sameOrderChip,
} from "./order-view";

const LINK =
  "inline-flex min-h-11 items-center font-bold text-ink no-underline hover:underline group-hover:underline focus-visible:outline-2 focus-visible:outline-primary";
const CHECKBOX =
  "size-5 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * The studio's paid orders (ADR 0024; D25, D144; D147), shared by the Orders page and a job's Orders tab (which passes
 * `jobId`). One white list card: its toolbar has the chips (All, To print, To ship, To take to school, Done, then the
 * person's own: Delivery: Home, Delivery: School and, on the Orders page, a job), one at a time in the address (enum
 * words and ids only, D113; Home's Up next links open theirs), and the reference search (never a name, never in the
 * address). Then a table with a caption: reference, date, children (first name and last initial), items, total, the
 * status with its refund and dispute badges (words and icons, never colour alone: D91), delivery; a click on a row
 * opens the order, and its reference stays the link. Viewed as To print or Printed, fully refunded orders are left out,
 * so Home's links list what they count (code review N3). Show more by cursor. Owners, admins and staff select orders
 * with a checkbox each (and one for all shown) for Mark printed or Mark delivered to school, in a bar that stays in
 * view; each order's result is counted and announced.
 */
export function OrdersList({ jobId }: { jobId?: string }) {
  const t = useTranslations("app.orders");
  const tc = useTranslations("app.chips");
  const text = useApiText();
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams().toString();
  const withJob = !jobId;
  const { chip, clean } = useMemo(
    () => orderChipFrom(new URLSearchParams(params), { withJob }),
    [params, withJob],
  );
  const saved = useListFilters(jobId ? "job_orders" : "orders", jobId);
  const { me } = useStudio();
  const canMark = canFulfil(me.studio.role);
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  const [guard] = useState(createLoadGuard);
  const [orders, setOrders] = useState<StudioOrder[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const barTitle = useId();

  // An address with a combination no chip has goes back to All.
  useEffect(() => {
    if (clean) router.replace(orderChipHref(pathname, ALL_ORDERS), { scroll: false });
  }, [clean, router, pathname]);

  const query = useCallback(
    (after: string | null) => {
      const query = new URLSearchParams(orderChipQuery(chip));
      if (jobId) query.set("jobId", jobId);
      if (q) query.set("q", q);
      if (after) query.set("cursor", after);
      const s = query.toString();
      return `/orders${s ? `?${s}` : ""}`;
    },
    [jobId, chip, q],
  );
  const load = useCallback(
    async (after: string | null) => {
      // Answers that a newer chip or search overtook are dropped; Show more runs once at a time.
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

  // Jobs' names, by id (Orders page only); a saved job that is gone is dropped, and an address naming one goes to All.
  const refs = useMemo<ListFilterChip[]>(
    () => [
      ...(saved.chips ?? []),
      ...(chip.kind === "job" ? [{ key: "job", value: chip.id }] : []),
    ],
    [saved.chips, chip],
  );
  const names = useRecordNames(refs, withJob ? { job: jobName } : {});
  const { forget } = saved;
  useEffect(() => {
    const gone = (saved.chips ?? []).filter(
      (c) => c.value !== null && names.get(recordKey(c.key, c.value)) === null,
    );
    if (gone.length > 0) forget(gone);
    if (chip.kind === "job" && names.get(recordKey("job", chip.id)) === null)
      router.replace(orderChipHref(pathname, ALL_ORDERS), { scroll: false });
  }, [names, saved.chips, forget, chip, router, pathname]);

  const label = (c: OrderChip): string => {
    switch (c.kind) {
      case "all":
        return tc("all");
      case "job":
        return names.get(recordKey("job", c.id)) ?? tc("unnamed");
      default:
        return t(`chips.${c.kind}`);
    }
  };
  const item = (c: OrderChip, remove?: ListFilterChip): ChipItem => ({
    id: orderChipHref("", c),
    label: label(c),
    selected: sameOrderChip(c, chip),
    href: orderChipHref(pathname, c),
    ...(remove
      ? {
          onRemove: () => {
            void saved.remove(remove);
            if (sameOrderChip(c, chip))
              router.push(orderChipHref(pathname, ALL_ORDERS), { scroll: false });
          },
        }
      : {}),
  });
  const added = (saved.chips ?? []).flatMap((s) => {
    const c = orderChipFromSaved(s, withJob);
    return c ? [{ chip: c, saved: s }] : [];
  });
  const items: ChipItem[] = [
    ...BUILT_IN_ORDER_CHIPS.map((c) => item(c)),
    ...added.map((a) => item(a.chip, a.saved)),
  ];
  // A chip in the address that isn't saved (a shared link) still shows, selected, without a remove button.
  if (!items.some((i) => i.selected)) items.push(item(chip));

  const addChip = (saving: ListFilterChip, c: OrderChip) => {
    void saved.add(saving);
    router.push(orderChipHref(pathname, c), { scroll: false });
  };
  const choices: AddFilterChoice[] = saved.full
    ? []
    : [
        ...(["deliveryHome", "deliverySchool"] as const)
          .filter((key) => !added.some((a) => a.saved.key === key))
          .map(
            (key): AddFilterChoice => ({
              kind: "plain",
              id: key,
              label: t(`chips.${key}`),
              onPick: () => addChip({ key, value: null }, { kind: key }),
            }),
          ),
        // The job chip is the Orders page's only: a job's Orders tab is that job's already.
        ...(withJob
          ? [
              {
                kind: "search",
                id: "job",
                label: t("chips.jobMenu"),
                fieldLabel: t("chips.job"),
                placeholder: t("chips.jobPlaceholder"),
                listLabel: t("chips.jobList"),
                search: async (typed: string) => {
                  const res = await api<JobsResponse>(
                    `/jobs?limit=20${typed ? `&q=${encodeURIComponent(typed)}` : ""}`,
                  );
                  return res.ok
                    ? res.data.jobs
                        .filter((j) => !added.some((a) => a.saved.value === j.id))
                        .map((j) => ({ id: j.id, name: j.name, detail: j.internalNumber }))
                    : null;
                },
                onPick: (option: { id: string }) =>
                  addChip({ key: "job", value: option.id }, { kind: "job", id: option.id }),
              } satisfies AddFilterChoice,
            ]
          : []),
      ];

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

  const filtered = chip.kind !== "all" || q !== "";

  return (
    <div className="flex flex-col gap-4" aria-busy={working || undefined}>
      <p role="status" aria-live="polite" className="m-0 empty:sr-only">
        {message}
      </p>
      {saved.saveFailed ? <Banner tone="danger" title={tc("saveFailed")} /> : null}
      {problem ? <Banner tone="danger" title={problem} /> : null}

      <ListCard
        toolbar={<ChipRow label={t("chips.label")} items={items} choices={choices} />}
        toolbarEnd={
          <SearchToggle
            label={t("filters.searchLabel")}
            description={t("filters.referenceHelp")}
            maxLength={12}
            onCard
            value={typed}
            onChange={(v) => {
              setTyped(v);
              // An emptied box closes, so its search can't stay applied out of sight.
              if (v.trim() === "") setQ("");
            }}
            onSubmit={(v) => setQ(v.trim())}
          />
        }
        footer={
          orders && orders.length > 0 && cursor ? (
            <Button variant="quiet" shape="pill" onClick={() => void load(cursor)}>
              {t("loadMore")}
            </Button>
          ) : null
        }
      >
        {!orders ? (
          <p className="m-0 px-6 py-10 text-center text-muted">{t("loading")}</p>
        ) : orders.length === 0 ? (
          <p className="m-0 px-6 py-10 text-center text-muted">
            {filtered ? t("emptyFiltered") : t("empty")}
          </p>
        ) : (
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
        )}
      </ListCard>

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
