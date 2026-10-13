// @vitest-environment jsdom
import type { StudioOrder, StudioOrderDetail } from "@daybell/api";
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
// Home gives staff the To do list and never the money (Q4).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/app/orders",
}));
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client-api", async (original) => ({
  ...(await original<typeof import("@/lib/client-api")>()),
  api,
}));
// Home's other cards make their own calls; they are tested elsewhere.
vi.mock("../home-checklist", () => ({ HomeChecklist: () => null }));
vi.mock("../jobs-selling", () => ({ JobsSelling: () => null }));
vi.mock("../activity-card", () => ({ ActivityCard: () => <p>Activity card</p> }));

const { OrdersList } = await import("./orders-list");
const { RefundForm, RefundsSection } = await import("./[id]/refunds");
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

const listed = (id: string, reference: string): StudioOrder =>
  ({
    id,
    reference,
    paidAt: "2026-10-13T12:00:00.000Z",
    children: [{ id: L1, displayName: "Ava P." }],
    items: 2,
    total: money(4520),
    fulfilment: "paid",
    refund: "none",
    disputed: false,
    shippingMethod: "school",
  }) as unknown as StudioOrder;

/** 2 prints at $20 and one at $60, $10 shipping, 13% HST, Daybell's 3% on products. */
const detail = (over: Partial<StudioOrderDetail> = {}): StudioOrderDetail =>
  ({
    id: O1,
    reference: "7KQ2M9XA",
    paidAt: "2026-10-13T12:00:00.000Z",
    products: money(10_000),
    shipping: money(1_000),
    tax: money(1_430),
    total: money(12_430),
    daybellFee: { basisPoints: 300, amount: money(300) },
    feesSettled: true,
    refundInFlight: false,
    refund: "none",
    fulfilment: "paid",
    lines: [
      { id: L1, name: "5×7 print", quantity: 2, refundedQuantity: 0, unitPrice: money(2_000) },
      { id: L2, name: "Package A", quantity: 1, refundedQuantity: 0, unitPrice: money(6_000) },
    ],
    refunds: [],
    refundable: {
      products: money(10_000),
      shipping: money(1_000),
      tax: money(1_430),
      daybellFee: money(300),
      refunded: money(0),
    },
    ...over,
  }) as unknown as StudioOrderDetail;

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

describe("Home (Q4)", () => {
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

  it("gives staff the To do list and never the money", async () => {
    api.mockResolvedValue(ok({ sales: null, todo: sales.todo }));
    await render(<HomePage />, "staff");
    expect(container.querySelector('a[href="/app/orders?status=paid"]')?.textContent).toBe(
      "2 orders to print",
    );
    expect(container.querySelector('a[href="/app/orders?status=printed"]')?.textContent).toBe(
      "1 order to ship",
    );
    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).not.toContain("$");
    expect(container.textContent).not.toContain("Activity card");
  });

  it("gives owners today's sales from the ledger", async () => {
    api.mockResolvedValue(ok(sales));
    await render(<HomePage />, "owner");
    expect(api.mock.calls[0]?.[0]).toMatch(/^\/studio\/sales\?tz=/);
    const today = container.querySelector('section[aria-label="Today"]')?.textContent ?? "";
    expect(today).toContain("$124.30");
    expect(today).toContain("$3.00");
  });

  it("asks nothing about orders for photographers", async () => {
    await render(<HomePage />, "photographer");
    expect(api).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("To do");
  });
});
