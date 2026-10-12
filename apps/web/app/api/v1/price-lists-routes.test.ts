import { ApiError } from "@daybell/api";
import { afterEach, describe, expect, it, vi } from "vitest";

// Price list routes (ADR 0019): the person and their role are checked before the body (photographers and staff are
// refused, answer 8); every query names the caller's studio; another studio's lists and items are simply not found
// (row-level security, faked here); money leaves as whole cents with the list's currency; the database's named
// errors become named 409s; a job can't be given another studio's list or have a closed job's list changed.
vi.mock("server-only", () => ({}));
const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LIST = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const ITEM = "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f";
const OTHER = "2d8b9e3a-4c9f-4e77-9f2a-5b3c4d5e6f70";
const JOB = "3e9caf4b-5d0a-4f88-8a3b-6c4d5e6f7081";
const as = (role: string) => ({ id: STUDIO, name: "North Peak", slug: "np", region: "us", role });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

type Answer = { data?: unknown; error?: { code: string; message?: string } | null };
type Call = { name: string; ops: [string, unknown[]][]; args?: unknown };

/**
 * A stand-in for the Supabase client. Each table or function answers with `answers[name]`: a value, or a function of
 * the call's operations (so the same table can answer a read and a write differently). Every call is recorded.
 */
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
const isWrite = (c: Call) => c.ops.some(([op]) => ["insert", "update", "delete"].includes(op));

const LIST_ROW = {
  id: LIST,
  name: "Starter price list",
  currency: "CAD",
  home_shipping_cents: "1195",
  created_at: "2026-10-12T00:00:00Z",
  updated_at: "2026-10-12T00:00:00Z",
};
const SUMMARY = {
  id: LIST,
  name: "Starter price list",
  currency: "CAD",
  is_default: false,
  packages: 1,
  prints: 1,
  digitals: 0,
  jobs: 0,
  selling_jobs: 0,
  updated_at: "2026-10-12T00:00:00Z",
};
const PACKAGE_ROW = {
  id: ITEM,
  price_list_id: LIST,
  kind: "package",
  name: "Package A",
  description: null,
  print_size: null,
  price_cents: "8500",
  position: 1,
  lines: [
    { line_kind: "digital", print_size: null, quantity: 1, position: 2 },
    { line_kind: "print", print_size: "8x10", quantity: 1, position: 1 },
  ],
};
const PRINT_ROW = {
  ...PACKAGE_ROW,
  id: OTHER,
  kind: "print",
  name: "8×10 print",
  print_size: "8x10",
  price_cents: 2700,
  position: 2,
  lines: [],
};

const send = (method: string, body?: unknown, raw?: string) =>
  new Request("http://localhost/api/v1/x", {
    method,
    headers: { "content-type": "application/json" },
    body: raw ?? (body === undefined ? null : JSON.stringify(body)),
  });

type Route = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const routes = {
  list: async () => await import("./price-lists/route"),
  one: async () => await import("./price-lists/[id]/route"),
  setDefault: async () => (await import("./price-lists/[id]/default/route")).POST as Route,
  addItem: async () => (await import("./price-lists/[id]/items/route")).POST as Route,
  order: async () => (await import("./price-lists/[id]/items/order/route")).PUT as Route,
  item: async () => await import("./price-list-items/[id]/route"),
};

afterEach(() => scope.mockReset());

const WRITES: [string, () => Promise<Route>, string, string][] = [
  ["POST /price-lists", async () => (await routes.list()).POST as unknown as Route, "POST", LIST],
  ["PATCH /price-lists/:id", async () => (await routes.one()).PATCH, "PATCH", LIST],
  ["DELETE /price-lists/:id", async () => (await routes.one()).DELETE, "DELETE", LIST],
  ["POST /price-lists/:id/default", routes.setDefault, "POST", LIST],
  ["POST /price-lists/:id/items", routes.addItem, "POST", LIST],
  ["PUT /price-lists/:id/items/order", routes.order, "PUT", LIST],
  ["PATCH /price-list-items/:id", async () => (await routes.item()).PATCH, "PATCH", ITEM],
  ["DELETE /price-list-items/:id", async () => (await routes.item()).DELETE, "DELETE", ITEM],
];

