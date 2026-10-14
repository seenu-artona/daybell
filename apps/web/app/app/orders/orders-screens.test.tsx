// @vitest-environment jsdom
import type { Refund, StudioOrder, StudioOrderDetail } from "@daybell/api";
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { StudioContext } from "../me-context";

// The studio's order screens (ADR 0024) with the API faked: the list links each order by its reference and shows its
// status in words; owners, admins and staff select orders and mark them, each result counted and announced, refused
// ones kept selected; photographers get no checkboxes. The refund dialog sums what was asked with the database's rule,
// refuses more than is left, confirms with the amount and sends one request with its id however often it is tapped.
// Home gives staff the orders waiting in Up next and never the money (Q4).
const { push, replace, address } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  address: { search: "", path: "/app/orders" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push, refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(address.search),
  usePathname: () => address.path,
}));
const { api, saved } = vi.hoisted(() => ({
  api: vi.fn(),
  saved: { chips: [] as { key: string; value: string | null }[], putOk: true, getOk: true },
}));
// The person's saved chips (D147) answer from `saved` whatever else a test fakes.
vi.mock("@/lib/client-api", async (original) => ({
  ...(await original<typeof import("@/lib/client-api")>()),
  api: async (path: string, init?: { method?: string; body?: unknown }) => {
    if (path.startsWith("/me/list-filters")) {
      api.mock.calls.push([path, init]);
      if (init?.method === "PUT")
        return saved.putOk
          ? { ok: true, status: 204, data: undefined }
          : { ok: false, status: 500, code: "internal", message: "", fields: {} };
      return saved.getOk
        ? { ok: true, status: 200, data: { chips: saved.chips } }
        : { ok: false, status: 500, code: "internal", message: "", fields: {} };
    }
    return api(path, init);
  },
}));
// Home's Selling now makes its own call; it is tested elsewhere.
vi.mock("../jobs-selling", () => ({ JobsSelling: () => null }));

const { OrdersList } = await import("./orders-list");
const { RefundForm, RefundsSection } = await import("./[id]/refunds");
const { FulfilmentPanel } = await import("./[id]/fulfilment");
const { LedgerSection } = await import("./[id]/ledger");
const { default: HomePage } = await import("../page");

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const O1 = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c01";
const O2 = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c02";
const L1 = "1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c01";
const L2 = "1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c02";
const money = (cents: number) => ({ cents, currency: "CAD" as const });
const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });

const me = (role: "owner" | "admin" | "staff" | "photographer") => ({
  email: "owner@example.test",
  studio: { id: STUDIO, name: "Maple Lane Photography", role, region: "ca" },
});

const listed = (id: string, reference: string, over: Partial<StudioOrder> = {}): StudioOrder => ({
  id,
  reference,
  paidAt: "2026-10-13T12:00:00.000Z",
  children: [{ id: L1, displayName: "Ava P." }],
  items: 2,
  total: money(4520),
  fulfilment: "paid",
  refund: null,
  disputed: false,
  shippingMethod: "school",
  ...over,
});

const line = (
  id: string,
  name: string,
  quantity: number,
  unit: number,
): StudioOrderDetail["lines"][number] => ({
  id,
  kind: "print",
  name,
  printSize: "5x7",
  quantity,
  refundedQuantity: 0,
  unitPrice: money(unit),
  lineTotal: money(unit * quantity),
  physical: true,
  child: { id: "c0000000-0000-4000-8000-000000000001", firstName: "Ava", lastName: "Patel" },
  photoId: null,
  contents: [],
});

/** 2 prints at $20 and one at $60, $10 shipping, 13% HST, Daybell's 3% on products. */
const detail = (over: Partial<StudioOrderDetail> = {}): StudioOrderDetail => ({
  id: O1,
  reference: "7KQ2M9XA",
  paidAt: "2026-10-13T12:00:00.000Z",
  products: money(10_000),
  shipping: money(1_000),
  tax: money(1_430),
  total: money(12_430),
  daybellFee: { basisPoints: 300, amount: money(300) },
  cardFee: money(390),
  paidToStudio: money(11_740),
  feesSettled: true,
  shippingMethod: "home",
  fulfilment: "paid",
  printedAt: null,
  shippedAt: null,
  deliveredAt: null,
  canceledAt: null,
  disputedAt: null,
  shipToPurgedAt: null,
  externalRefund: null,
  tracking: null,
  refund: null,
  refundInFlight: false,
  lines: [line(L1, "5×7 print", 2, 2_000), line(L2, "Package A", 1, 6_000)],
  shipTo: null,
  refunds: [],
  refundable: {
    products: money(10_000),
    shipping: money(1_000),
    tax: money(1_430),
    daybellFee: money(300),
    refunded: money(0),
  },
  ledger: [],
  ...over,
});

