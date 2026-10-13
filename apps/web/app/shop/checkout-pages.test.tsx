// @vitest-environment jsdom
import type { ShopCartResponse, ShopGallerySession, ShopOrder } from "@daybell/api";
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";

// Checkout's parent screens (ADR 0023 §6) with the API faked: Pay shows only when the bag can be paid for and says why
// otherwise (call 13's minimum included); paying goes straight to Stripe's address; a refusal is announced; a bag paid
// meanwhile opens its order; coming back without paying cancels and says the bag is unchanged; the order page asks
// again while the payment is confirmed, names its download buttons "Download photo n" and goes to the file; "Your
// orders" lists references; no page title names a child.
const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
  params: {} as Record<string, string>,
  search: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useParams: () => nav.params,
  useSearchParams: () => nav.search,
  usePathname: () => "/shop",
}));
const api = vi.hoisted(() => ({
  session: vi.fn(),
  forget: vi.fn(),
  cart: vi.fn(),
  setQuantity: vi.fn(),
  removeLine: vi.fn(),
  setShipping: vi.fn(),
  checkout: vi.fn(),
  cancelCheckout: vi.fn(),
  orders: vi.fn(),
  order: vi.fn(),
  download: vi.fn(),
}));
vi.mock("@/lib/shop-client", async (original) => ({
  ...(await original<typeof import("@/lib/shop-client")>()),
  shopApi: api,
}));

const { ShopProvider } = await import("./_components/shop-context");
const { default: BagPage } = await import("./bag/page");
const { default: OrderPage } = await import("./orders/[orderId]/page");
const { default: OrdersPage } = await import("./orders/page");

const G = "0123456789abcdef0123456789abcdef";
const AVA = "c0000000-0000-4000-8000-000000000001";
const ORDER = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
const PHOTO = "f0000000-0000-4000-8000-000000000002";
const gallery: ShopGallerySession = {
  id: G,
  studio: { name: "Maple Lane Photography" },
  expiresAt: "2026-11-11T12:00:00+00:00",
  bagCount: 1,
  children: [
    {
      id: AVA,
      state: "open",
      displayName: "Ava P.",
      firstName: "Ava",
      jobId: "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e",
      school: "Maple Grove Elementary",
      pictureDay: "2026-10-13",
      closesAt: null,
      deliverToSchool: true,
    },
  ],
};
const money = (cents: number) => ({ cents, currency: "CAD" as const });
const cart = (cents: number, method: "home" | null): ShopCartResponse => ({
  lines: [
    {
      id: "11111111-0000-4000-8000-000000000001",
      childId: AVA,
      itemId: "22222222-0000-4000-8000-000000000001",
      kind: "print",
      name: "5×7 print",
      printSize: "5x7",
      unitPrice: money(cents),
      quantity: 1,
      lineTotal: money(cents),
      available: true,
      physical: true,
      photo: null,
    },
  ],
  count: 1,
  subtotal: money(cents),
  shipping: { needed: true, home: money(0), school: true, method, cost: method ? money(0) : null },
  total: method ? money(cents) : null,
});
const order = (over: Partial<ShopOrder> = {}): ShopOrder => ({
  id: ORDER,
  reference: "7KQ2M9XA",
  status: "paid",
  view: "full",
  paidAt: "2026-10-13T12:01:00.000Z",
  createdAt: "2026-10-13T12:00:00.000Z",
  studio: { name: "Maple Lane Photography" },
  shippingMethod: "home",
  totals: { products: money(3300), shipping: money(1195), tax: money(585), total: money(5080) },
  registrations: [{ kind: "gst_hst", province: null, number: "123456789RT0001" }],
  children: [{ id: AVA, state: "open", displayName: "Ava P." }],
  lines: [
    {
      id: "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
      childId: AVA,
      kind: "digital_single",
      name: "Digital download",
      printSize: null,
      quantity: 1,
      unitPrice: money(3300),
      lineTotal: money(3300),
      contents: [],
      downloads: [{ photoId: PHOTO, n: 1 }],
    },
  ],
  ...over,
});
const ok = <T,>(data: T) => ({ ok: true as const, data });
const refused = (
  status: number,
  code: string,
  form: string | null,
  fields: Record<string, string> = {},
) => ({
  ok: false as const,
  status,
  code,
  form,
  retryAfter: null,
  fields: { ...(form ? { form } : {}), ...fields },
});

