import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The studio's orders (ADR 0024; answers 3, 4; Q4): owners, admins and staff list and fulfil orders, photographers
// can't; owners and admins refund and undo, staff can't, and staff never get refunds, the ledger or Home's money;
// every call names the studio and acts for the signed-in person; the database's named refusals become 409s with an
// orders.* code (Stripe's fee still pending with Retry-After). Scope, database and Stripe are faked; nothing is logged.
vi.mock("server-only", () => ({}));
const { scope, writeRpc, systemRpc, provider, zips } = vi.hoisted(() => ({
  scope: vi.fn(),
  writeRpc: vi.fn(),
  systemRpc: vi.fn(),
  provider: {
    driver: "stripe",
    livemode: false,
    createRefund: vi.fn(),
    retrieveRefund: vi.fn(),
    transferRemaining: vi.fn(),
    reverseForRefund: vi.fn(),
  },
  zips: { printFiles: vi.fn() },
}));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));
vi.mock("@/lib/supabase/service", () => ({
  orderWriteRpc: writeRpc,
  orderSystemRpc: systemRpc,
  checkoutSystemRpc: systemRpc,
}));
vi.mock("@/lib/stripe", async (original) => ({
  ...(await original<typeof import("@/lib/stripe")>()),
  payments: () => provider,
}));
vi.mock("@/lib/orders/zips", () => zips);

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "a0000000-0000-4000-8000-000000000001";
const ORDER = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
const REFUND = "aaaa0000-0000-4000-8000-000000000001";
const LINE = "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a";
const USER = "11111111-1111-4111-8111-111111111111";

/** A stand-in Supabase client: tables answer from `rows`, functions from `rpcs`; every call is recorded. */
function fakeDatabase(rows: Record<string, unknown>, rpcs: Record<string, unknown>) {
  const ops: [string, string, unknown[]][] = [];
  const from = (table: string) => {
    const chain: object = new Proxy(
      {},
      {
        get: (_t, prop: string) =>
          prop === "then"
            ? (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? null, error: null })
            : (...args: unknown[]) => {
                ops.push([table, prop, args]);
                return chain;
              },
      },
    );
    return chain;
  };
  const rpc = vi.fn(async (fn: string, _args?: unknown) => {
    const answer = rpcs[fn];
    return answer && typeof answer === "object" && "error" in (answer as object)
      ? answer
      : { data: answer ?? null, error: null };
  });
  return { supabase: { from, rpc }, ops, rpc };
}
function signIn(
  role: string,
  rpcs: Record<string, unknown> = {},
  rows: Record<string, unknown> = {},
  region = "ca",
) {
  const db = fakeDatabase(rows, rpcs);
  scope.mockResolvedValue({
    supabase: db.supabase,
    studio: { id: STUDIO, name: "Maple Lane", slug: "maple", region, role },
    userId: USER,
  });
  return db;
}

