import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Checkout's parent routes (ADR 0023): the bag is priced by the database, never the browser; Stripe is asked only in
// Montréal (D113) and only for payout regions; the checkout is created with the order's own key and saved; Stripe's
// address is the only place a parent is sent; a replaced checkout is expired at Stripe first, and one paid meanwhile
// becomes the parent's order; the confirmation page asks Stripe only for its own pending order, at most every 5
// seconds (the database decides); downloads are download.jpg signed by the download role for 5 minutes under a
// nameless file name, and a photo without one is queued and answered 409 with Retry-After. Nothing is ever logged.
vi.mock("server-only", () => ({}));
const { rpc, sysRpc, provider, head, presign, downloadPresign, queue, databases } = vi.hoisted(
  () => ({
    rpc: vi.fn(),
    sysRpc: vi.fn(),
    provider: {
      driver: "fake" as "fake" | "stripe",
      livemode: false,
      createCheckoutSession: vi.fn(),
      retrieveCheckoutSession: vi.fn(),
      expireCheckoutSession: vi.fn(),
      setReceiptEmail: vi.fn(),
      recoverCardFee: vi.fn(),
      setCardPrefix: vi.fn(),
    },
    head: vi.fn(),
    presign: vi.fn(),
    downloadPresign: vi.fn(),
    queue: vi.fn(),
    databases: { regions: ["ca"] as string[] },
  }),
);
vi.mock("@/lib/supabase/service", () => ({ shopRpc: rpc, checkoutSystemRpc: sysRpc }));
vi.mock("@/lib/photo-storage", () => ({
  photoStorage: () => ({ head, presignGet: presign }),
  photoDownloadStorage: () => ({ presignGet: downloadPresign }),
  isLocalDriver: () => false,
  queueDownloadForProcessing: queue,
}));
vi.mock("@/lib/photos", () => ({ makeDownloadLocally: vi.fn() }));
vi.mock("@/lib/stripe", async (original) => {
  const real = await original<typeof import("@/lib/stripe")>();
  // The fake provider wherever Stripe is set up; the real refusal where it isn't.
  return { ...real, payments: () => (process.env.STRIPE_DRIVER ? provider : real.payments()) };
});
vi.mock("@daybell/config", async (original) => {
  const real = await original<typeof import("@daybell/config")>();
  const db = (region: string) => ({ region, url: "http://127.0.0.1:54321", publishableKey: "pk" });
  return {
    ...real,
    regionDatabase: (region: string) => (databases.regions.includes(region) ? db(region) : null),
    availableRegions: () => databases.regions.map(db),
  };
});

