import { ApiError } from "@daybell/api";
import { afterEach, describe, expect, it, vi } from "vitest";

// Job › Shop routes (D157; ADR 0033): the person and their role are checked before the body (photographers and staff
// are refused writes and the database is never asked); everyone on the team reads; every query names the caller's
// studio; another studio's or another job's ids are simply not found (row-level security, faked here) and nothing is
// written; money leaves as whole cents with the list's currency; the database's named errors become named 409s; and
// nothing is logged.
vi.mock("server-only", () => ({}));
const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "3e9caf4b-5d0a-4f88-8a3b-6c4d5e6f7081";
const LIST = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const ITEM = "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f";
const OWN = "2d8b9e3a-4c9f-4e77-9f2a-5b3c4d5e6f70";
const as = (role: string) => ({ id: STUDIO, name: "North Peak", slug: "np", region: "ca", role });
// Next passes only the segments in the path; itemId is left out for routes without one.
const ctx = (id: string, itemId?: string) =>
  ({ params: Promise.resolve(itemId === undefined ? { id } : { id, itemId }) }) as {
    params: Promise<{ id: string; itemId: string }>;
  };

type Answer = { data?: unknown; error?: { code: string; message?: string } | null };
type Call = { name: string; ops: [string, unknown[]][]; args?: unknown };

/** A stand-in for the Supabase client: each table or function answers with `answers[name]`; every call is recorded. */
function fakeDatabase(answers: Record<string, unknown | ((call: Call) => Answer)>) {
  const calls: Call[] = [];
  const respond = (call: Call) => {
    const a = answers[call.name];
    const out: Answer = typeof a === "function" ? (a as (c: Call) => Answer)(call) : { data: a };
    return { data: out.data ?? null, error: out.error ?? null };
  };
  const chain = (call: Call): object =>
    new Proxy(
      {},
      {
        get: (_t, prop: string) =>
          prop === "then"
            ? (resolve: (v: unknown) => void) => resolve(respond(call))
            : (...args: unknown[]) => {
                call.ops.push([prop, args]);
                return chain(call);
              },
      },
    );
  const from = (name: string) => {
    const call: Call = { name, ops: [] };
    calls.push(call);
    return chain(call);
  };
  const rpc = (name: string, args: unknown) => {
    const call: Call = { name, ops: [], args };
    calls.push(call);
    return chain(call);
  };
  return { supabase: { from, rpc }, calls };
}
const has = (call: Call | undefined, op: string, ...args: unknown[]) =>
  call?.ops.some(([o, a]) => o === op && JSON.stringify(a) === JSON.stringify(args)) ?? false;

const SHOP_DB = {
  job_id: JOB,
  price_list: {
    id: LIST,
    name: "Starter price list",
    currency: "CAD",
    home_shipping_cents: "1195",
  },
  rows: [
    {
      item_id: ITEM,
      source: "list",
      kind: "package",
      name: "Package A",
      description: null,
      print_size: null,
      contents: [
        { kind: "print", print_size: "8x10", quantity: 1 },
        { kind: "digital", print_size: null, quantity: 1 },
      ],
      list_price_cents: "8500",
      price_cents: "7000",
      sold: true,
      changed: true,
    },
    {
      item_id: OWN,
      source: "job",
      kind: "print",
      name: "Panorama",
      description: null,
      print_size: "11x14",
      contents: [],
      list_price_cents: null,
      price_cents: 4500,
      sold: false,
      changed: true,
    },
  ],
  changes: 2,
};
const SHOP = {
  jobId: JOB,
  priceList: {
    id: LIST,
    name: "Starter price list",
    homeShipping: { cents: 1195, currency: "CAD" },
  },
  rows: [
    {
      itemId: ITEM,
      source: "list",
      kind: "package",
      name: "Package A",
      description: null,
      printSize: null,
      contents: [
        { kind: "print", printSize: "8x10", quantity: 1 },
        { kind: "digital", printSize: null, quantity: 1 },
      ],
      listPrice: { cents: 8500, currency: "CAD" },
      price: { cents: 7000, currency: "CAD" },
      sold: true,
      changed: true,
    },
    {
      itemId: OWN,
      source: "job",
      kind: "print",
      name: "Panorama",
      description: null,
      printSize: "11x14",
      contents: [],
      listPrice: null,
      price: { cents: 4500, currency: "CAD" },
      sold: false,
      changed: true,
    },
  ],
  changes: 2,
};