const LIST_ROW = {
  id: ORDER,
  reference: "7KQ2M9XA",
  paid_at: "2026-10-13T12:00:00Z",
  currency: "CAD",
  total_cents: 12650,
  shipping_method: "home",
  fulfilment: "printed",
  disputed: false,
  refund: "partly_refunded",
  items: 3,
  children: [{ id: "c1", first_name: "Ava", last_initial: "P" }],
};
const DETAIL = {
  id: ORDER,
  reference: "7KQ2M9XA",
  paid_at: "2026-10-13T12:00:00Z",
  currency: "CAD",
  products_cents: 10000,
  shipping_cents: 1195,
  tax_cents: 1455,
  total_cents: 12650,
  daybell_fee_bps: 300,
  daybell_fee_cents: 300,
  stripe_fee_cents: 397,
  fees_settled: true,
  shipping_method: "home",
  fulfilment: "shipped",
  printed_at: "2026-10-14T12:00:00Z",
  shipped_at: "2026-10-15T12:00:00Z",
  delivered_at: null,
  canceled_at: null,
  disputed_at: null,
  ship_to_purged_at: null,
  external_refund_at: null,
  external_refund_checked_at: null,
  tracking: { carrier: "ups", number: "1Z999", url: null },
  refund_state: {
    badge: "partly_refunded",
    in_flight: false,
    fully_refunded: false,
    lines: { [LINE]: 1 },
  },
  lines: [
    {
      id: LINE,
      kind: "print",
      name: "4×6 print",
      print_size: "4x6",
      quantity: 2,
      unit_price_cents: 1300,
      line_total_cents: 2600,
      photo_id: null,
      physical: true,
      child: { id: "c1", first_name: "Ava", last_name: "Patel" },
      contents: [],
    },
  ],
  refunds: [
    {
      id: REFUND,
      kind: "lines",
      reason: "damaged",
      status: "succeeded",
      products_cents: 1300,
      shipping_cents: 0,
      tax_cents: 169,
      amount_cents: 1469,
      daybell_fee_cents: 39,
      unrecovered_cents: 0,
      created_at: "2026-10-16T12:00:00Z",
      lines: [{ line_id: LINE, quantity: 1 }],
    },
  ],
  refundable: {
    products_cents: 8700,
    shipping_cents: 1195,
    tax_cents: 1286,
    daybell_fee_cents: 261,
    refunded_cents: 1469,
  },
  ledger: [
    {
      id: "dddddddd-0000-4000-8000-000000000001",
      kind: "order_refunded",
      created_at: "2026-10-16T12:00:00Z",
      entries: [
        { id: 11, account: "refunds", amount_cents: -1469 },
        { id: 12, account: "tax_payable", amount_cents: 169 },
        { id: 13, account: "daybell_fees", amount_cents: 39 },
        { id: 14, account: "studio_payable", amount_cents: 1261 },
      ],
    },
  ],
  ship_to: null,
};

const ctx = (id = ORDER) => ({ params: Promise.resolve({ id }) });
const json = (method: string, body?: unknown, url = "http://localhost/api/v1/x") =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
const refusal = (message: string, code = "P0001") => ({ data: null, error: { code, message } });

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  vi.stubEnv("VERCEL_REGION", "");
  writeRpc.mockResolvedValue({ data: "printed", error: null });
  systemRpc.mockResolvedValue({ data: null, error: null });
  logs = (["log", "warn", "error"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});
afterEach(() => {
  for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("GET /orders (Q4)", () => {
  const list = async (query = "") =>
    (await import("./orders/route")).GET(new Request(`http://localhost/api/v1/orders?${query}`));

  it("gives owners, admins and staff the studio's orders: names short, status and refund badge", async () => {
    for (const role of ["owner", "admin", "staff"]) {
      const db = signIn(role, { studio_orders: [LIST_ROW, { ...LIST_ROW, id: "x" }] });
      const res = await list("limit=1&status=printed&q=7kq2-m9");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        orders: [
          {
            id: ORDER,
            reference: "7KQ2M9XA",
            paidAt: "2026-10-13T12:00:00.000Z",
            total: { cents: 12650, currency: "CAD" },
            shippingMethod: "home",
            fulfilment: "printed",
            refund: "partly_refunded",
            disputed: false,
            items: 3,
            children: [{ id: "c1", displayName: "Ava P." }],
          },
        ],
        nextCursor: ORDER,
      });
      // The reference as typed, cleaned; never a name.
      expect(db.rpc).toHaveBeenCalledWith("studio_orders", {
        p_studio_id: STUDIO,
        p_job_id: null,
        p_statuses: ["printed"],
        p_reference: "7KQ2M9",
        p_delivery: null,
        p_limit: 2,
        p_cursor: null,
      });
    }
  });

  it("narrows to a job of the studio's own, and says another studio's job is not found", async () => {
    const db = signIn("staff", { studio_orders: [] }, { jobs: { id: JOB } });
    expect((await list(`jobId=${JOB}`)).status).toBe(200);
    expect(db.ops).toContainEqual(["jobs", "eq", ["studio_id", STUDIO]]);
    expect(db.rpc.mock.calls[0]?.[1]).toMatchObject({ p_job_id: JOB });
    signIn("owner", {}, { jobs: null });
    expect((await list(`jobId=${JOB}`)).status).toBe(404);
  });

  it("narrows to one delivery (code review N3), and refuses another", async () => {
    const db = signIn("staff", { studio_orders: [] });
    expect((await list("status=printed&delivery=home")).status).toBe(200);
    expect(db.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_statuses: ["printed"],
      p_delivery: "home",
    });
    expect((await list("delivery=drone")).status).toBe(400);
  });

  it("lists Done as shipped, delivered or complete in one call, never with a status (D147)", async () => {
    const db = signIn("staff", { studio_orders: [] });
    expect((await list("stage=done&delivery=school")).status).toBe(200);
    expect(db.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_studio_id: STUDIO,
      p_statuses: ["shipped", "delivered", "complete"],
      p_delivery: "school",
    });
    expect((await list("")).status).toBe(200);
    expect(db.rpc.mock.calls[1]?.[1]).toMatchObject({ p_studio_id: STUDIO, p_statuses: null });
    const both = await list("stage=done&status=paid");
    expect(both.status).toBe(400);
    expect((await both.json()).error.fields).toEqual({ stage: "validation.invalid" });
    expect((await list("stage=waiting")).status).toBe(400);
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });

  it("refuses photographers (Q4), and a search that isn't a reference", async () => {
    signIn("photographer");
    expect((await list()).status).toBe(403);
    signIn("owner");
    const res = await list("q=Ava%20Patel");
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ q: "validation.reference" });
  });
});