describe("price list writes check the person before the body (answer 8)", () => {
  for (const [name, load, method, id] of WRITES) {
    const garbled = () => send(method, undefined, method === "DELETE" ? undefined : "{ not json");

    it(`${name}: signed-out people get not_signed_in, even with a broken body`, async () => {
      scope.mockRejectedValue(new ApiError("not_signed_in", "Please sign in."));
      const res = await (await load())(garbled(), ctx(id));
      expect(res.status).toBe(401);
    });

    for (const role of ["photographer", "staff"])
      it(`${name}: ${role}s get forbidden, even with a broken body, and nothing is read`, async () => {
        const db = fakeDatabase({});
        scope.mockResolvedValue({ supabase: db.supabase, studio: as(role), userId: "u" });
        const res = await (await load())(garbled(), ctx(id));
        expect(res.status).toBe(403);
        expect(db.calls).toEqual([]);
      });
  }
});

describe("GET /price-lists and /price-lists/:id", () => {
  it("lists the studio's own lists from the studio-scoped summaries", async () => {
    const db = fakeDatabase({ price_list_summaries: [SUMMARY] });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("staff"), userId: "u" });
    const res = await (await routes.list()).GET();
    expect(res.status).toBe(200);
    expect((await res.json()).priceLists).toEqual([
      {
        id: LIST,
        name: "Starter price list",
        currency: "CAD",
        isDefault: false,
        jobs: 0,
        sellingJobs: 0,
        counts: { packages: 1, prints: 1, digitals: 0 },
        updatedAt: "2026-10-12T00:00:00Z",
      },
    ]);
    expect(db.calls[0]?.args).toEqual({ p_studio_id: STUDIO });
  });

  it("returns a list with whole-cent money in its currency, contents in order, for any member", async () => {
    const db = fakeDatabase({
      price_lists: LIST_ROW,
      price_list_summaries: [{ ...SUMMARY, is_default: true, jobs: 3, selling_jobs: 1 }],
      price_list_items: [PACKAGE_ROW, PRINT_ROW],
    });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("photographer"), userId: "u" });
    const res = await (await routes.one()).GET(send("GET"), ctx(LIST));
    expect(res.status).toBe(200);
    const { priceList } = await res.json();
    expect(priceList).toMatchObject({
      homeShipping: { cents: 1195, currency: "CAD" },
      isDefault: true,
      jobs: 3,
      sellingJobs: 1,
    });
    expect(priceList.items[0]).toEqual({
      id: ITEM,
      priceListId: LIST,
      kind: "package",
      name: "Package A",
      description: null,
      printSize: null,
      price: { cents: 8500, currency: "CAD" },
      contents: [
        { kind: "print", printSize: "8x10", quantity: 1 },
        { kind: "digital", printSize: null, quantity: 1 },
      ],
      position: 1,
    });
    expect(priceList.items[1].price).toEqual({ cents: 2700, currency: "CAD" });
    for (const call of db.calls.filter((c) => !c.args))
      expect(has(call, "eq", "studio_id", STUDIO), call.name).toBe(true);
  });

  it("doesn't find another studio's list (or a bad id), and reads nothing more", async () => {
    const db = fakeDatabase({ price_lists: null });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.one()).GET(send("GET"), ctx(OTHER));
    expect(res.status).toBe(404);
    expect(db.calls.map((c) => c.name)).toEqual(["price_lists"]);
    expect(has(db.calls[0], "eq", "studio_id", STUDIO)).toBe(true);
    const bad = await (await routes.one()).GET(send("GET"), ctx("not-a-uuid"));
    expect(bad.status).toBe(404);
  });
});