let root: Root;
let container: HTMLDivElement;
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
async function render(ui: ReactNode, role: Parameters<typeof me>[0] = "owner") {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages} timeZone="America/Toronto">
        <StudioContext.Provider value={{ me: me(role) as never, version: 0, changed: () => {} }}>
          {ui}
        </StudioContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  await wait(20);
}
const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
/** The control a visible label names (exactly). */
function field(name: string): HTMLInputElement | HTMLSelectElement {
  const label = [...container.querySelectorAll("label")].find(
    (l) => l.textContent?.trim() === name || l.querySelector("span")?.textContent?.trim() === name,
  );
  const control = label?.htmlFor
    ? container.ownerDocument.getElementById(label.htmlFor)
    : label?.querySelector("input, select");
  if (!control) throw new Error(`No field labelled ${name}`);
  return control as HTMLInputElement;
}
async function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}
const status = () => container.querySelector('[role="status"][aria-live="polite"]')?.textContent;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  address.search = "";
  address.path = "/app/orders";
  saved.chips = [];
  saved.putOk = true;
  saved.getOk = true;
});

describe("the orders list", () => {
  const answer = () =>
    api.mockImplementation(async (path: string) =>
      path.startsWith("/jobs")
        ? ok({ jobs: [] })
        : path === "/orders/status"
          ? ok({
              results: [
                { orderId: O1, outcome: "ok" },
                { orderId: O2, outcome: "refused" },
              ],
            })
          : ok({ orders: [listed(O1, "7KQ2M9XA"), listed(O2, "8ABC2DEF")], nextCursor: null }),
    );

  it("links each order by its reference and says its status in words", async () => {
    answer();
    await render(<OrdersList />);
    const table = container.querySelector("table");
    expect(table?.querySelector("caption")?.textContent).toBeTruthy();
    const link = table?.querySelector(`a[href="/app/orders/${O1}"]`);
    expect(link?.textContent).toBe("7KQ2-M9XA");
    expect(table?.textContent).toContain("Ava P.");
    expect(table?.textContent).toContain(messages.app.orders.statuses.paid);
  });

  it("marks the selected orders, announces each result and keeps refused ones selected", async () => {
    answer();
    await render(<OrdersList />, "staff");
    await act(async () => (field("Select order 7KQ2-M9XA") as HTMLInputElement).click());
    await act(async () => (field("Select order 8ABC-2DEF") as HTMLInputElement).click());
    expect(container.textContent).toContain("2 orders selected");
    await act(async () => button("Mark printed")?.click());
    await wait(20);
    expect(api).toHaveBeenCalledWith("/orders/status", {
      body: { orderIds: [O1, O2], status: "printed" },
    });
    expect(status()).toBe("1 order changed. 1 order couldn’t be changed: check its status.");
    expect(container.textContent).toContain("1 order selected");
    expect((field("Select order 8ABC-2DEF") as HTMLInputElement).checked).toBe(true);
  });

  it("selects every order shown with one checkbox", async () => {
    answer();
    await render(<OrdersList />);
    await act(async () => (field("Select every order shown") as HTMLInputElement).click());
    expect(container.textContent).toContain("2 orders selected");
    await act(async () => button("Mark delivered to school")?.click());
    await wait(20);
    expect(api.mock.calls.find((c) => c[0] === "/orders/status")?.[1]).toEqual({
      body: { orderIds: [O1, O2], status: "delivered" },
    });
  });

  it("shows a refund badge only for a refunded order (code review S4)", async () => {
    api.mockImplementation(async (path: string) =>
      path.startsWith("/jobs")
        ? ok({ jobs: [] })
        : ok({
            orders: [listed(O1, "7KQ2M9XA"), listed(O2, "8ABC2DEF", { refund: "partly_refunded" })],
            nextCursor: null,
          }),
    );
    await render(<OrdersList />);
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows[0]?.textContent).not.toMatch(/refunded/i);
    expect(rows[1]?.textContent).toContain(messages.app.orders.refundBadges.partly_refunded);
  });

  /** The API paths the list asked for, after the first call (path only, never the PUT body). */
  const asked = () => api.mock.calls.map((c) => c[0] as string);
  const chipNav = () => container.querySelector('nav[aria-label="Show orders"]');
  const chipLinks = () => [...(chipNav()?.querySelectorAll("a") ?? [])];

  it("shows the chips All, To print, To ship, To take to school and Done as links, one selected (D147)", async () => {
    answer();
    address.search = "status=paid";
    await render(<OrdersList />);
    expect(chipLinks().map((a) => a.textContent)).toEqual([
      "All",
      "To print",
      "To ship",
      "To take to school",
      "Done",
    ]);
    expect(chipLinks().map((a) => a.getAttribute("href"))).toEqual([
      "/app/orders",
      "/app/orders?status=paid",
      "/app/orders?status=printed&delivery=home",
      "/app/orders?status=printed&delivery=school",
      "/app/orders?status=done",
    ]);
    const selected = chipLinks().filter((a) => a.getAttribute("aria-current"));
    expect(selected.map((a) => a.textContent)).toEqual(["To print"]);
    expect(asked()).toContain("/orders?status=paid");
  });

  it("asks for what Home's order to-do links count, and Done as one stage (code review N3; D147)", async () => {
    api.mockImplementation(async () => ok({ orders: [], nextCursor: null }));
    address.search = "status=printed&delivery=home";
    await render(<OrdersList />);
    expect(asked()).toContain("/orders?status=printed&delivery=home");
    address.search = "status=done";
    await render(<OrdersList />);
    expect(asked()).toContain("/orders?stage=done");
    // Another combination is All: the address is cleaned.
    address.search = "status=shipped";
    await render(<OrdersList />);
    expect(replace).toHaveBeenCalledWith("/app/orders", { scroll: false });
  });

  it("keeps the reference search across chips (never in the address)", async () => {
    answer();
    address.search = "delivery=school";
    await render(<OrdersList />);
    const opener = container.querySelector('button[aria-label="Search orders"]') as HTMLElement;
    await act(async () => opener.click());
    const box = container.querySelector('input[type="search"]') as HTMLInputElement;
    await type(box, "7KQ2");
    await act(async () => box.form?.requestSubmit());
    await wait(20);
    address.search = "status=paid";
    await render(<OrdersList />);
    expect(asked()).toContain("/orders?status=paid&q=7KQ2");
    expect((container.querySelector('input[type="search"]') as HTMLInputElement).value).toBe(
      "7KQ2",
    );
    expect(push.mock.calls.flat().join(" ")).not.toContain("7KQ2");
  });

  it("drops an older chip's slow answer, and fetches Show more once however often it is tapped", async () => {
    const resolvers: ((v: unknown) => void)[] = [];
    api.mockImplementation((path: string) =>
      path.startsWith("/jobs")
        ? Promise.resolve(ok({ jobs: [] }))
        : new Promise((r) => resolvers.push(r)),
    );
    address.search = "status=paid";
    await render(<OrdersList />);
    address.search = "status=done";
    await render(<OrdersList />);
    const [slow, fresh] = resolvers;
    await act(async () => fresh?.(ok({ orders: [listed(O2, "8ABC2DEF")], nextCursor: "c2" })));
    await act(async () => slow?.(ok({ orders: [listed(O1, "7KQ2M9XA")], nextCursor: null })));
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(container.querySelector("tbody")?.textContent).toContain("8ABC-2DEF");
    const before = api.mock.calls.length;
    await act(async () => {
      button("Show more orders")?.click();
      button("Show more orders")?.click();
    });
    expect(asked().slice(before)).toEqual(["/orders?stage=done&cursor=c2"]);
  });

  it("adds a chip from + Add filter: saved for the person and opened at once", async () => {
    answer();
    await render(<OrdersList />);
    const add = button("Add filter");
    await act(async () => add?.click());
    expect(add?.getAttribute("aria-expanded")).toBe("true");
    expect([...container.querySelectorAll("[data-choice]")].map((b) => b.textContent)).toEqual([
      "Delivery: Home",
      "Delivery: School",
      "Job…",
    ]);
    await act(async () => button("Delivery: Home")?.click());
    await wait(10);
    expect(
      api.mock.calls.find((c) => (c[1] as { method?: string })?.method === "PUT")?.[1],
    ).toEqual({
      method: "PUT",
      body: { page: "orders", chips: [{ key: "deliveryHome" }] },
    });
    expect(push).toHaveBeenCalledWith("/app/orders?delivery=home", { scroll: false });
    expect(chipLinks().map((a) => a.textContent)).toContain("Delivery: Home");
    // The panel closed and focus went back to its pill.
    expect(document.activeElement).toBe(button("Add filter"));
  });

  it("removes a saved chip with its own button, back to All if it was selected; undone if saving fails", async () => {
    answer();
    saved.chips = [{ key: "deliverySchool", value: null }];
    address.search = "delivery=school";
    await render(<OrdersList />);
    const remove = container.querySelector(
      'button[aria-label="Remove filter: Delivery: School"]',
    ) as HTMLButtonElement;
    expect(remove).toBeTruthy();
    // Built-in chips have no remove button.
    expect(container.querySelectorAll('button[aria-label^="Remove filter"]')).toHaveLength(1);
    saved.putOk = false;
    await act(async () => remove.click());
    await wait(10);
    expect(push).toHaveBeenCalledWith("/app/orders", { scroll: false });
    expect(chipLinks().map((a) => a.textContent)).toContain("Delivery: School");
    expect(container.textContent).toContain(messages.app.chips.saveFailed);
  });

  it("offers nothing to add until the saved chips have loaded, and says so with Try again when they can't be", async () => {
    answer();
    saved.getOk = false;
    await render(<OrdersList />);
    // The built-in chips still work; there is no "+ Add filter" to build a list from a failed load.
    expect(chipLinks().map((a) => a.textContent)).toContain("To print");
    expect(button("Add filter")).toBeUndefined();
    expect(container.textContent).toContain(messages.app.chips.loadFailed);
    saved.getOk = true;
    await act(async () => button(messages.app.chips.retry)?.click());
    await wait(20);
    expect(button("Add filter")).toBeDefined();
    expect(container.textContent).not.toContain(messages.app.chips.loadFailed);
  });

  it("names a saved job chip by its kind while the job's name loads, never by the placeholder", async () => {
    api.mockImplementation((path: string) =>
      path.startsWith("/jobs/")
        ? new Promise(() => {})
        : Promise.resolve(ok({ orders: [listed(O1, "7KQ2M9XA")], nextCursor: null })),
    );
    saved.chips = [{ key: "job", value: O2 }];
    await render(<OrdersList />);
    const pending = chipLinks().find((a) => a.textContent === "…");
    expect(pending?.getAttribute("aria-label")).toBe("Job");
    expect(container.querySelector('button[aria-label="Remove filter: Job"]')).toBeTruthy();
  });

  it("a job's tab has its own chips, without Job…, saved for that job only", async () => {
    answer();
    address.path = `/app/jobs/${O1}/orders`;
    await render(<OrdersList jobId={O1} />);
    expect(asked()).toContain(`/me/list-filters?page=job_orders&jobId=${O1}`);
    expect(asked()).toContain(`/orders?jobId=${O1}`);
    await act(async () => button("Add filter")?.click());
    expect([...container.querySelectorAll("[data-choice]")].map((b) => b.textContent)).toEqual([
      "Delivery: Home",
      "Delivery: School",
    ]);
    expect(chipLinks()[1]?.getAttribute("href")).toBe(`/app/jobs/${O1}/orders?status=paid`);
  });

  it("opens an order from a click on its row, but not from its checkbox", async () => {
    answer();
    await render(<OrdersList />);
    const row = container.querySelector("tbody tr") as HTMLTableRowElement;
    await act(async () => (row.querySelectorAll("td")[2] as HTMLElement).click());
    expect(push).toHaveBeenCalledWith(`/app/orders/${O1}`);
    push.mockClear();
    await act(async () => (field("Select order 7KQ2-M9XA") as HTMLInputElement).click());
    expect(push).not.toHaveBeenCalled();
  });

  it("searches by reference only on Enter, from a search button that opens a box", async () => {
    answer();
    await render(<OrdersList />);
    const opener = container.querySelector('button[aria-label="Search orders"]') as HTMLElement;
    await act(async () => opener.click());
    const box = container.querySelector('input[type="search"]') as HTMLInputElement;
    expect(box.getAttribute("aria-label")).toBe("Search orders");
    expect(box.maxLength).toBe(12);
    await type(box, "7KQ2");
    expect(api.mock.calls.map((c) => c[0])).not.toContain("/orders?q=7KQ2");
    await act(async () => box.form?.requestSubmit());
    await wait(20);
    expect(api.mock.calls.map((c) => c[0])).toContain("/orders?q=7KQ2");
  });

  it("gives photographers no checkboxes", async () => {
    answer();
    await render(<OrdersList />, "photographer");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });
});