describe("GET /orders/:id", () => {
  const get = async () =>
    (await import("./orders/[id]/route")).GET(
      new Request("http://localhost/api/v1/orders/x"),
      ctx(),
    );

  it("gives owners and admins the refunds, what is left and the ledger", async () => {
    signIn("owner", { studio_order: DETAIL });
    const { order } = await (await get()).json();
    expect(order).toMatchObject({
      fulfilment: "shipped",
      tracking: { carrier: "ups", number: "1Z999", url: null },
      refund: "partly_refunded",
      refundInFlight: false,
      feesSettled: true,
      lines: [{ id: LINE, refundedQuantity: 1, physical: true }],
      refunds: [{ id: REFUND, amount: { cents: 1469, currency: "CAD" }, status: "succeeded" }],
      refundable: { products: { cents: 8700, currency: "CAD" } },
    });
    expect(order.ledger).toHaveLength(1);
    expect(order.ledger[0].kind).toBe("order_refunded");
    // The refund's entries balance: refunds, tax, Daybell's share and the studio's share add up to zero.
    expect(order.ledger[0].entries).toEqual([
      { id: 11, account: "refunds", amount: { cents: -1469, currency: "CAD" } },
      { id: 12, account: "tax_payable", amount: { cents: 169, currency: "CAD" } },
      { id: 13, account: "daybell_fees", amount: { cents: 39, currency: "CAD" } },
      { id: 14, account: "studio_payable", amount: { cents: 1261, currency: "CAD" } },
    ]);
    expect(order.tracking.link).toMatch(/^https:\/\/www\.ups\.com\/track\?.*tracknum=1Z999$/);
  });

  it("gives staff the order, totals and fees, but never refunds or the ledger (Q4)", async () => {
    signIn("staff", { studio_order: DETAIL });
    const { order } = await (await get()).json();
    expect(order).toMatchObject({ refunds: null, refundable: null, ledger: null });
    expect(order.daybellFee).toEqual({ basisPoints: 300, amount: { cents: 300, currency: "CAD" } });
    expect(order.refund).toBe("partly_refunded");
  });

  it("says another studio's order is not found, and refuses photographers", async () => {
    signIn("owner", { studio_order: null });
    expect((await get()).status).toBe(404);
    signIn("photographer");
    expect((await get()).status).toBe(403);
  });
});

