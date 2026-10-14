import type { ListFilterChip } from "@daybell/api";

/**
 * The Orders list's chips (D147, amends D144 and D145): All, To print, To ship, To take to school and Done built in;
 * Delivery: Home, Delivery: School and (on the Orders page) a job added by the person. One chip at a time, in the
 * address with enum words and ids only (D113): To print is ?status=paid, To ship ?status=printed&delivery=home, To take
 * to school ?status=printed&delivery=school (Home's Up next links), Done ?status=done, the deliveries ?delivery= and a
 * job ?job=<id>.
 */
export type OrderChip =
  | { kind: "all" }
  | { kind: "toPrint" }
  | { kind: "toShip" }
  | { kind: "toSchool" }
  | { kind: "done" }
  | { kind: "deliveryHome" }
  | { kind: "deliverySchool" }
  | { kind: "job"; id: string };

export const ALL_ORDERS: OrderChip = { kind: "all" };

/** The built-in chips, in order. */
export const BUILT_IN_ORDER_CHIPS: readonly OrderChip[] = [
  ALL_ORDERS,
  { kind: "toPrint" },
  { kind: "toShip" },
  { kind: "toSchool" },
  { kind: "done" },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The address parameters of each chip but the job's. */
const ADDRESS: Record<Exclude<OrderChip["kind"], "job">, Record<string, string>> = {
  all: {},
  toPrint: { status: "paid" },
  toShip: { status: "printed", delivery: "home" },
  toSchool: { status: "printed", delivery: "school" },
  done: { status: "done" },
  deliveryHome: { delivery: "home" },
  deliverySchool: { delivery: "school" },
};

function params(chip: OrderChip): Record<string, string> {
  return chip.kind === "job" ? { job: chip.id } : ADDRESS[chip.kind];
}

/**
 * The chip in the address. Any other combination is All, and `clean` says the page should replace the address with
 * All's. A job's Orders tab takes no job chip (`withJob` false).
 */
export function orderChipFrom(
  search: URLSearchParams,
  { withJob = true }: { withJob?: boolean } = {},
): { chip: OrderChip; clean: boolean } {
  const given = Object.fromEntries(
    ["status", "delivery", "job"].flatMap((k) => (search.has(k) ? [[k, search.get(k) ?? ""]] : [])),
  ) as Record<string, string>;
  const keys = Object.keys(given);
  if (keys.length === 0) return { chip: ALL_ORDERS, clean: false };
  if (withJob && keys.length === 1 && given.job && UUID.test(given.job))
    return { chip: { kind: "job", id: given.job.toLowerCase() }, clean: false };
  for (const [kind, wanted] of Object.entries(ADDRESS)) {
    const names = Object.keys(wanted);
    if (
      kind !== "all" &&
      names.length === keys.length &&
      names.every((name) => given[name] === wanted[name])
    )
      return { chip: { kind } as OrderChip, clean: false };
  }
  return { chip: ALL_ORDERS, clean: true };
}

export function orderChipHref(pathname: string, chip: OrderChip): string {
  const query = new URLSearchParams(params(chip)).toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function sameOrderChip(a: OrderChip, b: OrderChip): boolean {
  return orderChipHref("", a) === orderChipHref("", b);
}

/** What the API is asked for a chip: a status (or the done stage), a delivery and a job. */
export function orderChipQuery(chip: OrderChip): Record<string, string> {
  switch (chip.kind) {
    case "done":
      return { stage: "done" };
    case "job":
      return { jobId: chip.id };
    default:
      return ADDRESS[chip.kind];
  }
}

/** A saved chip's filter, or null for a key this list doesn't take. */
export function orderChipFromSaved(saved: ListFilterChip, withJob = true): OrderChip | null {
  if (saved.key === "deliveryHome" && !saved.value) return { kind: "deliveryHome" };
  if (saved.key === "deliverySchool" && !saved.value) return { kind: "deliverySchool" };
  if (withJob && saved.key === "job" && saved.value) return { kind: "job", id: saved.value };
  return null;
}
