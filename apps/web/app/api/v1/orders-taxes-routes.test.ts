import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The studio's side of checkout (ADR 0023): owners and admins read a job's paid orders with every fee (call 15; D98),
// photographers and staff don't; Settings › Taxes is read by owners and admins and changed by the owner only (call 6),
// Stripe first and then the database, never for a studio without payouts, never with the registration number in a
// key or a log, and checked before Stripe is asked for anything it would refuse. Every query names the studio.
vi.mock("server-only", () => ({}));
const { scope, taxRpc, budgetRpc, provider } = vi.hoisted(() => ({
  scope: vi.fn(),
  taxRpc: vi.fn(),
  budgetRpc: vi.fn(),
  provider: {
    driver: "stripe",
    livemode: false,
    setTaxHeadOffice: vi.fn(),
    createTaxRegistration: vi.fn(),
    expireTaxRegistration: vi.fn(),
  },
}));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));
vi.mock("@/lib/supabase/service", () => ({ taxWriteRpc: taxRpc, payoutSystemRpc: budgetRpc }));
vi.mock("@/lib/stripe", async (original) => ({
  ...(await original<typeof import("@/lib/stripe")>()),
  payments: () => provider,
}));

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "a0000000-0000-4000-8000-000000000001";
const ORDER = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
const REG = "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e";

type Call = { table: string; ops: [string, unknown[]][] };
/**
 * A stand-in Supabase client: tables answer from `rows` (a function answers by how many times the table was read
 * before), functions from `rpcs`; every call is recorded.
 */
function fakeDatabase(rows: Record<string, unknown>, rpcs: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    const before = calls.filter((c) => c.table === table).length;
    calls.push(call);
    const answer = rows[table];
    const data = typeof answer === "function" ? (answer as (n: number) => unknown)(before) : answer;
    const chain: object = new Proxy(
      {},
      {
        get: (_t, prop: string) =>
          prop === "then"
            ? (resolve: (v: unknown) => void) => resolve({ data: data ?? null, error: null })
            : (...args: unknown[]) => {
                call.ops.push([prop, args]);
                return chain;
              },
      },
    );
    return chain;
  };
  const rpc = vi.fn(async (fn: string) => ({ data: rpcs[fn] ?? null, error: null }));
  return { supabase: { from, rpc }, calls, rpc };
}
function signIn(
  role: string,
  rows: Record<string, unknown> = {},
  rpcs: Record<string, unknown> = {},
  region = "ca",
) {
  const db = fakeDatabase(rows, rpcs);
  scope.mockResolvedValue({
    supabase: db.supabase,
    studio: { id: STUDIO, name: "Maple Lane", slug: "maple", region, role },
    userId: "user-1",
  });
  return db;
}

const ORDER_ROW = {
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
  shipping_method: "home",
  items: 3,
  children: [{ id: "c1", first_name: "Ava", last_name: "Patel" }],
};