describe("POST /orders/:id/status (answer 4)", () => {
  const post = async (body: unknown) =>
    (await import("./orders/[id]/status/route")).POST(json("POST", body), ctx());

  it("ships with the carrier and tracking number, acting for the person, and answers the order", async () => {
    signIn("staff", { studio_order: DETAIL });
    const res = await post({ status: "shipped", carrier: "ups", trackingNumber: " 1z999 " });
    expect(res.status).toBe(200);
    expect(writeRpc).toHaveBeenCalledWith("ca", "mark_order_status", USER, {
      p_studio_id: STUDIO,
      p_order_id: ORDER,
      p_status: "shipped",
      p_carrier: "ups",
      p_tracking_number: "1Z999",
      p_tracking_url: null,
    });
    expect((await res.json()).order.fulfilment).toBe("shipped");
  });

  it("marks printed with nothing else", async () => {
    signIn("admin", { studio_order: DETAIL });
    await post({ status: "printed" });
    expect(writeRpc.mock.calls[0]?.[3]).toMatchObject({
      p_status: "printed",
      p_carrier: null,
      p_tracking_number: null,
    });
  });

  it("says why the database refused, by name", async () => {
    for (const [message, form] of [
      ["status_invalid", "orders.statusInvalid"],
      ["wrong_delivery", "orders.wrongDelivery"],
      ["refund_in_flight", "orders.refundInFlight"],
      ["order_canceled", "orders.canceled"],
      ["order_refunded", "orders.refunded"],
      ["tracking_required", "orders.trackingRequired"],
    ]) {
      signIn("staff");
      writeRpc.mockResolvedValueOnce(refusal(message as string));
      const res = await post({ status: "printed" });
      expect(res.status).toBe(409);
      expect((await res.json()).error.fields).toEqual({ form });
    }
    signIn("staff");
    writeRpc.mockResolvedValueOnce(refusal("Order not found", "P0002"));
    expect((await post({ status: "printed" })).status).toBe(404);
  });

  it("refuses photographers before anything is written, and a status that isn't a step", async () => {
    signIn("photographer");
    expect((await post({ status: "printed" })).status).toBe(403);
    signIn("owner");
    expect((await post({ status: "canceled" })).status).toBe(400);
    expect(writeRpc).not.toHaveBeenCalled();
  });
});

describe("tracking, undo and bulk", () => {
  it("corrects tracking (a link only with other carriers)", async () => {
    signIn("staff", { studio_order: DETAIL });
    const patch = async (body: unknown) =>
      (await import("./orders/[id]/tracking/route")).PATCH(json("PATCH", body), ctx());
    expect(
      (
        await patch({
          carrier: "other",
          trackingNumber: "trk-1",
          trackingUrl: "https://t.example/1",
        })
      ).status,
    ).toBe(200);
    expect(writeRpc).toHaveBeenCalledWith("ca", "set_order_tracking", USER, {
      p_studio_id: STUDIO,
      p_order_id: ORDER,
      p_carrier: "other",
      p_tracking_number: "TRK-1",
      p_tracking_url: "https://t.example/1",
    });
    expect(
      (await patch({ carrier: "ups", trackingNumber: "1Z9", trackingUrl: "https://t.example/1" }))
        .status,
    ).toBe(400);
  });

  it("lets owners and admins undo a step with a reason, never staff", async () => {
    const undo = async (body: unknown) =>
      (await import("./orders/[id]/status/undo/route")).POST(json("POST", body), ctx());
    signIn("staff");
    expect((await undo({ reason: "wrong_tracking" })).status).toBe(403);
    signIn("admin", { studio_order: DETAIL });
    expect((await undo({ reason: "wrong_tracking" })).status).toBe(200);
    expect(writeRpc).toHaveBeenCalledWith("ca", "undo_order_status", USER, {
      p_studio_id: STUDIO,
      p_order_id: ORDER,
      p_reason: "wrong_tracking",
    });
  });

  it("lets owners and admins mark a refund made outside Daybell checked, never staff (security review S5)", async () => {
    const checked = async () =>
      (await import("./orders/[id]/external-refund/checked/route")).POST(
        new Request("http://localhost/api/v1/orders/x/external-refund/checked", { method: "POST" }),
        ctx(),
      );
    signIn("staff");
    expect((await checked()).status).toBe(403);
    signIn("owner", {
      studio_order: {
        ...DETAIL,
        external_refund_at: "2026-10-16T12:00:00Z",
        external_refund_checked_at: "2026-10-16T13:00:00Z",
      },
    });
    const res = await checked();
    expect(res.status).toBe(200);
    expect((await res.json()).order.externalRefund).toEqual({
      at: "2026-10-16T12:00:00.000Z",
      checkedAt: "2026-10-16T13:00:00.000Z",
    });
    expect(writeRpc).toHaveBeenCalledWith("ca", "check_external_refund", USER, {
      p_studio_id: STUDIO,
      p_order_id: ORDER,
    });
    writeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "status_invalid" },
    });
    expect((await checked()).status).toBe(409);
  });

  it("refuses fulfilment while a refund made outside Daybell isn't checked", async () => {
    signIn("staff", { studio_order: DETAIL });
    writeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "external_refund" },
    });
    const res = await (await import("./orders/[id]/status/route")).POST(
      json("POST", { status: "printed" }),
      ctx(),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "orders.externalRefund" });
  });

  it("marks orders in bulk, each on its own, and says each one's outcome as a code", async () => {
    signIn("staff");
    writeRpc.mockResolvedValueOnce({
      data: [
        { order_id: ORDER, outcome: "ok" },
        { order_id: REFUND, outcome: "status_invalid" },
        { order_id: LINE, outcome: "not_found" },
      ],
      error: null,
    });
    const res = await (await import("./orders/status/route")).POST(
      json("POST", { orderIds: [ORDER, REFUND, LINE], status: "delivered" }),
    );
    expect(await res.json()).toEqual({
      results: [
        { orderId: ORDER, outcome: "ok" },
        { orderId: REFUND, outcome: "orders.statusInvalid" },
        { orderId: LINE, outcome: "not_found" },
      ],
    });
    expect(writeRpc).toHaveBeenCalledWith("ca", "mark_orders_status", USER, {
      p_studio_id: STUDIO,
      p_order_ids: [ORDER, REFUND, LINE],
      p_status: "delivered",
    });
  });
});