/** A database where the job, the list item and the job's product are the studio's own. */
const ownDatabase = (extra: Record<string, unknown | ((call: Call) => Answer)> = {}) =>
  fakeDatabase({
    jobs: [{ id: JOB }],
    price_list_items: [{ id: ITEM }],
    job_shop_items: { kind: "print" },
    job_shop: SHOP_DB,
    set_job_price: null,
    reset_job_price: null,
    save_job_item: OWN,
    delete_job_item: null,
    ...extra,
  });

const send = (method: string, body?: unknown, raw?: string) =>
  new Request("http://localhost/api/v1/x", {
    method,
    headers: { "content-type": "application/json" },
    body: raw ?? (body === undefined ? null : JSON.stringify(body)),
  });

type Route = (
  request: Request,
  ctx: { params: Promise<{ id: string; itemId?: string }> },
) => Promise<Response>;
const routes = {
  shop: async () => (await import("./jobs/[id]/shop/route")).GET as unknown as Route,
  price: async () => await import("./jobs/[id]/shop/prices/[itemId]/route"),
  items: async () => (await import("./jobs/[id]/shop/items/route")).POST as unknown as Route,
  item: async () => await import("./jobs/[id]/shop/items/[itemId]/route"),
};

let log: ReturnType<typeof vi.spyOn>[] = [];
afterEach(() => {
  scope.mockReset();
  for (const spy of log) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
  log = [];
});
const watchLogs = () => {
  log = (["log", "info", "warn", "error"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
};

const WRITES: [string, () => Promise<Route>, string, string | undefined][] = [
  ["PATCH a price", async () => (await routes.price()).PATCH as unknown as Route, "PATCH", ITEM],
  ["DELETE a price", async () => (await routes.price()).DELETE as unknown as Route, "DELETE", ITEM],
  ["POST a product", routes.items, "POST", undefined],
  ["PATCH a product", async () => (await routes.item()).PATCH as unknown as Route, "PATCH", OWN],
  ["DELETE a product", async () => (await routes.item()).DELETE as unknown as Route, "DELETE", OWN],
];

describe("Job › Shop writes check the person before the body (ADR 0019 answer 8)", () => {
  for (const [name, load, method, itemId] of WRITES) {
    const garbled = () => send(method, undefined, method === "DELETE" ? undefined : "{ not json");

    it(`${name}: signed-out people get not_signed_in, even with a broken body`, async () => {
      scope.mockRejectedValue(new ApiError("not_signed_in", "Please sign in."));
      const res = await (await load())(garbled(), ctx(JOB, itemId));
      expect(res.status).toBe(401);
    });

    for (const role of ["photographer", "staff"])
      it(`${name}: ${role}s get forbidden, even with a broken body, and nothing is read`, async () => {
        const db = fakeDatabase({});
        scope.mockResolvedValue({ supabase: db.supabase, studio: as(role), userId: "u" });
        const res = await (await load())(garbled(), ctx(JOB, itemId));
        expect(res.status).toBe(403);
        expect(db.calls).toEqual([]);
      });

    it(`${name}: a path id that isn't a UUID is not found, before anything else`, async () => {
      const res = await (await load())(send(method, {}), ctx("not-a-uuid", itemId));
      expect(res.status).toBe(404);
      expect(scope).not.toHaveBeenCalled();
      if (itemId) {
        const bad = await (await load())(send(method, {}), ctx(JOB, "12"));
        expect(bad.status).toBe(404);
      }
    });
  }
});

describe("GET /jobs/:id/shop", () => {
  it("everyone on the team reads it, in whole cents with the list's currency (N10)", async () => {
    watchLogs();
    for (const role of ["owner", "photographer", "staff"]) {
      const db = ownDatabase();
      scope.mockResolvedValue({ supabase: db.supabase, studio: as(role), userId: "u" });
      const res = await (await routes.shop())(send("GET"), ctx(JOB));
      expect(res.status).toBe(200);
      expect((await res.json()).shop).toEqual(SHOP);
      expect(db.calls[0]?.args).toEqual({ p_studio_id: STUDIO, p_job_id: JOB });
    }
  });

  it("another studio's job, or one that doesn't exist, is not found", async () => {
    const db = ownDatabase({
      job_shop: () => ({ error: { code: "P0002", message: "not_found" } }),
    });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.shop())(send("GET"), ctx(JOB));
    expect(res.status).toBe(404);
  });
});

describe("PATCH and DELETE /jobs/:id/shop/prices/:itemId", () => {
  it("sets this job's price in whole cents and answers with the shop", async () => {
    watchLogs();
    const db = ownDatabase();
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("admin"), userId: "u" });
    const res = await (await routes.price()).PATCH(
      send("PATCH", { priceCents: 7000 }),
      ctx(JOB, ITEM),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).shop).toEqual(SHOP);
    const jobs = db.calls.find((c) => c.name === "jobs");
    expect(has(jobs, "eq", "studio_id", STUDIO) && has(jobs, "eq", "id", JOB)).toBe(true);
    const items = db.calls.find((c) => c.name === "price_list_items");
    expect(has(items, "eq", "studio_id", STUDIO) && has(items, "eq", "id", ITEM)).toBe(true);
    expect(db.calls.find((c) => c.name === "set_job_price")?.args).toEqual({
      p_job_id: JOB,
      p_item_id: ITEM,
      p_price_cents: 7000,
      p_sold: null,
    });
  });

  it("switches an item off without touching its price", async () => {
    const db = ownDatabase();
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    await (await routes.price()).PATCH(send("PATCH", { sold: false }), ctx(JOB, ITEM));
    expect(db.calls.find((c) => c.name === "set_job_price")?.args).toMatchObject({
      p_price_cents: null,
      p_sold: false,
    });
  });

  it("refuses a fraction of a cent, a string or a currency (D96)", async () => {
    for (const body of [
      { priceCents: 70.5 },
      { priceCents: "7000" },
      { priceCents: 7000, currency: "USD" },
      {},
    ]) {
      const db = ownDatabase();
      scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
      const res = await (await routes.price()).PATCH(send("PATCH", body), ctx(JOB, ITEM));
      expect(res.status).toBe(400);
      expect(db.calls.some((c) => c.name === "set_job_price")).toBe(false);
    }
  });

  it("another studio's job or item is not found, and nothing is written (leak)", async () => {
    for (const [table, missing] of [
      ["jobs", "Job not found."],
      ["price_list_items", "Item not found."],
    ] as const) {
      const db = ownDatabase({ [table]: [] });
      scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
      const res = await (await routes.price()).PATCH(
        send("PATCH", { priceCents: 1 }),
        ctx(JOB, ITEM),
      );
      expect(res.status).toBe(404);
      expect((await res.json()).error.message).toBe(missing);
      expect(db.calls.some((c) => c.name === "set_job_price" || c.name === "job_shop")).toBe(false);
    }
  });

  it("a closed job and an item no longer on the job's list are named 409s", async () => {
    for (const [message, form] of [
      ["job_closed", "jobShop.jobClosed"],
      ["not_on_list", "jobShop.notOnList"],
    ]) {
      const db = ownDatabase({ set_job_price: () => ({ error: { code: "P0001", message } }) });
      scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
      const res = await (await routes.price()).PATCH(
        send("PATCH", { priceCents: 1 }),
        ctx(JOB, ITEM),
      );
      expect(res.status).toBe(409);
      expect((await res.json()).error.fields.form).toBe(form);
    }
  });

  it("Undo resets the item and answers with the shop", async () => {
    const db = ownDatabase();
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.price()).DELETE(send("DELETE"), ctx(JOB, ITEM));
    expect(res.status).toBe(200);
    expect(db.calls.find((c) => c.name === "reset_job_price")?.args).toEqual({
      p_job_id: JOB,
      p_item_id: ITEM,
    });
  });
});