let container: HTMLDivElement;
let root: Root;
const assign = vi.fn();
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
async function render(ui: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages} timeZone="America/Toronto">
        <ShopProvider>{ui}</ShopProvider>
      </NextIntlClientProvider>,
    );
  });
  await wait(20);
}
const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name) ?? null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  nav.search = new URLSearchParams({ gallery: G });
  nav.params = {};
  for (const fn of Object.values(api)) fn.mockReset();
  for (const fn of Object.values(nav.router)) fn.mockReset();
  api.session.mockResolvedValue(ok({ galleries: [gallery] }));
  assign.mockReset();
  // jsdom can't navigate: the pages' window.location.assign is watched instead.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("the bag's Pay (ADR 0023 §6)", () => {
  it("says what stops paying instead of a button, until delivery is chosen", async () => {
    api.cart.mockResolvedValue(ok(cart(1900, null)));
    await render(<BagPage />);
    const dock = container.querySelector("[data-docked-cta]");
    expect(dock?.textContent).toBe("Choose delivery to pay.");
    expect(button("Pay securely")).toBeNull();
  });

  it("refuses a bag below Stripe's minimum with its amount (call 13)", async () => {
    api.cart.mockResolvedValue(ok(cart(40, "home")));
    await render(<BagPage />);
    expect(container.querySelector("[data-docked-cta]")?.textContent).toBe(
      "Minimum order is $0.50.",
    );
  });

  it("goes straight to Stripe's address, with the total and the D104 line on the page", async () => {
    api.cart.mockResolvedValue(ok(cart(1900, "home")));
    api.checkout.mockResolvedValue(
      ok({ orderId: ORDER, url: "https://checkout.stripe.com/c/pay/cs_test_1" }),
    );
    await render(<BagPage />);
    expect(container.textContent).toContain(
      "Payments processed by Daybell for Maple Lane Photography.",
    );
    const pay = button("Pay securely");
    expect(container.querySelector("[data-docked-cta]")?.textContent).toContain("$19.00");
    await act(async () => pay?.click());
    await wait(20);
    expect(api.checkout).toHaveBeenCalledWith(G);
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_1");
  });

  it("announces a refusal and reads the bag again", async () => {
    api.cart.mockResolvedValue(ok(cart(1900, "home")));
    api.checkout.mockResolvedValue(refused(409, "conflict", "shop.lineUnavailable"));
    await render(<BagPage />);
    await act(async () => button("Pay securely")?.click());
    await wait(20);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Something in your bag isn’t available any more. Remove it, then pay.",
    );
    expect(api.cart).toHaveBeenCalledTimes(2);
    expect(assign).not.toHaveBeenCalled();
  });

  it("opens the order when the bag was paid for meanwhile", async () => {
    api.cart.mockResolvedValue(ok(cart(1900, "home")));
    api.checkout.mockResolvedValue(
      refused(409, "conflict", "shop.alreadyPaid", { orderId: ORDER }),
    );
    await render(<BagPage />);
    await act(async () => button("Pay securely")?.click());
    await wait(20);
    expect(nav.router.push).toHaveBeenCalledWith(`/shop/orders/${ORDER}?gallery=${G}`);
  });

  it("cancels the checkout when the parent comes back without paying, and says the bag is unchanged", async () => {
    nav.search = new URLSearchParams({ gallery: G, checkout: "canceled" });
    api.cart.mockResolvedValue(ok(cart(1900, "home")));
    api.cancelCheckout.mockResolvedValue(ok(undefined));
    await render(<BagPage />);
    expect(api.cancelCheckout).toHaveBeenCalledWith(G);
    expect(nav.router.replace).toHaveBeenCalledWith(`/shop/bag?gallery=${G}`);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Payment canceled. Your bag is unchanged.",
    );
  });
});

describe("the order page (ADR 0023 §6)", () => {
  beforeEach(() => {
    nav.params = { orderId: ORDER };
  });

  it("thanks the parent, shows tax and the studio's number, and names each download by its number", async () => {
    api.order.mockResolvedValue(ok({ order: order() }));
    api.download.mockResolvedValue(ok({ url: "https://photos.example.test/d", expiresAt: "x" }));
    await render(<OrderPage />);
    expect(document.title).toBe("Your order");
    expect(container.textContent).toContain("Thank you!");
    expect(container.textContent).toContain("Order 7KQ2-M9XA");
    expect(container.textContent).toContain("Stripe emails your receipt.");
    expect(container.textContent).toContain("GST/HST 123456789RT0001");
    expect(container.textContent).toContain("$50.80");
    const download = button("Download photo 1");
    expect(download).not.toBeNull();
    await act(async () => download?.click());
    await wait(20);
    expect(api.download).toHaveBeenCalledWith(G, ORDER, PHOTO);
    expect(assign).toHaveBeenCalledWith("https://photos.example.test/d");
  });

  it("asks again while the payment is being confirmed", async () => {
    api.order
      .mockResolvedValueOnce(ok({ order: order({ status: "pending", paidAt: null }) }))
      .mockResolvedValue(ok({ order: order() }));
    await render(<OrderPage />);
    expect(container.textContent).toContain("We’re confirming your payment…");
    await wait(1100);
    expect(api.order).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Thank you!");
  });

  it("says a download is being prepared instead of failing", async () => {
    api.order.mockResolvedValue(ok({ order: order() }));
    api.download.mockResolvedValue(refused(409, "conflict", "shop.downloadPreparing"));
    await render(<OrderPage />);
    await act(async () => button("Download photo 1")?.click());
    await wait(20);
    expect(container.textContent).toContain(
      "Your download is being prepared. Try again in a minute.",
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows another parent only their child's part, with no amounts", async () => {
    api.order.mockResolvedValue(
      ok({
        order: order({
          view: "child",
          totals: null,
          registrations: [],
          lines: [
            { ...order().lines[0], unitPrice: null, lineTotal: null } as ShopOrder["lines"][number],
          ],
        }),
      }),
    );
    await render(<OrderPage />);
    expect(container.textContent).toContain("Showing what was ordered for your child.");
    expect(container.textContent).not.toContain("$");
  });
});

describe("Your orders", () => {
  it("lists each order by reference with its downloads, under a title that names no child", async () => {
    api.orders.mockResolvedValue(
      ok({
        orders: [
          {
            id: ORDER,
            reference: "7KQ2M9XA",
            status: "paid",
            view: "full",
            paidAt: "2026-10-13T12:01:00.000Z",
            createdAt: "2026-10-13T12:00:00.000Z",
            children: [{ id: AVA, state: "open", displayName: "Ava P." }],
            downloads: 3,
          },
        ],
      }),
    );
    await render(<OrdersPage />);
    expect(document.title).toBe("Your orders");
    const link = container.querySelector(`a[href="/shop/orders/${ORDER}?gallery=${G}"]`);
    expect(link?.textContent).toContain("Order 7KQ2-M9XA");
    expect(link?.textContent).toContain("3 downloads");
    expect(link?.textContent).toContain("For Ava P.");
  });
});