describe("POST /orders/:id/refunds (answer 3)", () => {
  const body = {
    requestId: "b0000000-0000-4000-8000-000000000001",
    kind: "lines",
    lines: [{ lineId: LINE, quantity: 1 }],
    reason: "damaged",
  };
  const post = async (b: unknown = body) =>
    (await import("./orders/[id]/refunds/route")).POST(json("POST", b), ctx());

  it("refuses staff and photographers before anything is written", async () => {
    for (const role of ["staff", "photographer"]) {
      signIn(role);
      expect((await post()).status).toBe(403);
    }
    expect(writeRpc).not.toHaveBeenCalled();
    expect(provider.createRefund).not.toHaveBeenCalled();
  });

  it("asks to try again shortly while Stripe's fee is pending", async () => {
    signIn("owner");
    writeRpc.mockResolvedValueOnce(refusal("fees_pending"));
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.headers.get("retry-after")).toBe("30");
    expect((await res.json()).error.fields).toEqual({ form: "orders.feesPending" });
  });

  it("says more than is left is refused", async () => {
    signIn("admin");
    writeRpc.mockResolvedValueOnce(refusal("over_refund"));
    expect((await (await post()).json()).error.fields).toEqual({ form: "orders.overRefund" });
  });

  it("writes the refund, makes it at Stripe and answers it (201)", async () => {
    signIn("owner", { studio_order: DETAIL });
    writeRpc.mockResolvedValueOnce({ data: { refund_id: REFUND, created: true }, error: null });
    const row = {
      refund_id: REFUND,
      order_id: ORDER,
      kind: "lines",
      reason: "damaged",
      status: "requested",
      amount_cents: 1469,
      daybell_fee_cents: 39,
      reversal_needed_cents: 1430,
      reversal_cents: null,
      stripe_refund_id: null,
      payment_intent_id: "pi_1",
      transfer_id: "tr_1",
    };
    systemRpc.mockImplementation(async (_region: string, fn: string) => {
      if (fn === "refund_for_stripe") return { data: row, error: null };
      if (fn === "refund_accepted") {
        row.status = "succeeded";
        return { data: "succeeded", error: null };
      }
      if (fn === "refund_recovered") {
        (row as Record<string, unknown>).reversal_cents = 1430;
        return { data: 0, error: null };
      }
      return { data: null, error: null };
    });
    provider.createRefund.mockResolvedValue({
      id: "re_1",
      status: "succeeded",
      amountCents: 1469,
      currency: "cad",
      paymentIntentId: "pi_1",
      refundId: REFUND,
      orderId: ORDER,
      region: "ca",
      failureReason: null,
    });
    provider.transferRemaining.mockResolvedValue({ remainingCents: 9000, currency: "cad" });
    provider.reverseForRefund.mockResolvedValue({ reversalId: "trr_1", amountCents: 1430 });
    const res = await post();
    expect(res.status).toBe(201);
    expect((await res.json()).refund).toMatchObject({ id: REFUND, status: "succeeded" });
    expect(provider.createRefund.mock.calls[0]?.[0]).toMatchObject({
      amountCents: 1469,
      refundId: REFUND,
      reason: null,
    });
  });

  it("isn't offered where payouts aren't (US studios)", async () => {
    signIn("owner", {}, {}, "us");
    expect((await post()).status).toBe(422);
  });
});