describe("the refund dialog (Q1, Q3)", () => {
  it("sums one print with tax in proportion, confirms the amount and sends one request with its id", async () => {
    const onDone = vi.fn();
    let resolve: (v: unknown) => void = () => {};
    api.mockImplementation(() => new Promise((r) => (resolve = r)));
    await render(<RefundForm order={detail()} onCancel={() => {}} onDone={onDone} />);
    await type(field("Refund how many of 5×7 print"), "1");
    // $20 + tax 1430 × 2000 / 11000 = 260; Daybell's 3% of $20 = 60 back to the studio; G − a = 2200 from its balance.
    const summary = container.querySelector('section[aria-label="Summary"]')?.textContent ?? "";
    expect(summary).toContain("$22.60");
    expect(summary).toContain("$2.60");
    expect(summary).toContain("$0.60");
    expect(summary).toContain("$22.00");
    await act(async () => button("Review refund")?.click());
    const confirm = button("Refund $22.60");
    expect(container.textContent).toContain("The parent gets $22.60 back on their card.");
    await act(async () => {
      confirm?.click();
      confirm?.click();
    });
    expect(api).toHaveBeenCalledTimes(1);
    const [path, { body }] = api.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(path).toBe(`/orders/${O1}/refunds`);
    expect(body).toEqual({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      kind: "lines",
      lines: [{ lineId: L1, quantity: 1 }],
      shipping: false,
      reason: null,
    });
    await act(async () =>
      resolve(ok({ refund: { id: "r", status: "succeeded", amount: money(2260) } })),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("refunds only the shipping by item, with tax in proportion (code review S5)", async () => {
    api.mockResolvedValue(ok({ refund: { id: "r", status: "succeeded", amount: money(1130) } }));
    await render(<RefundForm order={detail()} onCancel={() => {}} onDone={() => {}} />);
    await act(async () => (field("Also refund the shipping ($10.00)") as HTMLInputElement).click());
    // $10 + tax 1430 × 1000 / 11000 = 130.
    await act(async () => button("Review refund")?.click());
    await act(async () => button("Refund $11.30")?.click());
    expect(api.mock.calls[0]?.[1]).toEqual({
      body: {
        requestId: expect.any(String),
        kind: "lines",
        lines: [],
        shipping: true,
        reason: null,
      },
    });
  });

  it("makes a new request id after a refusal, and keeps it after a lost connection (code review N2)", async () => {
    api
      .mockResolvedValueOnce({
        ok: false,
        status: 0,
        code: "network",
        message: "",
        fields: {},
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        code: "conflict",
        message: "",
        fields: { form: "orders.refundRefused" },
      })
      .mockResolvedValue(ok({ refund: { id: "r", status: "succeeded", amount: money(2260) } }));
    await render(<RefundForm order={detail()} onCancel={() => {}} onDone={() => {}} />);
    await type(field("Refund how many of 5×7 print"), "1");
    for (let i = 0; i < 3; i++) {
      await act(async () => button("Review refund")?.click());
      await act(async () => button("Refund $22.60")?.click());
      if (i === 1)
        expect(container.textContent).toContain(messages.app.orders.conflicts.refundRefused);
    }
    const ids = api.mock.calls.map((c) => (c[1] as { body: { requestId: string } }).body.requestId);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[1]);
  });

  it("refuses more than is left and keeps Review off", async () => {
    await render(
      <RefundForm
        order={detail({
          refundable: {
            products: money(2_000),
            shipping: money(0),
            tax: money(260),
            daybellFee: money(60),
            refunded: money(9_870),
          },
        } as never)}
        onCancel={() => {}}
        onDone={() => {}}
      />,
    );
    await act(async () => (field("A custom amount") as HTMLInputElement).click());
    await type(field("Amount before tax"), "30.00");
    expect(container.textContent).toContain("That’s more than is left to refund.");
    expect(button("Review refund")?.disabled).toBe(true);
    expect(api).not.toHaveBeenCalled();
  });

  it("offers Refund only once Stripe has settled the payment and nothing is in flight", async () => {
    await render(<RefundsSection order={detail({ feesSettled: false })} onRefunded={() => {}} />);
    expect(button("Refund")).toBeUndefined();
    expect(container.textContent).toContain(messages.app.orders.detail.refunds.feesPending);
    await render(<RefundsSection order={detail({ refundInFlight: true })} onRefunded={() => {}} />);
    expect(button("Refund")).toBeUndefined();
    await render(<RefundsSection order={detail()} onRefunded={() => {}} />);
    expect(button("Refund")).toBeDefined();
  });
});

describe("a refund made outside Daybell (security review S5)", () => {
  it("stops fulfilment until it is checked", async () => {
    const flagged = detail({ externalRefund: { at: "2026-10-13T12:00:00.000Z", checkedAt: null } });
    await render(<FulfilmentPanel order={flagged} onChanged={() => {}} />, "staff");
    expect(button("Mark printed")).toBeUndefined();
    await render(
      <FulfilmentPanel
        order={detail({
          externalRefund: { at: "2026-10-13T12:00:00.000Z", checkedAt: "2026-10-13T13:00:00.000Z" },
        })}
        onChanged={() => {}}
      />,
      "staff",
    );
    expect(button("Mark printed")).toBeDefined();
  });
});

describe("dates in the viewer's time zone, not the server's", () => {
  // Staging showed a 12:03 PM Vancouver payment as 7:03 PM, and a refund made on Oct 13 local as Oct 14. The provider
  // here is Toronto; the browser says Vancouver, and the browser wins.
  const PAID = "2026-10-13T19:03:00.000Z";
  const REFUNDED = "2026-10-14T03:30:00.000Z";
  beforeEach(() => {
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (
      this: Intl.DateTimeFormat,
    ) {
      return { ...real.call(this), timeZone: "America/Vancouver" };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const refund: Refund = {
    id: "2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c01",
    kind: "lines",
    reason: "damaged",
    status: "succeeded",
    products: money(2_000),
    shipping: money(0),
    tax: money(260),
    amount: money(2_260),
    daybellFee: money(60),
    unrecovered: money(0),
    createdAt: REFUNDED,
    lines: [{ lineId: L1, quantity: 1 }],
  };

  it("dates the ledger and the refunds table in the viewer's zone", async () => {
    const order = detail({
      paidAt: PAID,
      refunds: [refund],
      ledger: [
        {
          id: "3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c01",
          kind: "order_paid",
          createdAt: PAID,
          entries: [{ id: 1, account: "parent_payments", amount: money(12_430) }],
        },
      ],
    });
    await render(<LedgerSection order={order} />);
    const when = container.querySelector("tbody time");
    expect(when?.textContent).toBe("Oct 13, 2026, 12:03 PM");
    expect(when?.getAttribute("datetime")).toBe(PAID);
    await render(<RefundsSection order={order} onRefunded={() => {}} />);
    const refunded = container.querySelector("tbody time");
    expect(refunded?.textContent).toBe("Oct 13, 2026");
    expect(refunded?.getAttribute("datetime")).toBe(REFUNDED);
  });

  it("dates the orders list in the viewer's zone", async () => {
    api.mockImplementation(async (path: string) =>
      path.startsWith("/jobs")
        ? ok({ jobs: [] })
        : ok({ orders: [listed(O1, "7KQ2M9XA", { paidAt: REFUNDED })], nextCursor: null }),
    );
    await render(<OrdersList />);
    expect(container.querySelector("tbody time")?.textContent).toBe("Oct 13, 2026");
  });
});

describe("Home (Q4, D146)", () => {
  const sales = {
    sales: {
      today: {
        start: "2026-10-13T04:00:00.000Z",
        sales: money(12_430),
        orders: 1,
        daybellFee: money(300),
        averageOrder: money(12_430),
      },
    },
    todo: { toPrint: 2, toShip: 1, toDeliver: 0 },
  };
  const checklist = {
    onboarding: null,
    upNext: {
      items: [
        {
          jobId: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b01",
          jobName: "Maple Grove",
          task: "printQrCards",
          reason: { kind: "nextStep" },
        },
        {
          jobId: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b02",
          jobName: "Oak Park",
          task: "reviewFailedPhotos",
          reason: { kind: "brokenPhotos", count: 4 },
        },
      ],
      total: 2,
    },
  };
  const answer = (salesData: unknown) => async (path: string) =>
    path.startsWith("/studio/checklist") ? ok(checklist) : ok(salesData);
  const link = (href: string) =>
    [...container.querySelectorAll("a")].find((a) => a.getAttribute("href") === href);

  it("gives staff the orders waiting in Up next and never the money", async () => {
    api.mockImplementation(answer({ sales: null, todo: sales.todo }));
    await render(<HomePage />, "staff");
    expect(link("/app/orders?status=paid")?.textContent).toBe(
      "Print 2 ordersPaid and waiting to be printed",
    );
    expect(link("/app/orders?status=printed&delivery=home")?.textContent).toBe(
      "Ship 1 orderPrinted, waiting to be shipped",
    );
    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).not.toContain("$");
    expect(container.textContent).not.toContain("Recently");
  });

  it("gives owners the range's numbers from the ledger in four cards, Daybell's fee last", async () => {
    api.mockImplementation(answer(sales));
    await render(<HomePage />, "owner");
    expect(api.mock.calls.map((c) => c[0])).toContainEqual(
      expect.stringMatching(/^\/studio\/sales\?tz=/),
    );
    const today = container.querySelector('section[aria-label="Today"]');
    const cards = [...(today?.children ?? [])];
    expect(cards.map((c) => c.querySelector("p")?.textContent)).toEqual([
      "Sales",
      "Orders",
      "Average order",
      "Daybell fee",
    ]);
    for (const card of cards) {
      expect(card.className).toMatch(/\brounded-list\b/);
      expect(card.className).toMatch(/\bshadow-card\b/);
    }
    expect(cards[0]?.textContent).toContain("$124.30");
    expect(cards[3]?.textContent).toContain("$3.00");
  });

  it("greets by the time of day as the h1, the range on the same row, no subline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 14, 19, 0));
    try {
      api.mockImplementation(answer(sales));
      await render(<HomePage />, "owner");
    } finally {
      vi.useRealTimers();
    }
    const header = container.querySelector("header");
    expect(header?.querySelector("h1")?.textContent).toBe("Good evening");
    expect(header?.querySelector("p")).toBeNull();
    expect(header?.parentElement?.querySelector("label select")).not.toBeNull();
  });

  it("mixes the jobs' tasks with the orders waiting in one Up next card, most urgent first (D146)", async () => {
    api.mockImplementation(answer(sales));
    await render(<HomePage />, "owner");
    const heading = [...container.querySelectorAll("h2")].find((h) => h.textContent === "Up next");
    const card = container.querySelector(`section[aria-labelledby="${heading?.id}"]`);
    expect(card?.className).toMatch(/\brounded-list\b/);
    expect(card?.textContent).toContain("Picked from all your jobs, most urgent first");
    const rows = [...(card?.querySelectorAll("li") ?? [])].map(
      (li) => li.querySelector("a span span")?.textContent,
    );
    expect(rows).toEqual([
      "Check failed photos · Oak Park",
      "Print 2 orders",
      "Ship 1 order",
      "Print QR cards · Maple Grove",
    ]);
    // Each row is one link: words that underline on hover, a faint chevron hidden from screen readers, never green.
    const row = link("/app/orders?status=paid");
    expect(row?.className).toMatch(/\bhover:bg-canvas\b/);
    expect(row?.className).not.toMatch(/\btext-primary\b/);
    expect(row?.querySelector("span span")?.className).toMatch(/\bgroup-hover:underline\b/);
    expect(row?.querySelector("span span + span")?.className).toMatch(/\btext-body\b/);
    expect(row?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    // No To do card any more.
    expect([...container.querySelectorAll("h2")].map((h) => h.textContent)).not.toContain("To do");
  });

  it("asks nothing about orders for photographers", async () => {
    api.mockImplementation(answer(sales));
    await render(<HomePage />, "photographer");
    expect(api.mock.calls.map((c) => c[0])).not.toContainEqual(
      expect.stringMatching(/^\/studio\/sales/),
    );
    expect(container.textContent).not.toContain("orders");
  });
});
