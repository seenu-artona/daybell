import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The parent shop's routes (ADR 0022): a code opens a gallery with an httpOnly session cookie; a wrong code, a code of
// a region not set up here and anything that isn't a code get the same answer; a locked caller gets 429 with
// Retry-After; previews are only the watermarked proofs, signed for 10 minutes at most; Canadian data is handled in
// Montréal only; no session, or a forged one, is 401; answers are never cached; cross-site writes are refused; and
// nothing is ever logged (no code, name, address or token). The database and storage are faked.
vi.mock("server-only", () => ({}));
const { rpc, signed, databases } = vi.hoisted(() => ({
  rpc: vi.fn(),
  signed: [] as { key: string; expiresIn: number }[],
  databases: { regions: ["ca"] as string[] },
}));
vi.mock("@/lib/supabase/service", () => ({ shopRpc: rpc }));
vi.mock("@/lib/photo-storage", () => ({
  photoStorage: () => ({
    presignGet: async (key: string, { expiresIn }: { expiresIn: number }) => {
      signed.push({ key, expiresIn });
      return `https://photos.example.test/${key}?sig=1`;
    },
  }),
}));
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
vi.stubEnv("ACCESS_CODE_HMAC_KEY", key(1));
vi.stubEnv("ACCESS_CODE_ENCRYPTION_KEY", key(2));
vi.stubEnv("SHOP_THROTTLE_KEY", key(3));

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const CHILD = "c0000000-0000-4000-8000-000000000001";
const PHOTO = (n: number) => `f0000000-0000-4000-8000-00000000000${n}`;
const TOKEN = "T".repeat(43);
const COOKIE = `daybell_shop=ca.${TOKEN}; daybell_device=${"D".repeat(43)}`;
const HEX = /^[0-9a-f]{64}$/;
const CODE = "K7QM-4XPA";

type Answers = Record<string, { data?: unknown; error?: unknown }>;
/** Each shop function answers from `answers` (take_shop_request lets everything in unless told otherwise). */
function database(answers: Answers) {
  rpc.mockImplementation(async (_region: string, fn: string) => {
    const answer = answers[fn] ?? (fn === "take_shop_request" ? { data: true } : { data: null });
    return { data: answer.data ?? null, error: answer.error ?? null };
  });
}
const calls = (fn: string) => rpc.mock.calls.filter((c) => c[1] === fn);

function request(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
  url = "http://localhost/api/v1/shop/x",
) {
  return new Request(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
}
const withSession = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  request(method, body, { cookie: COOKIE, ...headers });
const child = (childId = CHILD) => ({ params: Promise.resolve({ childId }) });
const line = (id: string) => ({ params: Promise.resolve({ id }) });

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  databases.regions = ["ca"];
  signed.length = 0;
  logs = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});
afterEach(() => {
  for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  rpc.mockReset();
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_CODE_HMAC_KEY", key(1));
  vi.stubEnv("ACCESS_CODE_ENCRYPTION_KEY", key(2));
  vi.stubEnv("SHOP_THROTTLE_KEY", key(3));
  vi.restoreAllMocks();
});

const access = async () => (await import("./shop/access/route")).POST;