describe("GET /studio/sales (D127; Q4)", () => {
  const sales = async (tz = "America/Toronto") =>
    (await import("./studio/sales/route")).GET(
      new Request(`http://localhost/api/v1/studio/sales?tz=${encodeURIComponent(tz)}`),
    );
  const range = (start: string, cents: number, orders: number) => ({
    start,
    sales_cents: cents,
    orders,
    daybell_fee_cents: 300,
  });
  const SALES = {
    currency: "CAD",
    ranges: {
      today: range("2026-10-13T04:00:00+00:00", 0, 0),
      week: range("2026-10-12T04:00:00+00:00", 25_301, 2),
      season: range("2026-08-01T04:00:00+00:00", 25_301, 2),
    },
  };
  const TODO = { to_print: 2, to_ship: 1, to_deliver: 0 };

  it("gives owners and admins the numbers and To do", async () => {
    const db = signIn("admin", { studio_sales: SALES, studio_order_todo: TODO });
    const body = await (await sales()).json();
    expect(body.sales.week).toEqual({
      start: "2026-10-12T04:00:00.000Z",
      sales: { cents: 25_301, currency: "CAD" },
      orders: 2,
      daybellFee: { cents: 300, currency: "CAD" },
      averageOrder: { cents: 12_651, currency: "CAD" },
    });
    expect(body.sales.today.averageOrder).toBeNull();
    expect(body.todo).toEqual({ toPrint: 2, toShip: 1, toDeliver: 0 });
    expect(db.rpc).toHaveBeenCalledWith("studio_sales", {
      p_studio_id: STUDIO,
      p_tz: "America/Toronto",
    });
  });

  it("gives staff To do only, never asking for the money (Q4)", async () => {
    const db = signIn("staff", { studio_sales: SALES, studio_order_todo: TODO });
    const body = await (await sales()).json();
    expect(body.sales).toBeNull();
    expect(body.todo.toPrint).toBe(2);
    expect(db.rpc.mock.calls.map((c) => c[0])).toEqual(["studio_order_todo"]);
  });

  it("refuses photographers, and a time zone the database doesn't know", async () => {
    signIn("photographer");
    expect((await sales()).status).toBe(403);
    signIn("owner", {
      studio_sales: { data: null, error: { code: "22023", message: "A time zone" } },
      studio_order_todo: TODO,
    });
    expect((await sales("Mars/Olympus")).status).toBe(400);
    signIn("owner");
    expect((await sales("'; drop")).status).toBe(400);
  });
});

describe("GET /orders/:id/print-files", () => {
  it("is the studio's fulfilment's, never a photographer's", async () => {
    const get = async () =>
      (await import("./orders/[id]/print-files/route")).GET(
        new Request("http://localhost/api/v1/orders/x/print-files"),
        ctx(),
      );
    signIn("photographer");
    expect((await get()).status).toBe(403);
    expect(zips.printFiles).not.toHaveBeenCalled();
    signIn("staff");
    zips.printFiles.mockResolvedValue(new Response("zip", { status: 200 }));
    expect((await get()).status).toBe(200);
    expect(zips.printFiles).toHaveBeenCalledWith(
      "ca",
      USER,
      STUDIO,
      ORDER,
      expect.any(AbortSignal),
    );
  });
});
