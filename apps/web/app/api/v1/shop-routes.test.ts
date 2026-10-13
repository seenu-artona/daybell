import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The parent shop's routes (ADR 0022): a code opens a gallery, or joins this device's gallery of the same studio, with
// an httpOnly session cookie holding up to 3 studios' sessions (S6); a wrong code, a code of a region not set up here
// and anything that isn't a code get the same answer; only a device cookie the server signed counts as a device (H1);
// a locked caller gets 429 with Retry-After; every request is counted before its body is read (L7); previews are only
// the watermarked proofs, signed for 10 minutes at most; Canadian data is handled in Montréal only; no session, or a
// forged one, is 401; cookies are __Host- and Secure over HTTPS (L1); a closed child shows no name (M1); answers are
// never cached; cross-site writes are refused; and nothing is ever logged (no code, name, address or token). The
// database and storage are faked.
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

const { galleryId } = await import("@/lib/shop/session");
const { signDevice } = await import("@/lib/shop/throttle");

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const CHILD = "c0000000-0000-4000-8000-000000000001";
const PHOTO = (n: number) => `f0000000-0000-4000-8000-00000000000${n}`;
const TOKEN = "T".repeat(43);
const TOKEN_B = "U".repeat(43);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const DEVICE = signDevice("D".repeat(43), Math.floor(Date.now() / 1000));
const COOKIE = `daybell_shop=ca.${TOKEN}; daybell_device=${DEVICE}`;
const HEX = /^[0-9a-f]{64}$/;
const CODE = "K7QM-4XPA";

type Answers = Record<string, { data?: unknown; error?: unknown }>;
/** Each shop function answers from `answers` (take_shop_request lets everything in unless told otherwise). */
function database(answers: Answers | ((fn: string, args: Record<string, unknown>) => unknown)) {
  rpc.mockImplementation(async (_region: string, fn: string, args: Record<string, unknown>) => {
    if (typeof answers === "function") {
      if (fn === "take_shop_request") return { data: true, error: null };
      return { data: answers(fn, args) ?? null, error: null };
    }
    const answer = answers[fn] ?? (fn === "take_shop_request" ? { data: true } : { data: null });
    return { data: answer.data ?? null, error: answer.error ?? null };
  });
}
const calls = (fn: string) => rpc.mock.calls.filter((c) => c[1] === fn);
const setCookie = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));

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
const opened = (sessionHash: string, live: string[] = [sessionHash]) => ({
  outcome: "opened",
  child_id: CHILD,
  session_hash: sessionHash,
  live,
  device_issued: false,
});