describe("POST /price-lists", () => {
  const db = (answers: Record<string, unknown>) =>
    fakeDatabase({
      price_lists: (c: Call) => (isWrite(c) ? { data: { id: LIST } } : { data: LIST_ROW }),
      price_list_summaries: [SUMMARY],
      price_list_items: [],
      ...answers,
    });

  it("adds a blank list in the caller's studio; the currency is never sent", async () => {
    const fake = db({});
    scope.mockResolvedValue({ supabase: fake.supabase, studio: as("admin"), userId: "u" });
    const res = await (await routes.list()).POST(send("POST", { name: " Spring " }));
    expect(res.status).toBe(201);
    const insert = fake.calls.find(isWrite);
    expect(has(insert, "insert", { studio_id: STUDIO, name: "Spring" })).toBe(true);
    expect((await res.json()).priceList.id).toBe(LIST);
  });

  it("refuses a currency in the body", async () => {
    const fake = db({});
    scope.mockResolvedValue({ supabase: fake.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.list()).POST(send("POST", { name: "US", currency: "USD" }));
    expect(res.status).toBe(400);
    expect(fake.calls).toEqual([]);
  });

  it("copies one of the studio's lists; another studio's is a field error", async () => {
    const ok = db({ copy_price_list: LIST });
    scope.mockResolvedValue({ supabase: ok.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.list()).POST(send("POST", { name: "Copy", copyFromId: OTHER }));
    expect(res.status).toBe(201);
    expect(ok.calls.find((c) => c.name === "copy_price_list")?.args).toEqual({
      p_source_id: OTHER,
      p_name: "Copy",
    });
    const theirs = db({
      copy_price_list: () => ({ error: { code: "P0002", message: "not_found" } }),
    });
    scope.mockResolvedValue({ supabase: theirs.supabase, studio: as("owner"), userId: "u" });
    const refused = await (await routes.list()).POST(
      send("POST", { name: "Copy", copyFromId: OTHER }),
    );
    expect(refused.status).toBe(400);
    expect((await refused.json()).error.fields).toEqual({ copyFromId: "validation.priceList" });
  });

  it("names the 50-list limit", async () => {
    const fake = db({
      price_lists: () => ({ error: { code: "P0001", message: "price_list_limit" } }),
    });
    scope.mockResolvedValue({ supabase: fake.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.list()).POST(send("POST", { name: "One more" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "priceLists.limit" });
  });
});

describe("PATCH and DELETE /price-lists/:id, POST /price-lists/:id/default", () => {
  it("changes the name and shipping fee in whole cents, in the caller's studio only", async () => {
    const fake = fakeDatabase({
      price_lists: (c: Call) => (isWrite(c) ? { data: { id: LIST } } : { data: LIST_ROW }),
      price_list_summaries: [SUMMARY],
      price_list_items: [],
    });
    scope.mockResolvedValue({ supabase: fake.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.one()).PATCH(
      send("PATCH", { homeShippingCents: 995 }),
      ctx(LIST),
    );
    expect(res.status).toBe(200);
    const update = fake.calls.find(isWrite);
    expect(has(update, "update", { home_shipping_cents: 995 })).toBe(true);
    expect(has(update, "eq", "studio_id", STUDIO)).toBe(true);
    for (const cents of [9.95, "995", -1])
      expect(
        (await (await routes.one()).PATCH(send("PATCH", { homeShippingCents: cents }), ctx(LIST)))
          .status,
      ).toBe(400);
  });

  it("is not found for another studio's list", async () => {
    const fake = fakeDatabase({ price_lists: null });
    scope.mockResolvedValue({ supabase: fake.supabase, studio: as("owner"), userId: "u" });
    expect(
      (await (await routes.one()).PATCH(send("PATCH", { name: "X" }), ctx(OTHER))).status,
    ).toBe(404);
    expect((await (await routes.one()).DELETE(send("DELETE"), ctx(OTHER))).status).toBe(404);
    expect((await (await routes.setDefault())(send("POST"), ctx(OTHER))).status).toBe(404);
    expect(fake.calls.some((c) => c.name === "studios")).toBe(false);
    expect(fake.calls.filter(isWrite).every((c) => has(c, "eq", "studio_id", STUDIO))).toBe(true);
  });

  it("refuses to delete the default or a list in use, with named conflicts", async () => {
    for (const [summary, form] of [
      [{ ...SUMMARY, is_default: true }, "priceLists.isDefault"],
      [{ ...SUMMARY, jobs: 2 }, "priceLists.inUse"],
    ] as const) {
      const fake = fakeDatabase({ price_lists: LIST_ROW, price_list_summaries: [summary] });
      scope.mockResolvedValue({ supabase: fake.supabase, studio: as("owner"), userId: "u" });
      const res = await (await routes.one()).DELETE(send("DELETE"), ctx(LIST));
      expect(res.status).toBe(409);
      expect((await res.json()).error.fields).toEqual({ form });
      expect(fake.calls.some(isWrite)).toBe(false);
    }
  });

  it("deletes an unused list; a job taking it meanwhile is still a named conflict", async () => {
    const ok = fakeDatabase({
      price_lists: (c: Call) => (isWrite(c) ? { data: [{ id: LIST }] } : { data: LIST_ROW }),
      price_list_summaries: [SUMMARY],
    });
    scope.mockResolvedValue({ supabase: ok.supabase, studio: as("admin"), userId: "u" });
    expect((await (await routes.one()).DELETE(send("DELETE"), ctx(LIST))).status).toBe(204);
    expect(has(ok.calls.find(isWrite), "eq", "studio_id", STUDIO)).toBe(true);
    const raced = fakeDatabase({
      price_lists: (c: Call) =>
        isWrite(c) ? { error: { code: "23503", message: "fk" } } : { data: LIST_ROW },
      price_list_summaries: [SUMMARY],
    });
    scope.mockResolvedValue({ supabase: raced.supabase, studio: as("admin"), userId: "u" });
    const res = await (await routes.one()).DELETE(send("DELETE"), ctx(LIST));
    expect((await res.json()).error.fields).toEqual({ form: "priceLists.inUse" });
  });

  it("makes one of the studio's lists its default", async () => {
    const fake = fakeDatabase({ price_lists: LIST_ROW, studios: null });
    scope.mockResolvedValue({ supabase: fake.supabase, studio: as("owner"), userId: "u" });
    expect((await (await routes.setDefault())(send("POST"), ctx(LIST))).status).toBe(204);
    const update = fake.calls.find((c) => c.name === "studios");
    expect(has(update, "update", { default_price_list_id: LIST })).toBe(true);
    expect(has(update, "eq", "id", STUDIO)).toBe(true);
  });
});

describe("items", () => {
  const withItem = (row: unknown, extra: Record<string, unknown> = {}) =>
    fakeDatabase({
      price_lists: LIST_ROW,
      price_list_items: (c: Call) =>
        isWrite(c)
          ? { data: [{ id: ITEM }] }
          : c.ops.some(([op]) => op === "maybeSingle")
            ? { data: row ? { ...(row as object), list: { currency: "CAD" } } : null }
            : { data: [] },
      save_price_list_item: ITEM,
      ...extra,
    });

  it("adds a package with its contents in one call, as cents", async () => {
    const fake = withItem(PACKAGE_ROW);
    scope.mockResolvedValue({ supabase: fake.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.addItem())(
      send("POST", {
        kind: "package",
        name: "Package A",
        priceCents: 8500,
        contents: [{ kind: "print", printSize: "8x10", quantity: 1 }, { kind: "digital" }],
      }),
      ctx(LIST),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).item.price).toEqual({ cents: 8500, currency: "CAD" });
    expect(fake.calls.find((c) => c.name === "save_price_list_item")?.args).toEqual({
      p_price_list_id: LIST,
      p_item_id: null,
      p_item: { kind: "package", name: "Package A", price_cents: 8500 },
      p_lines: [
        { kind: "print", print_size: "8x10", quantity: 1 },
        { kind: "digital", print_size: null, quantity: 1 },
      ],
    });
  });

  it("refuses a second single digital, fractions of a cent, and a package without contents", async () => {
    const taken = fakeDatabase({
      price_lists: LIST_ROW,
      price_list_items: [{ id: OTHER }],
    });
    scope.mockResolvedValue({ supabase: taken.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.addItem())(
      send("POST", { kind: "digital_single", name: "Another", priceCents: 100 }),
      ctx(LIST),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "priceLists.digitalTaken" });
    expect(taken.calls.some((c) => c.name === "save_price_list_item")).toBe(false);
    for (const body of [
      { kind: "print", name: "x", printSize: "4x6", priceCents: 12.5 },
      { kind: "package", name: "x", priceCents: 100 },
    ])
      expect((await (await routes.addItem())(send("POST", body), ctx(LIST))).status).toBe(400);
  });

  it("doesn't add to another studio's list", async () => {
    const fake = fakeDatabase({ price_lists: null });
    scope.mockResolvedValue({ supabase: fake.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.addItem())(
      send("POST", { kind: "digital_all", name: "All", priceCents: 100 }),
      ctx(OTHER),
    );
    expect(res.status).toBe(404);
    expect(fake.calls.some((c) => c.name === "save_price_list_item")).toBe(false);
  });

  it("changes an item in place, keeping a package's contents unless they are sent", async () => {
    const fake = withItem(PACKAGE_ROW);
    scope.mockResolvedValue({ supabase: fake.supabase, studio: as("admin"), userId: "u" });
    const res = await (await routes.item()).PATCH(send("PATCH", { priceCents: 9000 }), ctx(ITEM));
    expect(res.status).toBe(200);
    expect(fake.calls.find((c) => c.name === "save_price_list_item")?.args).toEqual({
      p_price_list_id: LIST,
      p_item_id: ITEM,
      p_item: { price_cents: 9000 },
      p_lines: null,
    });
    expect(
      has(
        fake.calls.find((c) => c.name === "price_list_items"),
        "eq",
        "studio_id",
        STUDIO,
      ),
    ).toBe(true);
  });

  it("refuses contents on a print and a size on a package, and never changes the kind", async () => {
    scope.mockResolvedValue({
      supabase: withItem(PRINT_ROW).supabase,
      studio: as("owner"),
      userId: "u",
    });
    const print = await (await routes.item()).PATCH(
      send("PATCH", { contents: [{ kind: "digital" }] }),
      ctx(OTHER),
    );
    expect((await print.json()).error.fields).toEqual({ contents: "validation.invalid" });
    scope.mockResolvedValue({
      supabase: withItem(PACKAGE_ROW).supabase,
      studio: as("owner"),
      userId: "u",
    });
    const pkg = await (await routes.item()).PATCH(send("PATCH", { printSize: "4x6" }), ctx(ITEM));
    expect((await pkg.json()).error.fields).toEqual({ printSize: "validation.printSize" });
    const kind = await (await routes.item()).PATCH(send("PATCH", { kind: "print" }), ctx(ITEM));
    expect(kind.status).toBe(400);
  });

  it("doesn't find or delete another studio's item", async () => {
    const fake = withItem(null);
    scope.mockResolvedValue({ supabase: fake.supabase, studio: as("owner"), userId: "u" });
    expect(
      (await (await routes.item()).PATCH(send("PATCH", { name: "X" }), ctx(OTHER))).status,
    ).toBe(404);
    const none = fakeDatabase({ price_list_items: [] });
    scope.mockResolvedValue({ supabase: none.supabase, studio: as("owner"), userId: "u" });
    expect((await (await routes.item()).DELETE(send("DELETE"), ctx(OTHER))).status).toBe(404);
    expect(has(none.calls[0], "eq", "studio_id", STUDIO)).toBe(true);
  });

  it("orders every item once; a stale order is a field error", async () => {
    const ok = fakeDatabase({ price_lists: LIST_ROW, set_price_list_item_order: null });
    scope.mockResolvedValue({ supabase: ok.supabase, studio: as("owner"), userId: "u" });
    expect(
      (await (await routes.order())(send("PUT", { itemIds: [ITEM, OTHER] }), ctx(LIST))).status,
    ).toBe(204);
    expect(ok.calls.find((c) => c.name === "set_price_list_item_order")?.args).toEqual({
      p_price_list_id: LIST,
      p_item_ids: [ITEM, OTHER],
    });
    const stale = fakeDatabase({
      price_lists: LIST_ROW,
      set_price_list_item_order: () => ({ error: { code: "22023", message: "order_mismatch" } }),
    });
    scope.mockResolvedValue({ supabase: stale.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.order())(send("PUT", { itemIds: [ITEM] }), ctx(LIST));
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ itemIds: "validation.itemOrder" });
  });

  it("refuses unknown fields in an order instead of dropping them", async () => {
    const db = fakeDatabase({ price_lists: LIST_ROW, set_price_list_item_order: null });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await (await routes.order())(
      send("PUT", { itemIds: [ITEM, OTHER], position: 1 }),
      ctx(LIST),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ form: "validation.unknownField" });
    expect(db.calls.some((c) => c.name === "set_price_list_item_order")).toBe(false);
  });
});

describe("a job's price list and delivery", () => {
  const JOB_ROW = {
    id: JOB,
    name: "Fall",
    type: "school",
    status: "draft",
    picture_day: "2030-05-01",
    internal_number: "JOB00001",
    subjects_expected: null,
    price_list_id: LIST,
    deliver_to_school: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    client: null,
  };
  const patchJob = async (body: unknown) =>
    (await import("./jobs/[id]/route")).PATCH(send("PATCH", body), ctx(JOB));

  it("switches to one of the studio's lists and turns on school delivery", async () => {
    const fake = fakeDatabase({
      jobs: (c: Call) =>
        isWrite(c)
          ? { data: { ...JOB_ROW, price_list_id: OTHER, deliver_to_school: true } }
          : { data: JOB_ROW },
      price_lists: [{ id: OTHER }],
    });
    scope.mockResolvedValue({ supabase: fake.supabase, studio: as("owner"), userId: "u" });
    const res = await patchJob({ priceListId: OTHER, deliverToSchool: true });
    expect(res.status).toBe(200);
    expect((await res.json()).job).toMatchObject({ priceListId: OTHER, deliverToSchool: true });
    const update = fake.calls.find(isWrite);
    expect(has(update, "update", { price_list_id: OTHER, deliver_to_school: true })).toBe(true);
    expect(
      has(
        fake.calls.find((c) => c.name === "price_lists"),
        "eq",
        "studio_id",
        STUDIO,
      ),
    ).toBe(true);
  });

  it("refuses another studio's list as a field error", async () => {
    const fake = fakeDatabase({ jobs: JOB_ROW, price_lists: [] });
    scope.mockResolvedValue({ supabase: fake.supabase, studio: as("owner"), userId: "u" });
    const res = await patchJob({ priceListId: OTHER });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ priceListId: "validation.priceList" });
    expect(fake.calls.some(isWrite)).toBe(false);
    const created = await (await import("./jobs/route")).POST(
      send("POST", { name: "New", type: "school", pictureDay: "2030-01-01", priceListId: OTHER }),
    );
    expect(created.status).toBe(400);
  });

  it("keeps a closed job's list and delivery (Claude's call 4)", async () => {
    const fake = fakeDatabase({
      jobs: { ...JOB_ROW, status: "closed" },
      price_lists: [{ id: OTHER }],
    });
    scope.mockResolvedValue({ supabase: fake.supabase, studio: as("owner"), userId: "u" });
    for (const body of [{ priceListId: OTHER }, { deliverToSchool: true }]) {
      const res = await patchJob(body);
      expect(res.status).toBe(409);
      expect((await res.json()).error.fields).toEqual({ form: "priceLists.jobClosed" });
    }
    expect(fake.calls.some(isWrite)).toBe(false);
  });

  it("names a job that closed meanwhile", async () => {
    const fake = fakeDatabase({
      jobs: (c: Call) =>
        isWrite(c) ? { error: { code: "P0001", message: "job_closed" } } : { data: JOB_ROW },
    });
    scope.mockResolvedValue({ supabase: fake.supabase, studio: as("owner"), userId: "u" });
    const res = await patchJob({ deliverToSchool: true });
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "priceLists.jobClosed" });
  });

  it("leaves a new job's list to the database's default when none is given", async () => {
    const fake = fakeDatabase({ jobs: JOB_ROW, next_job_number: "JOB00002" });
    scope.mockResolvedValue({ supabase: fake.supabase, studio: as("owner"), userId: "u" });
    const res = await (await import("./jobs/route")).POST(
      send("POST", { name: "New", type: "school", pictureDay: "2030-01-01" }),
    );
    expect(res.status).toBe(201);
    const insert = fake.calls.find(isWrite)?.ops.find(([op]) => op === "insert")?.[1][0] as Record<
      string,
      unknown
    >;
    expect(insert).not.toHaveProperty("price_list_id");
    expect(insert.studio_id).toBe(STUDIO);
  });
});