describe("POST /shop/access (answers 1–3; calls 4, 5)", () => {
  it("opens the gallery with an httpOnly 30-day cookie whose token only the database's hash names", async () => {
    database({ shop_enter_code: { data: { outcome: "opened", child_id: CHILD } } });
    const res = await (await access())(request("POST", { code: "k7qm 4xpa" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ childId: CHILD });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith("daybell_shop=")) ?? "";
    expect(session).toMatch(/^daybell_shop=ca\.[A-Za-z0-9_-]{43};/);
    expect(session).toContain("HttpOnly");
    expect(session).toMatch(/SameSite=lax/i);
    expect(session).toContain("Path=/");
    expect(session).toContain("Max-Age=2592000");
    expect(cookies.some((c) => c.startsWith("daybell_device=") && c.includes("HttpOnly"))).toBe(
      true,
    );
    const token = /daybell_shop=ca\.([^;]+)/.exec(session)?.[1] ?? "";
    const [args] = calls("shop_enter_code").map((c) => c[2]);
    expect(args).toMatchObject({
      p_new_session_hash: createHash("sha256").update(token).digest("hex"),
      p_session_hash: null,
    });
    for (const field of ["p_code_hash", "p_pair_key", "p_ip_key"]) expect(args[field]).toMatch(HEX);
    // Neither the code nor the address reaches the database.
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/K7QM|4XPA|203\.0\.113/);
  });

  it("forgets this device's earlier session when a new code opens", async () => {
    database({ shop_enter_code: { data: { outcome: "opened", child_id: CHILD } } });
    await (await access())(withSession("POST", { code: CODE }));
    expect(calls("shop_enter_code")[0]?.[2].p_session_hash).toBe(
      createHash("sha256").update(TOKEN).digest("hex"),
    );
  });

  it("answers a wrong code, another region's code and a non-code exactly alike, and counts each", async () => {
    database({ shop_enter_code: { data: { outcome: "not_found" } } });
    const answers: unknown[] = [];
    for (const code of ["K7QM-4XPB", "27QM-4XPA", "hello"]) {
      const res = await (await access())(withSession("POST", { code }));
      answers.push([res.status, await res.json(), res.headers.get("cache-control")]);
    }
    expect(answers[0]).toEqual([
      404,
      {
        error: {
          code: "not_found",
          message: "We couldn't find that code. Check it and try again.",
          fields: { form: "shop.codeNotFound" },
        },
      },
      "no-store",
    ]);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    // A US code here (Canada only) and a non-code are looked up as nothing, in the database that is here.
    expect(calls("shop_enter_code").map((c) => [c[0], c[2].p_code_hash === null])).toEqual([
      ["ca", false],
      ["ca", true],
      ["ca", true],
    ]);
  });

  it("gives a locked caller 429 with Retry-After, and sets the device cookie first time", async () => {
    database({ shop_enter_code: { data: { outcome: "locked", retry_after: 840 } } });
    const res = await (await access())(request("POST", { code: CODE }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("840");
    expect((await res.json()).error).toMatchObject({
      code: "rate_limited",
      fields: { form: "shop.locked" },
    });
    expect(res.headers.getSetCookie().some((c) => c.startsWith("daybell_device="))).toBe(true);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("daybell_shop="))).toBe(false);
  });

  it("counts the same device on the same network as the same pair, and another network apart", async () => {
    database({ shop_enter_code: { data: { outcome: "not_found" } } });
    const route = await access();
    await route(withSession("POST", { code: CODE }));
    await route(withSession("POST", { code: CODE }));
    await route(withSession("POST", { code: CODE }, { "x-forwarded-for": "198.51.100.1" }));
    const [a, b, c] = calls("shop_enter_code").map((call) => call[2]);
    expect(a.p_pair_key).toBe(b.p_pair_key);
    expect(a.p_ip_key).toBe(b.p_ip_key);
    expect(c.p_ip_key).not.toBe(a.p_ip_key);
    expect(c.p_pair_key).not.toBe(a.p_pair_key);
  });

  it("refuses more than 120 requests a minute from a network, before looking anything up", async () => {
    database({ take_shop_request: { data: false } });
    const res = await (await access())(request("POST", { code: CODE }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(calls("take_shop_request")[0]?.[2]).toMatchObject({ p_limit: 120 });
    expect(calls("shop_enter_code")).toHaveLength(0);
  });

  it("refuses a cross-site request and a body that isn't JSON", async () => {
    database({});
    const crossSite = await (await access())(
      request("POST", { code: CODE }, { "sec-fetch-site": "cross-site" }),
    );
    expect(crossSite.status).toBe(403);
    const form = await (await access())(
      new Request("http://localhost/api/v1/shop/access", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "code=K7QM4XPA",
      }),
    );
    expect(form.status).toBe(400);
    const empty = await (await access())(request("POST", { code: "  " }));
    expect(empty.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("runs Canadian lookups in Montréal only (D113)", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    database({});
    const res = await (await access())(request("POST", { code: CODE }));
    expect(res.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
    // The region guard logs region names only.
    expect(JSON.stringify(logs.flatMap((s) => s.mock.calls))).not.toMatch(/K7QM|203\.0/);
    for (const spy of logs) spy.mockClear();
  });

  it("fails closed without SHOP_THROTTLE_KEY, naming the variable only", async () => {
    vi.resetModules();
    vi.stubEnv("SHOP_THROTTLE_KEY", "");
    database({});
    const res = await (await import("./shop/access/route")).POST(request("POST", { code: CODE }));
    expect(res.status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(logs.flatMap((s) => s.mock.calls))).toBe(
      '[["shop_throttle_key_missing"]]',
    );
    for (const spy of logs) spy.mockClear();
    vi.resetModules();
  });
});

describe("POST /shop/children (call 1)", () => {
  const add = async () => (await import("./shop/children/route")).POST;

  it("needs a session, and looks nothing up without one", async () => {
    database({});
    const res = await (await add())(request("POST", { code: CODE }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("shop_session_required");
    expect(calls("shop_enter_code")).toHaveLength(0);
  });

  it("adds a sibling into the session's own database", async () => {
    database({ shop_enter_code: { data: { outcome: "added", child_id: CHILD } } });
    const res = await (await add())(withSession("POST", { code: CODE }));
    expect(res.status).toBe(201);
    expect(calls("shop_enter_code")[0]?.[2]).toMatchObject({
      p_session_hash: createHash("sha256").update(TOKEN).digest("hex"),
      p_new_session_hash: null,
    });
  });

  it("names the limit, another studio and a child already here", async () => {
    const answer = async (outcome: Record<string, unknown>) => {
      database({ shop_enter_code: { data: outcome } });
      const res = await (await add())(withSession("POST", { code: CODE }));
      return [res.status, (await res.json()).error?.fields?.form ?? null];
    };
    expect(await answer({ outcome: "limit" })).toEqual([409, "shop.siblingLimit"]);
    expect(await answer({ outcome: "other_studio" })).toEqual([409, "shop.otherStudio"]);
    expect(await answer({ outcome: "already", child_id: CHILD })).toEqual([200, null]);
    expect(await answer({ outcome: "not_found" })).toEqual([404, "shop.codeNotFound"]);
  });
});

describe("GET and DELETE /shop/session (answer 3, call 11)", () => {
  const routes = async () => await import("./shop/session/route");

  it("is 401 without a cookie, with a malformed one, or one for a region not set up here", async () => {
    database({});
    const { GET } = await routes();
    for (const cookie of [undefined, "daybell_shop=forged", `daybell_shop=us.${TOKEN}`]) {
      const res = await GET(request("GET", undefined, cookie ? { cookie } : {}));
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(calls("shop_session")).toHaveLength(0);
  });

  it("clears a cookie the database no longer knows", async () => {
    database({ shop_session: { error: { code: "P0001", message: "session_required" } } });
    const res = await (await routes()).GET(withSession("GET"));
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie().find((c) => c.startsWith("daybell_shop="))).toMatch(
      /Max-Age=0/,
    );
  });

  it("shows first names and last initials only", async () => {
    database({
      shop_session: {
        data: {
          studio_name: "Maple Lane Photography",
          expires_at: "2026-11-11T12:00:00+00:00",
          shipping_method: null,
          bag_count: 2,
          children: [
            {
              id: CHILD,
              first_name: "Ava",
              last_initial: "P",
              job_id: JOB,
              school: "Maple Grove Elementary",
              picture_day: "2026-10-13",
              closes_at: null,
              deliver_to_school: true,
              state: "open",
            },
          ],
        },
      },
    });
    const res = await (await routes()).GET(withSession("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      studio: { name: "Maple Lane Photography" },
      expiresAt: "2026-11-11T12:00:00+00:00",
      bagCount: 2,
      children: [
        {
          id: CHILD,
          displayName: "Ava P.",
          firstName: "Ava",
          jobId: JOB,
          school: "Maple Grove Elementary",
          pictureDay: "2026-10-13",
          closesAt: null,
          deliverToSchool: true,
          state: "open",
        },
      ],
    });
  });

  it("forgets the device: the database's session and the cookie", async () => {
    database({ shop_forget: { data: true } });
    const res = await (await routes()).DELETE(withSession("DELETE"));
    expect(res.status).toBe(204);
    expect(calls("shop_forget")[0]?.[2]).toEqual({
      p_session_hash: createHash("sha256").update(TOKEN).digest("hex"),
    });
    expect(res.headers.getSetCookie().find((c) => c.startsWith("daybell_shop="))).toMatch(
      /Max-Age=0/,
    );
  });
});

describe("GET /shop/children/:childId/gallery (D60, D119)", () => {
  const gallery = async () => (await import("./shop/children/[childId]/gallery/route")).GET;
  const photo = (n: number) => ({ id: PHOTO(n), width: 1200, height: 1500 });

  it("signs only the watermarked proofs, for 10 minutes at most, and covers with the first portrait", async () => {
    database({
      shop_gallery: {
        data: {
          state: "open",
          studio_id: STUDIO,
          job_id: JOB,
          portraits: [photo(1), photo(2)],
          class_photos: [photo(3)],
        },
      },
    });
    const res = await (await gallery())(withSession("GET"), child());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cover.id).toBe(PHOTO(1));
    expect(body.portraits.map((p: { id: string }) => p.id)).toEqual([PHOTO(1), PHOTO(2)]);
    expect(body.classPhotos.map((p: { id: string }) => p.id)).toEqual([PHOTO(3)]);
    expect(signed).toHaveLength(6);
    for (const s of signed) {
      expect(s.key).toMatch(new RegExp(`^${STUDIO}/${JOB}/f0000000-[^/]+/proof(-thumb)?\\.webp$`));
      expect(s.expiresIn).toBeLessThanOrEqual(600);
    }
    expect(JSON.stringify(body)).not.toMatch(/original|\/thumb\.webp|\/view\.webp/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("signs nothing for a closed or unavailable child", async () => {
    for (const state of ["closed", "unavailable"]) {
      database({
        shop_gallery: {
          data: { state, studio_id: STUDIO, job_id: JOB, portraits: [], class_photos: [] },
        },
      });
      const res = await (await gallery())(withSession("GET"), child());
      expect(await res.json()).toEqual({ state, cover: null, portraits: [], classPhotos: [] });
    }
    expect(signed).toHaveLength(0);
  });

  it("is not found for a bad id or a child outside the session, like a missing one", async () => {
    database({ shop_gallery: { error: { code: "P0002", message: "Child not found" } } });
    expect((await (await gallery())(withSession("GET"), child("nope"))).status).toBe(404);
    expect((await (await gallery())(withSession("GET"), child())).status).toBe(404);
  });

  it("signs Canadian photos in Montréal only (D113)", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    database({});
    expect((await (await gallery())(withSession("GET"), child())).status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
    for (const spy of logs) spy.mockClear();
  });
});

describe("the bag (calls 8, 9)", () => {
  const cartRow = (lines: unknown[], method: string | null = null) => ({
    studio_id: STUDIO,
    shipping_method: method,
    lines,
    jobs: [{ job_id: JOB, deliver_to_school: true, home_shipping_cents: 1195, currency: "CAD" }],
  });
  const dbLine = (over: Record<string, unknown>) => ({
    id: "11111111-0000-4000-8000-000000000001",
    child_id: CHILD,
    job_id: JOB,
    item_id: "22222222-0000-4000-8000-000000000001",
    kind: "package",
    name: "Package A",
    print_size: null,
    price_cents: 8500,
    currency: "CAD",
    quantity: 2,
    photo_id: PHOTO(1),
    physical: true,
    available: true,
    ...over,
  });

  it("prices the bag now, leaving out what can't be bought, and asks for delivery when both are offered", async () => {
    database({
      shop_cart: {
        data: cartRow([
          dbLine({}),
          dbLine({
            id: "11111111-0000-4000-8000-000000000002",
            kind: "digital_all",
            name: "All digitals",
            price_cents: 7900,
            quantity: 1,
            photo_id: null,
            physical: false,
          }),
          dbLine({ id: "11111111-0000-4000-8000-000000000003", available: false, quantity: 5 }),
        ]),
      },
    });
    const res = await (await import("./shop/cart/route")).GET(withSession("GET"));
    const body = await res.json();
    expect(body.subtotal).toEqual({ cents: 24900, currency: "CAD" });
    expect(body.count).toBe(3);
    expect(body.shipping).toEqual({
      needed: true,
      home: { cents: 1195, currency: "CAD" },
      school: true,
      method: null,
      cost: null,
    });
    expect(body.total).toBeNull();
    expect(body.lines[0].lineTotal).toEqual({ cents: 17000, currency: "CAD" });
    expect(body.lines[2].photo).toEqual({ id: PHOTO(1), thumbUrl: null });
    expect(signed.map((s) => s.key)).toEqual([`${STUDIO}/${JOB}/${PHOTO(1)}/proof-thumb.webp`]);
  });

  it("adds a line through the database and answers with the bag", async () => {
    database({
      shop_cart_add: { data: "11111111-0000-4000-8000-000000000001" },
      shop_cart: { data: cartRow([dbLine({})], "school") },
    });
    const res = await (await import("./shop/cart/lines/route")).POST(
      withSession("POST", {
        childId: CHILD,
        itemId: "22222222-0000-4000-8000-000000000001",
        photoId: PHOTO(1),
      }),
    );
    expect(res.status).toBe(201);
    expect(calls("shop_cart_add")[0]?.[2]).toEqual({
      p_session_hash: createHash("sha256").update(TOKEN).digest("hex"),
      p_child_id: CHILD,
      p_item_id: "22222222-0000-4000-8000-000000000001",
      p_photo_id: PHOTO(1),
      p_quantity: 1,
    });
    expect((await res.json()).total).toEqual({ cents: 17000, currency: "CAD" });
  });

  it("turns the database's refusals into conflicts with keys", async () => {
    const refuse = async (error: Record<string, unknown>) => {
      database({ shop_cart_add: { error } });
      const res = await (await import("./shop/cart/lines/route")).POST(
        withSession("POST", { childId: CHILD, itemId: CHILD, photoId: null }),
      );
      return [res.status, (await res.json()).error.fields?.form ?? null];
    };
    expect(await refuse({ code: "P0001", message: "shop_closed" })).toEqual([409, "shop.closed"]);
    expect(await refuse({ code: "P0001", message: "item_unavailable" })).toEqual([
      409,
      "shop.itemUnavailable",
    ]);
    expect(await refuse({ code: "P0001", message: "photo_unavailable" })).toEqual([
      409,
      "shop.photoUnavailable",
    ]);
    expect(await refuse({ code: "P0001", message: "bag_full" })).toEqual([409, "shop.bagFull"]);
    expect(await refuse({ code: "P0002", message: "Child not found" })).toEqual([404, null]);
    expect(await refuse({ code: "22023", message: "x" })).toEqual([400, null]);
  });

  it("refuses school delivery the jobs don't offer", async () => {
    database({ shop_set_shipping: { error: { code: "P0001", message: "school_delivery_off" } } });
    const res = await (await import("./shop/cart/shipping/route")).PUT(
      withSession("PUT", { method: "school" }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields.form).toBe("shop.schoolDeliveryOff");
  });

  it("changes and removes lines of the session only", async () => {
    database({ shop_cart: { data: cartRow([]) } });
    const routes = await import("./shop/cart/lines/[id]/route");
    const id = "11111111-0000-4000-8000-000000000001";
    expect((await routes.PATCH(withSession("PATCH", { quantity: 3 }), line(id))).status).toBe(200);
    expect((await routes.DELETE(withSession("DELETE"), line(id))).status).toBe(200);
    expect(calls("shop_cart_set_quantity")[0]?.[2]).toMatchObject({ p_line_id: id, p_quantity: 3 });
    expect(calls("shop_cart_remove")[0]?.[2]).toMatchObject({ p_line_id: id });
    expect((await routes.PATCH(withSession("PATCH", { quantity: 0 }), line(id))).status).toBe(400);
    expect((await routes.DELETE(withSession("DELETE"), line("nope"))).status).toBe(404);
  });
});

describe("shop pages and routes are never indexed, framed or referred (next.config)", () => {
  it("sends noindex, no-referrer and DENY for /shop and /api/v1/shop", async () => {
    const config = (await import("../../../next.config")).default;
    const rules = await config.headers?.();
    for (const source of ["/shop", "/shop/:path*", "/api/v1/shop/:path*"]) {
      const rule = rules?.find((r) => r.source === source);
      expect(rule?.headers).toEqual([
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
      ]);
    }
  });
});