const key = (fill: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
const env = () => {
  vi.stubEnv("ACCESS_CODE_HMAC_KEY", key(1));
  vi.stubEnv("ACCESS_CODE_ENCRYPTION_KEY", key(2));
  vi.stubEnv("SHOP_THROTTLE_KEY", key(3));
  vi.stubEnv("SHOP_TRUST_XFF", "1");
  vi.stubEnv("VERCEL_REGION", "");
};
env();

const { siteUrl } = await import("@daybell/config");
const { galleryId, tokenHash } = await import("@/lib/shop/session");

const TOKEN = "T".repeat(43);
const GALLERY = galleryId(TOKEN);
const HASH = tokenHash(TOKEN);
const ORDER = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
const OTHER_ORDER = "0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d";
const PHOTO = "f0000000-0000-4000-8000-000000000002";
const FAKE_URL = () => `${siteUrl()}/dev/stripe-checkout?session=cs_test_fakeA`;

const BEGUN = {
  outcome: "created",
  order_id: ORDER,
  reference: "7KQ2M9XA",
  created_at: "2026-10-13T12:00:00.000Z",
  checkout_session_id: null,
  superseded: [],
  studio_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  studio_name: "Maple Lane Photography",
  currency: "CAD",
  stripe_account_id: "acct_A1",
  card_prefix_set: true,
  tax_enabled: true,
  shipping_method: "home",
  shipping_cents: 1195,
  products_cents: 10000,
  daybell_fee_cents: 300,
  lines: [{ kind: "package", name: "Package A", unit_price_cents: 10000, quantity: 1 }],
};

/** Stripe's facts for a paid checkout (the fake's shape), with `over` replacing any. */
const paid = (over: Record<string, unknown> = {}) => ({
  id: "cs_test_fakeA",
  status: "complete",
  paymentStatus: "paid",
  livemode: false,
  url: null,
  expiresAt: 0,
  currency: "cad",
  amountSubtotal: 10000,
  amountShipping: 1195,
  amountTax: 1455,
  amountTotal: 12650,
  orderId: ORDER,
  studioId: BEGUN.studio_id,
  region: "ca",
  paymentIntentId: "pi_1",
  chargeId: "ch_1",
  transferId: "tr_1",
  destination: "acct_A1",
  applicationFeeAmount: 300,
  balanceTransaction: { id: "txn_1", feeCents: 397, currency: "cad" },
  receiptEmail: "parent@example.test",
  shipping: {
    name: "Priya Patel",
    line1: "12 Maple Lane",
    line2: null,
    city: "Toronto",
    state: "ON",
    postalCode: "M5V 2T6",
    country: "CA",
  },
  ...over,
});

type Answer = { data?: unknown; error?: unknown };
function shopDb(answers: Record<string, Answer>) {
  rpc.mockImplementation(async (_region: string, fn: string) => {
    const a = answers[fn] ?? (fn === "take_shop_request" ? { data: true } : { data: null });
    return { data: a.data ?? null, error: a.error ?? null };
  });
}
function systemDb(answers: Record<string, Answer> = {}) {
  sysRpc.mockImplementation(async (_region: string, fn: string) => {
    const a =
      answers[fn] ??
      (fn === "complete_order"
        ? { data: "paid" }
        : fn === "settle_order_fees"
          ? { data: "settled" }
          : { data: true });
    return { data: a.data ?? null, error: a.error ?? null };
  });
}
const shopCalls = (fn: string) => rpc.mock.calls.filter((c) => c[1] === fn);
const sysCalls = (fn: string) => sysRpc.mock.calls.filter((c) => c[1] === fn);

function request(
  method: string,
  path: string,
  body?: unknown,
  cookie = `daybell_shop=ca.${TOKEN}`,
) {
  return new Request(`http://localhost/api/v1/shop${path}?gallery=${GALLERY}`, {
    method,
    headers: {
      cookie,
      "x-forwarded-for": "203.0.113.7",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
}

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  databases.regions = ["ca"];
  provider.driver = "fake";
  vi.stubEnv("STRIPE_DRIVER", "fake");
  provider.createCheckoutSession.mockImplementation(async () => ({
    id: "cs_test_fakeA",
    url: FAKE_URL(),
    expiresAt: 1_791_001_860,
  }));
  provider.recoverCardFee.mockResolvedValue({ reversalId: "trr_1" });
  provider.setReceiptEmail.mockResolvedValue(undefined);
  systemDb();
  logs = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});
afterEach(() => {
  // Nothing personal, and in these tests nothing at all, is logged.
  for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  env();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const checkout = async (req: Request) => (await import("./shop/checkout/route")).POST(req);

describe("POST /shop/checkout", () => {
  it("prices the bag in the database, makes the checkout with the order's own key, saves it and answers Stripe's address", async () => {
    shopDb({ shop_checkout_begin: { data: BEGUN } });
    // Whatever the browser sends is ignored: there is no body to price from.
    const res = await checkout(request("POST", "/checkout", { price: 1, total: 1 }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ orderId: ORDER, url: FAKE_URL() });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(shopCalls("shop_checkout_begin")[0]?.[2]).toEqual({ p_session_hash: HASH });
    const [params, idempotencyKey] = provider.createCheckoutSession.mock.calls[0] ?? [];
    expect(idempotencyKey).toBe(`daybell-checkout-${ORDER}`);
    expect(params).toMatchObject({
      line_items: [{ quantity: 1, price_data: { unit_amount: 10000, currency: "cad" } }],
      payment_intent_data: {
        on_behalf_of: "acct_A1",
        transfer_data: { destination: "acct_A1" },
        application_fee_amount: 300,
        description: "Payments processed by Daybell for Maple Lane Photography",
      },
      automatic_tax: { enabled: true, liability: { type: "account", account: "acct_A1" } },
      expires_at: Date.parse(BEGUN.created_at) / 1000 + 31 * 60,
      success_url: `${siteUrl()}/shop/orders/${ORDER}?gallery=${GALLERY}`,
    });
    expect(shopCalls("shop_checkout_attach")[0]?.[2]).toMatchObject({
      p_order_id: ORDER,
      p_checkout_session_id: "cs_test_fakeA",
    });
    expect(provider.setCardPrefix).not.toHaveBeenCalled();
  });

  it("sets the studio's card prefix at its first checkout (call 7)", async () => {
    shopDb({ shop_checkout_begin: { data: { ...BEGUN, card_prefix_set: false } } });
    provider.setCardPrefix.mockResolvedValue(undefined);
    expect((await checkout(request("POST", "/checkout"))).status).toBe(201);
    expect(provider.setCardPrefix).toHaveBeenCalledWith("acct_A1");
    expect(sysCalls("mark_card_prefix_set")[0]?.[2]).toEqual({ p_stripe_account_id: "acct_A1" });
  });

  it("sends a parent only to Stripe's own checkout (the real driver) or this deployment's fake one", async () => {
    shopDb({ shop_checkout_begin: { data: BEGUN } });
    provider.driver = "stripe";
    const res = await checkout(request("POST", "/checkout"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(logs[3]?.mock.calls)).toContain("stripe_checkout_link_unexpected");
    expect(JSON.stringify(logs[3]?.mock.calls)).not.toContain("cs_test");
    for (const spy of logs) spy.mockClear();
  });

  it("asks Stripe nothing outside Montréal (D113), before writing anything", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    shopDb({ shop_checkout_begin: { data: BEGUN } });
    const res = await checkout(request("POST", "/checkout"));
    expect(res.status).toBe(422);
    expect(shopCalls("shop_checkout_begin")).toHaveLength(0);
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
    for (const spy of logs) spy.mockClear();
  });

  it("refuses US galleries: payments are Canadian only for now (ADR 0020)", async () => {
    databases.regions = ["ca", "us"];
    shopDb({ shop_checkout_begin: { data: BEGUN } });
    const res = await checkout(request("POST", "/checkout", undefined, `daybell_shop=us.${TOKEN}`));
    expect(res.status).toBe(422);
    expect(shopCalls("shop_checkout_begin")).toHaveLength(0);
  });

  it("says so where Stripe isn't set up (PR previews)", async () => {
    vi.stubEnv("STRIPE_DRIVER", "");
    shopDb({ shop_checkout_begin: { data: BEGUN } });
    const res = await checkout(request("POST", "/checkout"));
    expect(res.status).toBe(422);
    expect((await res.json()).error.fields).toEqual({ form: "shop.checkoutNotConfigured" });
  });

  it("names the database's refusals, and limits checkouts per session", async () => {
    for (const [message, form] of [
      ["bag_empty", "shop.bagEmpty"],
      ["line_unavailable", "shop.lineUnavailable"],
      ["shop_closed", "shop.closed"],
      ["choose_delivery", "shop.chooseDelivery"],
      ["not_accepting", "shop.notAccepting"],
      ["below_minimum", "shop.belowMinimum"],
    ]) {
      shopDb({ shop_checkout_begin: { error: { code: "P0001", message } } });
      const res = await checkout(request("POST", "/checkout"));
      expect(res.status, message).toBe(409);
      expect((await res.json()).error.fields).toEqual({ form });
    }
    shopDb({ shop_checkout_begin: { error: { code: "P0001", message: "checkout_limit" } } });
    const limited = await checkout(request("POST", "/checkout"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("600");
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("expires a replaced checkout at Stripe first, and one paid meanwhile becomes the parent's order", async () => {
    shopDb({ shop_checkout_begin: { data: { ...BEGUN, superseded: ["cs_test_fakeOLD"] } } });
    provider.expireCheckoutSession.mockResolvedValueOnce({ status: "expired" });
    expect((await checkout(request("POST", "/checkout"))).status).toBe(201);
    expect(provider.expireCheckoutSession).toHaveBeenCalledWith("cs_test_fakeOLD");

    provider.expireCheckoutSession.mockResolvedValueOnce({ status: "complete" });
    provider.retrieveCheckoutSession.mockResolvedValueOnce(
      paid({ id: "cs_test_fakeOLD", orderId: OTHER_ORDER }),
    );
    provider.createCheckoutSession.mockClear();
    const res = await checkout(request("POST", "/checkout"));
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({
      form: "shop.alreadyPaid",
      orderId: OTHER_ORDER,
    });
    expect(sysCalls("complete_order")[0]?.[2].p_order_id).toBe(OTHER_ORDER);
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("uses the same bag's open checkout again, without making another", async () => {
    shopDb({
      shop_checkout_begin: {
        data: { ...BEGUN, outcome: "reuse", checkout_session_id: "cs_test_fakeA" },
      },
    });
    provider.retrieveCheckoutSession.mockResolvedValueOnce(
      paid({ status: "open", paymentStatus: "unpaid", url: FAKE_URL() }),
    );
    const res = await checkout(request("POST", "/checkout"));
    expect(await res.json()).toEqual({ orderId: ORDER, url: FAKE_URL() });
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("refuses a gallery that isn't on this device", async () => {
    const res = await checkout(
      new Request("http://localhost/api/v1/shop/checkout", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.7" },
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /shop/checkout/cancel", () => {
  it("expires the gallery's open checkouts at Stripe and here; one paid meanwhile is completed", async () => {
    shopDb({
      shop_pending_checkouts: {
        data: [
          { order_id: OTHER_ORDER, checkout_session_id: "cs_test_fakeB" },
          { order_id: ORDER, checkout_session_id: "cs_test_fakeA" },
        ],
      },
    });
    provider.expireCheckoutSession
      .mockResolvedValueOnce({ status: "expired" })
      .mockResolvedValueOnce({ status: "complete" });
    provider.retrieveCheckoutSession.mockResolvedValueOnce(paid());
    const res = await (await import("./shop/checkout/cancel/route")).POST(
      request("POST", "/checkout/cancel"),
    );
    expect(res.status).toBe(204);
    expect(sysCalls("expire_order").map((c) => c[2])).toEqual([{ p_order_id: OTHER_ORDER }]);
    expect(sysCalls("complete_order")[0]?.[2].p_order_id).toBe(ORDER);
  });
});

describe("GET /shop/orders/:orderId (the confirmation page)", () => {
  const get = async (orderId = ORDER) =>
    (await import("./shop/orders/[orderId]/route")).GET(request("GET", `/orders/${orderId}`), {
      params: Promise.resolve({ orderId }),
    });
  const ROW = {
    id: ORDER,
    reference: "7KQ2M9XA",
    status: "paid",
    view: "full",
    paid_at: "2026-10-13T12:01:00Z",
    created_at: "2026-10-13T12:00:00Z",
    currency: "CAD",
    studio_name: "Maple Lane Photography",
    shipping_method: "home",
    totals: { products_cents: 10000, shipping_cents: 1195, tax_cents: 1455, total_cents: 12650 },
    registrations: [{ kind: "gst_hst", province: null, number: "123456789RT0001" }],
    children: [
      {
        id: "c0000000-0000-4000-8000-000000000001",
        state: "open",
        first_name: "Ava",
        last_initial: "P",
      },
    ],
    lines: [
      {
        id: "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
        child_id: "c0000000-0000-4000-8000-000000000001",
        kind: "package",
        name: "Package A",
        print_size: null,
        quantity: 1,
        unit_price_cents: 10000,
        line_total_cents: 10000,
        contents: [{ kind: "digital", print_size: null, quantity: 1 }],
        downloads: [PHOTO],
      },
    ],
  };

  it("doesn't ask Stripe when the database says not to (paid, another session's, or asked under 5 seconds ago)", async () => {
    shopDb({ shop_order_verify: { data: null }, shop_order: { data: ROW } });
    const res = await get();
    expect(res.status).toBe(200);
    const { order } = await res.json();
    expect(order).toMatchObject({
      reference: "7KQ2M9XA",
      totals: { total: { cents: 12650, currency: "CAD" } },
      children: [{ displayName: "Ava P." }],
      lines: [{ downloads: [{ photoId: PHOTO, n: 1 }] }],
    });
    expect(provider.retrieveCheckoutSession).not.toHaveBeenCalled();
  });

  it("completes its own pending order from Stripe when the webhook is late: paid, receipt, fee recovered, ledger", async () => {
    shopDb({ shop_order_verify: { data: "cs_test_fakeA" }, shop_order: { data: ROW } });
    provider.retrieveCheckoutSession.mockResolvedValueOnce(paid());
    expect((await get()).status).toBe(200);
    expect(sysCalls("complete_order")[0]?.[2]).toMatchObject({
      p_order_id: ORDER,
      p_facts: { checkout_session_id: "cs_test_fakeA", amount_tax: 1455, destination: "acct_A1" },
    });
    // The email goes to Stripe for its receipt (call 18) and nowhere else: not to the database.
    expect(JSON.stringify(sysRpc.mock.calls)).not.toContain("parent@example.test");
    expect(provider.setReceiptEmail).toHaveBeenCalledWith("pi_1", "parent@example.test");
    expect(provider.recoverCardFee).toHaveBeenCalledWith({
      transferId: "tr_1",
      amountCents: 397,
      orderId: ORDER,
    });
    expect(sysCalls("settle_order_fees")[0]?.[2]).toEqual({
      p_order_id: ORDER,
      p_transfer_id: "tr_1",
      p_stripe_fee_cents: 397,
      p_fee_currency: "cad",
      p_balance_transaction_id: "txn_1",
      p_fee_reversal_id: "trr_1",
    });
  });

  it("asks Stripe nothing more once the order's fees are settled", async () => {
    shopDb({ shop_order_verify: { data: "cs_test_fakeA" }, shop_order: { data: ROW } });
    provider.retrieveCheckoutSession.mockResolvedValueOnce(paid());
    systemDb({ complete_order: { data: "already_settled" } });
    expect((await get()).status).toBe(200);
    expect(provider.setReceiptEmail).not.toHaveBeenCalled();
    expect(provider.recoverCardFee).not.toHaveBeenCalled();
  });

  it("is not found for a malformed id or one this gallery can't see", async () => {
    expect((await get("nope")).status).toBe(404);
    shopDb({
      shop_order_verify: { data: null },
      shop_order: { error: { code: "P0002", message: "x" } },
    });
    expect((await get()).status).toBe(404);
  });
});

describe("GET /shop/orders/:orderId/downloads/:photoId (calls 10, 11)", () => {
  const get = async () =>
    (await import("./shop/orders/[orderId]/downloads/[photoId]/route")).GET(
      request("GET", `/orders/${ORDER}/downloads/${PHOTO}`),
      { params: Promise.resolve({ orderId: ORDER, photoId: PHOTO }) },
    );
  const ROW = {
    studio_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    job_id: "a0000000-0000-4000-8000-000000000001",
    photo_id: PHOTO,
    reference: "7KQ2M9XA",
    n: 3,
  };

  it("signs download.jpg (never the original) with the download role for 5 minutes, as a nameless file", async () => {
    shopDb({ shop_download_photo: { data: ROW } });
    head.mockResolvedValue({ size: 10 });
    downloadPresign.mockResolvedValue("https://photos.example.test/signed");
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://photos.example.test/signed");
    const [key, options] = downloadPresign.mock.calls[0] ?? [];
    expect(key).toBe(`${ROW.studio_id}/${ROW.job_id}/${PHOTO}/download.jpg`);
    expect(options).toMatchObject({
      expiresIn: 300,
      download: { filename: "daybell-7KQ2M9XA-3.jpg" },
    });
    expect(presign).not.toHaveBeenCalled();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(300_000);
  });

  it("queues a photo processed before downloads existed and answers 409 with Retry-After (the backfill)", async () => {
    shopDb({ shop_download_photo: { data: ROW } });
    head.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(409);
    expect(res.headers.get("retry-after")).toBe("20");
    expect((await res.json()).error.fields).toEqual({ form: "shop.downloadPreparing" });
    expect(queue).toHaveBeenCalledWith("ca", PHOTO);
    expect(downloadPresign).not.toHaveBeenCalled();
  });

  it("is not found for anything the database doesn't unlock for this gallery", async () => {
    shopDb({ shop_download_photo: { error: { code: "P0002", message: "Download not found" } } });
    expect((await get()).status).toBe(404);
    expect(head).not.toHaveBeenCalled();
  });
});