describe("POST /shop/access (answers 1–3; calls 4, 5; S5, S6)", () => {
  it("opens the gallery with an httpOnly 30-day cookie whose token only the database's hash names", async () => {
    database((fn, args) =>
      fn === "shop_enter_code"
        ? { ...opened(args.p_new_session_hash as string), device_issued: true }
        : null,
    );
    const res = await (await access())(request("POST", { code: "k7qm 4xpa" }));
    expect(res.status).toBe(201);
    const session = setCookie(res, "daybell_shop") ?? "";
    expect(session).toMatch(/^daybell_shop=ca\.[A-Za-z0-9_-]{43};/);
    const token = /daybell_shop=ca\.([^;]+)/.exec(session)?.[1] ?? "";
    expect(await res.json()).toEqual({ childId: CHILD, galleryId: galleryId(token) });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(session).toContain("HttpOnly");
    expect(session).toMatch(/SameSite=lax/i);
    expect(session).toContain("Path=/");
    expect(session).toContain("Max-Age=2592000");
    expect(session).not.toMatch(/Domain=/i);
    const device = setCookie(res, "daybell_device") ?? "";
    expect(device).toContain("HttpOnly");
    expect(device).toContain("Max-Age=2592000");
    const [args] = calls("shop_enter_code").map((c) => c[2]);
    expect(args).toMatchObject({
      p_new_session_hash: sha(token),
      p_session_hashes: [],
      p_device_key: null,
      p_wider_key: null,
    });
    for (const field of ["p_code_hash", "p_new_device_key", "p_net_key", "p_wide_key"])
      expect(args[field]).toMatch(HEX);
    // Neither the code nor the address reaches the database.
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/K7QM|4XPA|203\.0\.113/);
  });

  it("uses __Host- cookies, Secure, over HTTPS, and ignores a plain cookie a sibling site could plant (L1)", async () => {
    database((fn, args) =>
      fn === "shop_enter_code" ? opened(args.p_new_session_hash as string) : null,
    );
    const res = await (await access())(
      request(
        "POST",
        { code: CODE },
        { cookie: `daybell_shop=ca.${TOKEN}` },
        "https://shop.example.test/api/v1/shop/access",
      ),
    );
    const session = setCookie(res, "__Host-daybell_shop") ?? "";
    expect(session).toContain("Secure");
    expect(session).toContain("Path=/");
    expect(session).not.toMatch(/Domain=/i);
    expect(setCookie(res, "daybell_shop")).toBeUndefined();
    expect(calls("shop_enter_code")[0]?.[2].p_session_hashes).toEqual([]);
  });

  it("sets a device cookie only when the database issued the device (H1)", async () => {
    database((fn, args) =>
      fn === "shop_enter_code" ? opened(args.p_new_session_hash as string) : null,
    );
    const res = await (await access())(request("POST", { code: CODE }));
    expect(setCookie(res, "daybell_device")).toBeUndefined();
  });

  it("counts a device by its signed cookie only, the same on any network; a forged one is no device (H1)", async () => {
    database({ shop_enter_code: { data: { outcome: "not_found" } } });
    const route = await access();
    await route(withSession("POST", { code: CODE }));
    await route(withSession("POST", { code: CODE }, { "x-forwarded-for": "198.51.100.1" }));
    await route(request("POST", { code: CODE }, { cookie: `daybell_device=${"D".repeat(43)}` }));
    const [a, b, c] = calls("shop_enter_code").map((call) => call[2]);
    expect(a.p_device_key).toMatch(HEX);
    expect(a.p_new_device_key).toBeNull();
    expect(b.p_device_key).toBe(a.p_device_key);
    expect(b.p_net_key).not.toBe(a.p_net_key);
    expect(c.p_device_key).toBeNull();
    expect(c.p_new_device_key).toMatch(HEX);
    expect(c.p_net_key).toBe(a.p_net_key);
  });

  it("adds a same-studio code to this device's gallery, keeping the cookie and the bag (S5)", async () => {
    database({
      shop_enter_code: {
        data: { outcome: "added", child_id: CHILD, session_hash: sha(TOKEN), live: [sha(TOKEN)] },
      },
    });
    const res = await (await access())(withSession("POST", { code: CODE }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ childId: CHILD, galleryId: galleryId(TOKEN) });
    expect(calls("shop_enter_code")[0]?.[2].p_session_hashes).toEqual([sha(TOKEN)]);
    expect(setCookie(res, "daybell_shop")).toBeUndefined();
  });

  it("answers 200 for a child already in the gallery", async () => {
    database({
      shop_enter_code: {
        data: { outcome: "already", child_id: CHILD, session_hash: sha(TOKEN), live: [sha(TOKEN)] },
      },
    });
    expect((await (await access())(withSession("POST", { code: CODE }))).status).toBe(200);
  });

  it("opens another studio's code as a gallery of its own beside the first (S6)", async () => {
    database((fn, args) =>
      fn === "shop_enter_code"
        ? opened(args.p_new_session_hash as string, [sha(TOKEN), args.p_new_session_hash as string])
        : null,
    );
    const res = await (await access())(withSession("POST", { code: CODE }));
    const value = /daybell_shop=([^;]+)/.exec(setCookie(res, "daybell_shop") ?? "")?.[1] ?? "";
    const [first, second] = value.split("~");
    expect(first).toBe(`ca.${TOKEN}`);
    expect(second).toMatch(/^ca\.[A-Za-z0-9_-]{43}$/);
    expect((await res.json()).galleryId).toBe(galleryId(second?.slice(3) ?? ""));
  });

  it("refuses a 4th studio, and drops galleries that no longer last from the cookie", async () => {
    const three = `daybell_shop=ca.${TOKEN}~ca.${TOKEN_B}~ca.${"V".repeat(43)}`;
    database({
      shop_enter_code: {
        data: { outcome: "gallery_limit", live: [sha(TOKEN), sha(TOKEN_B), sha("V".repeat(43))] },
      },
    });
    const full = await (await access())(request("POST", { code: CODE }, { cookie: three }));
    expect(full.status).toBe(409);
    expect((await full.json()).error.fields.form).toBe("shop.galleryLimit");
    expect(setCookie(full, "daybell_shop")).toBeUndefined();
    database({ shop_enter_code: { data: { outcome: "not_found", live: [sha(TOKEN)] } } });
    const res = await (await access())(request("POST", { code: CODE }, { cookie: three }));
    expect(setCookie(res, "daybell_shop")).toMatch(new RegExp(`^daybell_shop=ca\\.${TOKEN};`));
  });

  it("names the 5-child limit", async () => {
    database({ shop_enter_code: { data: { outcome: "limit", live: [sha(TOKEN)] } } });
    const res = await (await access())(withSession("POST", { code: CODE }));
    expect([res.status, (await res.json()).error.fields.form]).toEqual([409, "shop.siblingLimit"]);
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

  it("gives a locked caller 429 with Retry-After, and still sets an issued device", async () => {
    database({
      shop_enter_code: { data: { outcome: "locked", retry_after: 840, device_issued: true } },
    });
    const res = await (await access())(request("POST", { code: CODE }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("840");
    expect((await res.json()).error).toMatchObject({
      code: "rate_limited",
      fields: { form: "shop.locked" },
    });
    expect(setCookie(res, "daybell_device")).toBeDefined();
    expect(setCookie(res, "daybell_shop")).toBeUndefined();
  });

  it("logs one code-free alert when a wrong code trips the region's breaker (H1)", async () => {
    database({ shop_enter_code: { data: { outcome: "not_found", alert: true } } });
    await (await access())(withSession("POST", { code: CODE }));
    const logged = logs.flatMap((s) => s.mock.calls);
    expect(logged).toEqual([["shop_lockout_breaker_tripped", "ca"]]);
    for (const spy of logs) spy.mockClear();
  });

  it("refuses more than 120 requests a minute from a network, before reading the body (L7)", async () => {
    database({ take_shop_request: { data: false } });
    for (const body of [{ code: CODE }, { code: "" }, { nope: 1 }]) {
      const res = await (await access())(request("POST", body));
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("60");
    }
    expect(calls("take_shop_request")).toHaveLength(3);
    expect(calls("take_shop_request")[0]?.[2]).toMatchObject({ p_limit: 120 });
    expect(calls("shop_enter_code")).toHaveLength(0);
  });

  it("counts malformed bodies too, then refuses them (L7)", async () => {
    database({});
    const empty = await (await access())(request("POST", { code: "  " }));
    expect(empty.status).toBe(400);
    expect(calls("take_shop_request")).toHaveLength(1);
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
    expect(calls("shop_enter_code")).toHaveLength(0);
  });

  it("on Vercel, counts by Vercel's own address header only; without it, one strict bucket (L4)", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_REGION", "yul1");
    database({ shop_enter_code: { data: { outcome: "not_found" } } });
    const route = await access();
    await route(request("POST", { code: CODE }, { "x-vercel-forwarded-for": "203.0.113.7" }));
    await route(request("POST", { code: CODE }, { "x-forwarded-for": "198.51.100.1" }));
    await route(request("POST", { code: CODE }, { "x-forwarded-for": "198.51.100.2" }));
    const [a, b, c] = calls("shop_enter_code").map((call) => call[2]);
    expect(b.p_net_key).not.toBe(a.p_net_key);
    expect(c.p_net_key).toBe(b.p_net_key);
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

const dbSession = (children: unknown[], studio = "Maple Lane Photography") => ({
  studio_name: studio,
  expires_at: "2026-11-11T12:00:00+00:00",
  shipping_method: null,
  bag_count: 2,
  children,
});
const ava = {
  id: CHILD,
  state: "open",
  first_name: "Ava",
  last_initial: "P",
  job_id: JOB,
  school: "Maple Grove Elementary",
  picture_day: "2026-10-13",
  closes_at: null,
  deliver_to_school: true,
};

describe("GET and DELETE /shop/session (answer 3, call 11; S6)", () => {
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
    expect(calls("take_shop_request")).toHaveLength(3);
  });

  it("clears a cookie the database no longer knows", async () => {
    database({ shop_session: { error: { code: "P0001", message: "session_required" } } });
    const res = await (await routes()).GET(withSession("GET"));
    expect(res.status).toBe(401);
    expect(setCookie(res, "daybell_shop")).toMatch(/Max-Age=0/);
  });

  it("lists the device's galleries: first names and last initials of open children only (M1)", async () => {
    database((fn, args) =>
      fn === "shop_session"
        ? args.p_session_hash === sha(TOKEN)
          ? dbSession([ava, { id: "c0000000-0000-4000-8000-000000000002", state: "closed" }])
          : dbSession(
              [{ id: "c0000000-0000-4000-8000-000000000003", state: "unavailable" }],
              "Studio B",
            )
        : null,
    );
    const res = await (await routes()).GET(
      request("GET", undefined, { cookie: `daybell_shop=ca.${TOKEN}~ca.${TOKEN_B}` }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      galleries: [
        {
          id: galleryId(TOKEN),
          studio: { name: "Maple Lane Photography" },
          expiresAt: "2026-11-11T12:00:00+00:00",
          bagCount: 2,
          children: [
            {
              id: CHILD,
              state: "open",
              displayName: "Ava P.",
              firstName: "Ava",
              jobId: JOB,
              school: "Maple Grove Elementary",
              pictureDay: "2026-10-13",
              closesAt: null,
              deliverToSchool: true,
            },
            { id: "c0000000-0000-4000-8000-000000000002", state: "closed" },
          ],
        },
        {
          id: galleryId(TOKEN_B),
          studio: { name: "Studio B" },
          expiresAt: "2026-11-11T12:00:00+00:00",
          bagCount: 2,
          children: [{ id: "c0000000-0000-4000-8000-000000000003", state: "unavailable" }],
        },
      ],
    });
    expect(setCookie(res, "daybell_shop")).toBeUndefined();
  });

  it("drops a gallery that no longer lasts from the cookie and lists the rest", async () => {
    rpc.mockImplementation(async (_r: string, fn: string, args: Record<string, unknown>) =>
      fn === "take_shop_request"
        ? { data: true, error: null }
        : args.p_session_hash === sha(TOKEN)
          ? { data: null, error: { code: "P0001", message: "session_required" } }
          : { data: dbSession([ava]), error: null },
    );
    const res = await (await routes()).GET(
      request("GET", undefined, { cookie: `daybell_shop=ca.${TOKEN}~ca.${TOKEN_B}` }),
    );
    expect((await res.json()).galleries.map((g: { id: string }) => g.id)).toEqual([
      galleryId(TOKEN_B),
    ]);
    expect(setCookie(res, "daybell_shop")).toMatch(new RegExp(`^daybell_shop=ca\\.${TOKEN_B};`));
  });

  it("forgets one gallery, keeping the others, or every gallery", async () => {
    database({ shop_forget: { data: true } });
    const { DELETE } = await routes();
    const both = { cookie: `daybell_shop=ca.${TOKEN}~ca.${TOKEN_B}` };
    const one = await DELETE(
      request(
        "DELETE",
        undefined,
        both,
        `http://localhost/api/v1/shop/session?gallery=${galleryId(TOKEN_B)}`,
      ),
    );
    expect(one.status).toBe(204);
    expect(calls("shop_forget").map((c) => c[2])).toEqual([{ p_session_hash: sha(TOKEN_B) }]);
    expect(setCookie(one, "daybell_shop")).toMatch(new RegExp(`^daybell_shop=ca\\.${TOKEN};`));
    rpc.mockClear();
    const all = await DELETE(request("DELETE", undefined, both));
    expect(calls("shop_forget").map((c) => c[2])).toEqual([
      { p_session_hash: sha(TOKEN) },
      { p_session_hash: sha(TOKEN_B) },
    ]);
    expect(setCookie(all, "daybell_shop")).toMatch(/Max-Age=0/);
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

  it("reads the gallery the request names, and refuses one not on this device (S6)", async () => {
    database({ shop_gallery: { data: { state: "closed" } } });
    const cookie = { cookie: `daybell_shop=ca.${TOKEN}~ca.${TOKEN_B}` };
    const url = (g: string) =>
      `http://localhost/api/v1/shop/children/${CHILD}/gallery?gallery=${g}`;
    const res = await (await gallery())(
      request("GET", undefined, cookie, url(galleryId(TOKEN_B))),
      child(),
    );
    expect(res.status).toBe(200);
    expect(calls("shop_gallery")[0]?.[2].p_session_hash).toBe(sha(TOKEN_B));
    const other = await (await gallery())(
      request("GET", undefined, cookie, url("0".repeat(32))),
      child(),
    );
    expect(other.status).toBe(401);
    expect(calls("shop_gallery")).toHaveLength(1);
  });

  it("signs nothing for a closed or unavailable child", async () => {
    for (const state of ["closed", "unavailable"]) {
      database({ shop_gallery: { data: { state } } });
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
  const cartRow = (lines: unknown[], method: string | null = null, jobs?: unknown[]) => ({
    studio_id: STUDIO,
    currency: "CAD",
    shipping_method: method,
    lines,
    jobs: jobs ?? [
      { job_id: JOB, deliver_to_school: true, home_shipping_cents: 1195, currency: "CAD" },
    ],
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

  it("an empty bag is in the studio's currency, never a guess (N4)", async () => {
    database({ shop_cart: { data: { ...cartRow([], null, []), currency: "USD" } } });
    const body = await (await (await import("./shop/cart/route")).GET(withSession("GET"))).json();
    expect(body.subtotal).toEqual({ cents: 0, currency: "USD" });
  });

  it("offers school delivery by the lines that can still be bought, and the choice is then accepted (M2)", async () => {
    // Noah's print (a job without school delivery) can't be bought any more; Ava's (school delivery) can.
    const lines = [
      dbLine({ kind: "print", job_id: JOB, quantity: 1 }),
      dbLine({
        id: "11111111-0000-4000-8000-000000000009",
        kind: "print",
        job_id: STUDIO,
        available: false,
      }),
    ];
    const jobs = [
      { job_id: JOB, deliver_to_school: true, home_shipping_cents: 1195, currency: "CAD" },
      { job_id: STUDIO, deliver_to_school: false, home_shipping_cents: 1500, currency: "CAD" },
    ];
    database({ shop_cart: { data: cartRow(lines, null, jobs) } });
    const bag = await (await (await import("./shop/cart/route")).GET(withSession("GET"))).json();
    expect(bag.shipping).toMatchObject({ school: true, home: { cents: 1195, currency: "CAD" } });
    database({
      shop_set_shipping: { data: null },
      shop_cart: { data: cartRow(lines, "school", jobs) },
    });
    const res = await (await import("./shop/cart/shipping/route")).PUT(
      withSession("PUT", { method: "school" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).total).toEqual({ cents: 8500, currency: "CAD" });
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
      p_session_hash: sha(TOKEN),
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

  it("refuses a quantity for a line that can't be bought any more (N2)", async () => {
    database({ shop_cart_set_quantity: { error: { code: "P0001", message: "item_unavailable" } } });
    const routes = await import("./shop/cart/lines/[id]/route");
    const res = await routes.PATCH(
      withSession("PATCH", { quantity: 3 }),
      line("11111111-0000-4000-8000-000000000001"),
    );
    expect([res.status, (await res.json()).error.fields.form]).toEqual([
      409,
      "shop.itemUnavailable",
    ]);
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

describe("shop pages and routes are never indexed, framed or referred (next.config; L2)", () => {
  it("sends noindex, no-referrer, DENY, HSTS and a closed Permissions-Policy for /shop and /api/v1/shop", async () => {
    const config = (await import("../../../next.config")).default;
    const rules = await config.headers?.();
    const shopHeaders = [
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Strict-Transport-Security", value: "max-age=63072000" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=()",
      },
    ];
    for (const source of ["/shop", "/shop/:path*"])
      expect(rules?.find((r) => r.source === source)?.headers).toEqual(shopHeaders);
    expect(rules?.find((r) => r.source === "/api/v1/shop/:path*")?.headers).toEqual([
      ...shopHeaders,
      { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" },
    ]);
  });
});