describe("POST /jobs/:id/shop/items and PATCH/DELETE /jobs/:id/shop/items/:itemId", () => {
  const panorama = { kind: "print", name: "Panorama", priceCents: 4500, printSize: "11x14" };

  it("adds a print only this job sells (201) in the database's columns", async () => {
    watchLogs();
    const db = ownDatabase();
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.items())(send("POST", panorama), ctx(JOB));
    expect(res.status).toBe(201);
    expect(db.calls.find((c) => c.name === "save_job_item")?.args).toEqual({
      p_job_id: JOB,
      p_item_id: null,
      p_item: { kind: "print", name: "Panorama", price_cents: 4500, print_size: "11x14" },
      p_lines: null,
    });
  });

  it("adds a package with its contents", async () => {
    const db = ownDatabase();
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.items())(
      send("POST", {
        kind: "package",
        name: "Sibling package",
        priceCents: 9900,
        contents: [{ kind: "print", printSize: "8x10", quantity: 1 }, { kind: "digital" }],
      }),
      ctx(JOB),
    );
    expect(res.status).toBe(201);
    expect(
      (db.calls.find((c) => c.name === "save_job_item")?.args as { p_lines: unknown } | undefined)
        ?.p_lines,
    ).toEqual([
      { kind: "print", print_size: "8x10", quantity: 1 },
      { kind: "digital", print_size: null, quantity: 1 },
    ]);
  });

  it("refuses downloads (B2): they stay one per list", async () => {
    const db = ownDatabase();
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.items())(
      send("POST", { kind: "digital_single", name: "Download", priceCents: 100 }),
      ctx(JOB),
    );
    expect(res.status).toBe(400);
    expect(db.calls).toEqual([]);
  });

  it("the 101st product and a closed job are named 409s", async () => {
    for (const [message, form] of [
      ["item_limit", "jobShop.itemLimit"],
      ["job_closed", "jobShop.jobClosed"],
    ]) {
      const db = ownDatabase({ save_job_item: () => ({ error: { code: "P0001", message } }) });
      scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
      const res = await (await routes.items())(send("POST", panorama), ctx(JOB));
      expect(res.status).toBe(409);
      expect((await res.json()).error.fields.form).toBe(form);
    }
  });

  it("another studio's job takes no product (leak)", async () => {
    const db = ownDatabase({ jobs: [] });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.items())(send("POST", panorama), ctx(JOB));
    expect(res.status).toBe(404);
    expect(db.calls.some((c) => c.name === "save_job_item")).toBe(false);
  });

  it("switches a product off or changes it in place, by the job's and studio's ids", async () => {
    const db = ownDatabase();
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.item()).PATCH(send("PATCH", { sold: false }), ctx(JOB, OWN));
    expect(res.status).toBe(200);
    const items = db.calls.find((c) => c.name === "job_shop_items");
    expect(
      has(items, "eq", "studio_id", STUDIO) &&
        has(items, "eq", "job_id", JOB) &&
        has(items, "eq", "id", OWN),
    ).toBe(true);
    expect(db.calls.find((c) => c.name === "save_job_item")?.args).toEqual({
      p_job_id: JOB,
      p_item_id: OWN,
      p_item: { sold: false },
      p_lines: null,
    });
  });

  it("a print never gets contents, a package never a size", async () => {
    const db = ownDatabase();
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.item()).PATCH(
      send("PATCH", { contents: [{ kind: "digital" }] }),
      ctx(JOB, OWN),
    );
    expect(res.status).toBe(400);
    expect(db.calls.some((c) => c.name === "save_job_item")).toBe(false);
  });

  it("another job's product is not found, and nothing changes (leak)", async () => {
    for (const method of ["PATCH", "DELETE"] as const) {
      const db = ownDatabase({ job_shop_items: null });
      scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
      const route = (await routes.item())[method] as unknown as Route;
      const res = await route(
        send(method, method === "PATCH" ? { sold: false } : undefined),
        ctx(JOB, OWN),
      );
      expect(res.status).toBe(404);
      expect(db.calls.some((c) => c.name === "save_job_item" || c.name === "delete_job_item")).toBe(
        false,
      );
    }
  });

  it("removes a product and answers with the shop", async () => {
    const db = ownDatabase();
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("admin"), userId: "u" });
    const res = await (await routes.item()).DELETE(send("DELETE"), ctx(JOB, OWN));
    expect(res.status).toBe(200);
    expect(db.calls.find((c) => c.name === "delete_job_item")?.args).toEqual({
      p_job_id: JOB,
      p_item_id: OWN,
    });
  });
});