const json = (method: string, body?: unknown) =>
  new Request("http://localhost/api/v1/x", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  vi.stubEnv("VERCEL_REGION", "");
  budgetRpc.mockResolvedValue({ data: true, error: null });
  taxRpc.mockResolvedValue({ data: null, error: null });
  provider.setTaxHeadOffice.mockResolvedValue(undefined);
  provider.createTaxRegistration.mockResolvedValue({ id: "taxreg_1" });
  provider.expireTaxRegistration.mockResolvedValue(undefined);
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

describe("GET /orders?jobId= (call 15)", () => {
  const list = async (query: string) =>
    (await import("./orders/route")).GET(new Request(`http://localhost/api/v1/orders?${query}`));

  it("gives owners and admins a job's paid orders with tax, Daybell's fee and rate, the card fee and their share", async () => {
    for (const role of ["owner", "admin"]) {
      const db = signIn(
        role,
        { jobs: { id: JOB } },
        { job_orders: [ORDER_ROW, { ...ORDER_ROW, id: "x" }] },
      );
      const res = await list(`jobId=${JOB}&limit=1`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.orders).toEqual([
        {
          id: ORDER,
          reference: "7KQ2M9XA",
          paidAt: "2026-10-13T12:00:00.000Z",
          products: { cents: 10000, currency: "CAD" },
          shipping: { cents: 1195, currency: "CAD" },
          tax: { cents: 1455, currency: "CAD" },
          total: { cents: 12650, currency: "CAD" },
          daybellFee: { basisPoints: 300, amount: { cents: 300, currency: "CAD" } },
          cardFee: { cents: 397, currency: "CAD" },
          paidToStudio: { cents: 12650 - 300 - 397, currency: "CAD" },
          shippingMethod: "home",
          items: 3,
          children: [{ id: "c1", firstName: "Ava", lastName: "Patel" }],
        },
      ]);
      expect(body.nextCursor).toBe(ORDER);
      expect(db.rpc).toHaveBeenCalledWith("job_orders", {
        p_studio_id: STUDIO,
        p_job_id: JOB,
        p_limit: 2,
        p_cursor: null,
      });
      expect(db.calls[0]?.ops).toContainEqual(["eq", ["studio_id", STUDIO]]);
    }
  });

  it("shows the card fee as pending until Stripe says", async () => {
    signIn(
      "owner",
      { jobs: { id: JOB } },
      { job_orders: [{ ...ORDER_ROW, stripe_fee_cents: null }] },
    );
    const { orders } = await (await list(`jobId=${JOB}`)).json();
    expect(orders[0]).toMatchObject({ cardFee: null, paidToStudio: null });
  });

  it("refuses photographers and staff, and another studio's job is not found", async () => {
    for (const role of ["photographer", "staff"]) {
      signIn(role);
      expect((await list(`jobId=${JOB}`)).status).toBe(403);
    }
    signIn("owner", { jobs: null });
    expect((await list(`jobId=${JOB}`)).status).toBe(404);
    signIn("owner");
    expect((await list("jobId=nope")).status).toBe(400);
  });
});

describe("GET /orders/:id", () => {
  const get = async (id = ORDER) =>
    (await import("./orders/[id]/route")).GET(new Request("http://localhost/api/v1/orders/x"), {
      params: Promise.resolve({ id }),
    });

  it("shows the lines with the children's names and, for home delivery, where it ships", async () => {
    signIn(
      "owner",
      {},
      {
        studio_order: {
          ...ORDER_ROW,
          lines: [
            {
              id: "l1",
              kind: "package",
              name: "Package A",
              print_size: null,
              quantity: 1,
              unit_price_cents: 10000,
              line_total_cents: 10000,
              photo_id: null,
              child: { id: "c1", first_name: "Ava", last_name: "Patel" },
              contents: [{ kind: "print", print_size: "8x10", quantity: 1 }],
            },
          ],
          ship_to: {
            name: "Priya Patel",
            line1: "12 Maple Lane",
            line2: null,
            city: "Toronto",
            province: "ON",
            postal_code: "M5V 2T6",
            country: "CA",
          },
        },
      },
    );
    const { order } = await (await get()).json();
    expect(order.lines[0]).toMatchObject({
      child: { firstName: "Ava" },
      contents: [{ printSize: "8x10" }],
    });
    expect(order.shipTo).toMatchObject({ name: "Priya Patel", postalCode: "M5V 2T6" });
  });

  it("is not found for another studio's order or a malformed id", async () => {
    signIn("owner", {}, { studio_order: null });
    expect((await get()).status).toBe(404);
    expect((await get("nope")).status).toBe(404);
  });
});

describe("Settings › Taxes (answer 2; calls 3, 6)", () => {
  const TAXES = {
    studio_tax_settings: { head_office_province: "ON", head_office_set_at: "2026-10-13T12:00:00Z" },
    studio_tax_registrations: [
      {
        id: REG,
        kind: "gst_hst",
        province: null,
        number: "123456789RT0001",
        created_at: "2026-10-13T12:00:00Z",
      },
    ],
    payout_accounts: { id: "row-1", stripe_account_id: "acct_A1" },
  };
  const ADDRESS = { line1: "12 Maple Lane", city: "Toronto", province: "ON", postalCode: "m5v2t6" };

  it("is read by owners and admins, never photographers or staff, and only where payouts exist", async () => {
    const taxes = async () => (await import("./studio/taxes/route")).GET();
    signIn("admin", TAXES);
    const body = await (await taxes()).json();
    expect(body).toEqual({
      headOffice: { province: "ON", setAt: "2026-10-13T12:00:00.000Z" },
      registrations: [
        {
          id: REG,
          kind: "gst_hst",
          province: null,
          number: "123456789RT0001",
          createdAt: "2026-10-13T12:00:00.000Z",
        },
      ],
      collectsTax: true,
      canManage: false,
    });
    for (const role of ["photographer", "staff"]) {
      signIn(role, TAXES);
      expect((await taxes()).status).toBe(403);
    }
    signIn("owner", TAXES, {}, "us");
    expect((await taxes()).status).toBe(422);
  });

  it("sets the head office at Stripe first, then keeps its province (the owner only)", async () => {
    const put = async (body: unknown) =>
      (await import("./studio/taxes/head-office/route")).PUT(json("PUT", body));
    signIn("admin", TAXES);
    expect((await put(ADDRESS)).status).toBe(403);
    signIn("owner", { ...TAXES, payout_accounts: null });
    const notConnected = await put(ADDRESS);
    expect(notConnected.status).toBe(409);
    expect((await notConnected.json()).error.fields).toEqual({ form: "taxes.notConnected" });
    signIn("owner", TAXES);
    expect((await put({ ...ADDRESS, postalCode: "12345" })).status).toBe(400);
    expect(provider.setTaxHeadOffice).not.toHaveBeenCalled();
    expect((await put(ADDRESS)).status).toBe(200);
    expect(provider.setTaxHeadOffice).toHaveBeenCalledWith("acct_A1", {
      line1: "12 Maple Lane",
      line2: null,
      city: "Toronto",
      province: "ON",
      postalCode: "M5V 2T6",
    });
    expect(taxRpc).toHaveBeenCalledWith("ca", "set_tax_head_office", "user-1", {
      p_studio_id: STUDIO,
      p_province: "ON",
    });
    expect(provider.setTaxHeadOffice.mock.invocationCallOrder[0]).toBeLessThan(
      taxRpc.mock.invocationCallOrder[0] as number,
    );
    // The address never goes to the database.
    expect(JSON.stringify(taxRpc.mock.calls)).not.toContain("Maple Lane");
  });

  it("adds a registration at Stripe first, with a key that holds no number, and refuses what Stripe would", async () => {
    const add = async (body: unknown) =>
      (await import("./studio/taxes/registrations/route")).POST(json("POST", body));
    signIn("owner", { ...TAXES, studio_tax_settings: null, studio_tax_registrations: [] });
    expect(
      (await (await add({ kind: "gst_hst", number: "123456789RT0001" })).json()).error.fields,
    ).toEqual({
      form: "taxes.headOfficeRequired",
    });
    signIn("owner", TAXES);
    expect(
      (await (await add({ kind: "gst_hst", number: "987654321RT0001" })).json()).error.fields,
    ).toEqual({
      form: "taxes.alreadyRegistered",
    });
    expect(provider.createTaxRegistration).not.toHaveBeenCalled();
    const res = await add({ kind: "pst", province: "BC", number: "pst-1234-5678" });
    expect(res.status).toBe(201);
    const [account, registration, key] = provider.createTaxRegistration.mock.calls[0] ?? [];
    expect([account, registration]).toEqual(["acct_A1", { kind: "pst", province: "BC" }]);
    expect(key).toMatch(new RegExp(`^daybell-taxreg-${STUDIO}-pst-BC-[0-9a-f]{24}$`));
    expect(key).not.toContain("1234");
    expect(taxRpc).toHaveBeenCalledWith("ca", "add_tax_registration", "user-1", {
      p_studio_id: STUDIO,
      p_kind: "pst",
      p_province: "BC",
      p_number: "PST-1234-5678",
      p_stripe_registration_id: "taxreg_1",
    });
  });

  it("ends a registration at Stripe first; another studio's is not found before Stripe is asked", async () => {
    const del = async (id = REG) =>
      (await import("./studio/taxes/registrations/[id]/route")).DELETE(json("DELETE"), {
        params: Promise.resolve({ id }),
      });
    signIn("owner", { ...TAXES, studio_tax_registrations: null });
    expect((await del()).status).toBe(404);
    expect(provider.expireTaxRegistration).not.toHaveBeenCalled();
    signIn("owner", {
      ...TAXES,
      // The registration to end, then the list once it has ended.
      studio_tax_registrations: (n: number) =>
        n === 0 ? { id: REG, stripe_registration_id: "taxreg_1" } : [],
    });
    expect((await del()).status).toBe(200);
    expect(provider.expireTaxRegistration).toHaveBeenCalledWith("acct_A1", "taxreg_1");
    expect(taxRpc).toHaveBeenCalledWith("ca", "end_tax_registration", "user-1", {
      p_studio_id: STUDIO,
      p_id: REG,
    });
  });
});
