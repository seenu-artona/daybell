import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The studio's side of checkout (ADR 0023): Settings › Taxes is read by owners and admins and changed by the owner only
// (call 6), Stripe first and then the database, never for a studio without payouts, never with the registration
// number in a key or a log, and checked before Stripe is asked for anything it would refuse. Every query names the
// studio. The studio's order routes are tested in orders-routes.test.ts (ADR 0024).
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
    expect(key).toBe(`daybell-taxreg-${STUDIO}-pst-BC-1`);
    expect(key).not.toContain("1234");
    expect(taxRpc).toHaveBeenCalledWith("ca", "add_tax_registration", "user-1", {
      p_studio_id: STUDIO,
      p_kind: "pst",
      p_province: "BC",
      p_number: "PST-1234-5678",
      p_stripe_registration_id: "taxreg_1",
    });
  });

  it("re-adds a registration ended earlier with a new key, so Stripe makes a new one (code review S2)", async () => {
    const add = async (body: unknown) =>
      (await import("./studio/taxes/registrations/route")).POST(json("POST", body));
    // The active list has none; the studio's earlier ones hold an ended GST/HST registration.
    signIn("owner", {
      ...TAXES,
      studio_tax_registrations: (n: number) =>
        n === 1 ? [{ id: REG, kind: "gst_hst", province: null }] : [],
    });
    provider.createTaxRegistration.mockResolvedValueOnce({ id: "taxreg_2" });
    const res = await add({ kind: "gst_hst", number: "123456789RT0001" });
    expect(res.status).toBe(201);
    const key = provider.createTaxRegistration.mock.calls[0]?.[2];
    expect(key).toBe(`daybell-taxreg-${STUDIO}-gst_hst-ca-2`);
    expect(key).not.toMatch(/123456789|[0-9a-f]{24}/);
    expect(taxRpc).toHaveBeenCalledWith(
      "ca",
      "add_tax_registration",
      "user-1",
      expect.objectContaining({ p_stripe_registration_id: "taxreg_2" }),
    );
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
