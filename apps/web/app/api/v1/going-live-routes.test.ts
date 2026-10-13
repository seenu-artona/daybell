import { ApiError } from "@daybell/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Going live (ADR 0021): Start selling, Close shop and Reopen shop check the person, their role and the job's studio
// before anything is written, and turn the database's named refusals into words for the screen (only known blockers
// become fields); the bell reads and marks only the person's own notifications in their studio; the jobs cron needs
// its secret, works page by page in each region's function region, and answers counts only. Scope, database and
// service role are faked; nothing is ever logged.
vi.mock("server-only", () => ({}));
const { scope, statusRpc, systemRpc } = vi.hoisted(() => ({
  scope: vi.fn(),
  statusRpc: vi.fn(),
  systemRpc: vi.fn(),
}));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));
vi.mock("@/lib/supabase/service", () => ({ jobStatusRpc: statusRpc, jobSystemRpc: systemRpc }));
vi.mock("@daybell/config", async (original) => ({
  ...(await original<typeof import("@daybell/config")>()),
  regionDatabase: (region: string) =>
    region === "ca" ? { region, url: "http://127.0.0.1:54321", publishableKey: "pk" } : null,
}));

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const USER = "11111111-1111-4111-8111-111111111111";
const as = (role: string) => ({ id: STUDIO, name: "North Peak", slug: "np", region: "ca", role });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jobRow = (status: string) => ({
  id: JOB,
  name: "Fall",
  type: "school",
  status,
  picture_day: "2030-05-01",
  internal_number: "JOB00001",
  subjects_expected: null,
  price_list_id: "e0000000-0000-4000-8000-000000000001",
  deliver_to_school: false,
  closes_at: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  client: null,
});

/**
 * A stand-in for the Supabase client: each `from(table)` call answers the next of `answers[table]` (the last one
 * repeats), and every chained call is recorded with its table.
 */
function fakeDatabase(
  answers: Record<string, { data?: unknown; error?: unknown; count?: number }[]>,
) {
  const ops: [string, string, unknown[]][] = [];
  const used: Record<string, number> = {};
  const from = (table: string) => {
    const list = answers[table] ?? [{}];
    const answer = list[Math.min(used[table] ?? 0, list.length - 1)] ?? {};
    used[table] = (used[table] ?? 0) + 1;
    const chain: object = new Proxy(
      {},
      {
        get: (_t, prop: string) =>
          prop === "then"
            ? (resolve: (v: unknown) => void) =>
                resolve({
                  data: answer.data ?? null,
                  error: answer.error ?? null,
                  count: answer.count,
                })
            : (...args: unknown[]) => {
                ops.push([table, prop, args]);
                return chain;
              },
      },
    );
    return chain;
  };
  return { supabase: { from: vi.fn(from), rpc: vi.fn() }, ops };
}

const post = (body?: unknown) =>
  new Request("http://localhost/api/v1/x", {
    method: "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body),
  });

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  logs = (["log", "info", "warn", "error"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});
afterEach(() => {
  for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  scope.mockReset();
  statusRpc.mockReset();
  systemRpc.mockReset();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Route = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const STATUS_ROUTES: [string, () => Promise<Route>, string][] = [
  [
    "start-selling",
    async () => (await import("./jobs/[id]/start-selling/route")).POST,
    "start_selling",
  ],
  ["close", async () => (await import("./jobs/[id]/close/route")).POST, "close_job"],
  ["reopen", async () => (await import("./jobs/[id]/reopen/route")).POST, "reopen_job"],
];

describe("Start selling, Close shop and Reopen shop (calls 1 and 2)", () => {
  for (const [name, load, fn] of STATUS_ROUTES) {
    it(`${name}: signed-out people get not_signed_in`, async () => {
      scope.mockRejectedValue(new ApiError("not_signed_in", "Please sign in."));
      expect((await (await load())(post(), ctx(JOB))).status).toBe(401);
      expect(statusRpc).not.toHaveBeenCalled();
    });

    it(`${name}: photographers and staff are refused before the job is read or anything written`, async () => {
      for (const role of ["photographer", "staff"]) {
        const db = fakeDatabase({ jobs: [{ data: jobRow("draft") }] });
        scope.mockResolvedValue({ supabase: db.supabase, studio: as(role), userId: USER });
        const res = await (await load())(post(), ctx(JOB));
        expect(res.status).toBe(403);
        expect(db.supabase.from).not.toHaveBeenCalled();
      }
      expect(statusRpc).not.toHaveBeenCalled();
    });

    it(`${name}: a bad id or another studio's job is not found, and nothing is written`, async () => {
      expect((await (await load())(post(), ctx("not-a-uuid"))).status).toBe(404);
      expect(scope).not.toHaveBeenCalled();
      const db = fakeDatabase({ jobs: [{ data: null }] });
      scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: USER });
      expect((await (await load())(post(), ctx(JOB))).status).toBe(404);
      expect(db.ops).toContainEqual(["jobs", "eq", ["studio_id", STUDIO]]);
      expect(statusRpc).not.toHaveBeenCalled();
    });

    it(`${name}: an owner or admin changes it for themselves, in the studio's region, and gets the job back`, async () => {
      for (const role of ["owner", "admin"]) {
        statusRpc.mockReset();
        statusRpc.mockResolvedValue({ data: "2026-10-12T12:00:00Z", error: null });
        const db = fakeDatabase({ jobs: [{ data: jobRow("draft") }, { data: jobRow("selling") }] });
        scope.mockResolvedValue({ supabase: db.supabase, studio: as(role), userId: USER });
        const res = await (await load())(post(), ctx(JOB));
        expect(res.status).toBe(200);
        expect((await res.json()).job).toMatchObject({
          id: JOB,
          status: "selling",
          closesAt: null,
        });
        expect(statusRpc).toHaveBeenCalledWith("ca", fn, USER, { p_job_id: JOB });
        expect(
          db.ops.filter(([, op, args]) => op === "eq" && args[0] === "studio_id"),
        ).toHaveLength(2);
      }
    });
  }

  const refuse = async (error: Record<string, unknown>) => {
    statusRpc.mockResolvedValue({ data: null, error });
    const db = fakeDatabase({ jobs: [{ data: jobRow("draft") }] });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: USER });
    const res = await (await import("./jobs/[id]/start-selling/route")).POST(post(), ctx(JOB));
    return { status: res.status, body: await res.json() };
  };

  it("names each missing item for the dialog, and only the ones it knows (A1)", async () => {
    const { status, body } = await refuse({
      code: "P0001",
      message: "not_ready",
      details: "roster,photos,tagging,price_list,payouts,Maya Johnson",
    });
    expect(status).toBe(409);
    expect(body.error.fields).toEqual({
      form: "jobs.notReady",
      roster: "jobs.sell.roster",
      photos: "jobs.sell.photos",
      tagging: "jobs.sell.tagging",
      priceList: "jobs.sell.priceList",
      payouts: "jobs.sell.payouts",
    });
    expect(JSON.stringify(body)).not.toContain("Maya");
    const one = await refuse({ code: "P0001", message: "not_ready", details: "payouts" });
    expect(one.body.error.fields).toEqual({ form: "jobs.notReady", payouts: "jobs.sell.payouts" });
  });

  it("turns the other named refusals into conflicts, and roles and unknown jobs as usual", async () => {
    const cases: [Record<string, unknown>, number, string | undefined][] = [
      [{ code: "P0001", message: "already_selling" }, 409, "jobs.alreadySelling"],
      [{ code: "P0001", message: "job_not_selling" }, 409, "jobs.notSelling"],
      [{ code: "P0001", message: "job_not_closed" }, 409, "jobs.notClosed"],
      [{ code: "P0001", message: "job_closed" }, 409, "jobs.closed"],
      [{ code: "P0002", message: "Job not found" }, 404, undefined],
      [{ code: "42501", message: "Owners and admins only" }, 403, undefined],
      [{ code: "P0001", message: "something_else" }, 500, undefined],
    ];
    for (const [error, status, form] of cases) {
      const res = await refuse(error);
      expect([res.status, res.body.error.fields?.form]).toEqual([status, form]);
      // The database's own names never reach the screen.
      if (/^[a-z_]+$/.test(String(error.message)))
        expect(res.body.error.message).not.toContain(String(error.message));
    }
  });
});

describe("PATCH /jobs/:id closing date", () => {
  const patch = async (
    status: string,
    body: unknown,
    update: { data?: unknown; error?: unknown },
  ) => {
    const db = fakeDatabase({ jobs: [{ data: jobRow(status) }, update] });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: USER });
    const res = await (await import("./jobs/[id]/route")).PATCH(
      new Request("http://localhost/api/v1/jobs/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      ctx(JOB),
    );
    return { res, body: await res.json(), db };
  };
  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

  it("sets one in the future, sending closes_at only", async () => {
    const at = tomorrow();
    const { res, db } = await patch(
      "selling",
      { closesAt: at },
      { data: { ...jobRow("selling"), closes_at: at } },
    );
    expect(res.status).toBe(200);
    expect(db.ops).toContainEqual(["jobs", "update", [{ closes_at: at }]]);
  });

  it("refuses one in the past or over 400 days away, before writing", async () => {
    for (const at of [
      new Date(Date.now() - 60_000).toISOString(),
      new Date(Date.now() + 401 * 86_400_000).toISOString(),
    ]) {
      const { res, body, db } = await patch("draft", { closesAt: at }, {});
      expect(res.status).toBe(400);
      expect(body.error.fields).toEqual({ closesAt: "validation.closesAt" });
      expect(db.ops.some(([, op]) => op === "update")).toBe(false);
    }
  });

  it("refuses a date on a closed shop, but lets it be removed", async () => {
    const closed = await patch("closed", { closesAt: tomorrow() }, {});
    expect([closed.res.status, closed.body.error.fields.form]).toEqual([409, "jobs.closed"]);
    const removed = await patch("closed", { closesAt: null }, { data: jobRow("closed") });
    expect(removed.res.status).toBe(200);
  });

  it("maps the database's own refusals (a race with the clock or a close)", async () => {
    const late = await patch(
      "selling",
      { closesAt: tomorrow() },
      {
        error: { code: "P0001", message: "closes_at_invalid" },
      },
    );
    expect([late.res.status, late.body.error.fields]).toEqual([
      400,
      { closesAt: "validation.closesAt" },
    ]);
    const shut = await patch(
      "selling",
      { closesAt: tomorrow() },
      {
        error: { code: "P0001", message: "job_closed" },
      },
    );
    expect([shut.res.status, shut.body.error.fields.form]).toEqual([409, "jobs.closed"]);
  });

  it("never takes a status", async () => {
    const { res } = await patch("draft", { status: "selling" }, {});
    expect(res.status).toBe(400);
  });
});

describe("the bell (call 4): only the person's own, in their studio", () => {
  const signedIn = (
    answers: Record<string, { data?: unknown; error?: unknown; count?: number }[]>,
  ) => {
    const db = fakeDatabase(answers);
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("staff"), userId: USER });
    return db;
  };
  const scoped = (db: ReturnType<typeof fakeDatabase>) =>
    db.ops.filter(([t]) => t === "notifications");

  it("lists the 20 latest with words-free data, and the unread count", async () => {
    const db = signedIn({
      notifications: [
        {
          data: [
            {
              id: "n1",
              kind: "job_closed",
              created_at: "2026-10-12T12:00:00Z",
              read_at: null,
              data: { scheduled: true },
              job: { id: JOB, name: "Fall" },
            },
            { id: "n2", kind: "made_up", created_at: "x", read_at: null, data: {}, job: null },
            {
              id: "n3",
              kind: "photos_failed",
              created_at: "2026-10-12T11:00:00Z",
              read_at: "2026-10-12T11:30:00Z",
              data: { failed: "Maya" },
              job: { id: JOB, name: "Fall" },
            },
          ],
        },
        { count: 4 },
      ],
    });
    const res = await (await import("./notifications/route")).GET(
      new Request("http://localhost/api/v1/notifications"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unread).toBe(4);
    expect(body.notifications).toEqual([
      {
        id: "n1",
        kind: "job_closed",
        createdAt: "2026-10-12T12:00:00Z",
        readAt: null,
        job: { id: JOB, name: "Fall" },
        data: { scheduled: true },
      },
      {
        id: "n3",
        kind: "photos_failed",
        createdAt: "2026-10-12T11:00:00Z",
        readAt: "2026-10-12T11:30:00Z",
        job: { id: JOB, name: "Fall" },
        data: {},
      },
    ]);
    const ops = scoped(db);
    expect(
      ops.filter(([, op, a]) => op === "eq" && a[0] === "studio_id" && a[1] === STUDIO),
    ).toHaveLength(2);
    expect(
      ops.filter(([, op, a]) => op === "eq" && a[0] === "user_id" && a[1] === USER),
    ).toHaveLength(2);
    expect(ops).toContainEqual(["notifications", "limit", [20]]);
    expect(ops).toContainEqual(["notifications", "is", ["read_at", null]]);
  });

  it("counts the unread for the badge", async () => {
    const db = signedIn({ notifications: [{ count: 3 }] });
    const res = await (await import("./notifications/unread-count/route")).GET(
      new Request("http://localhost/api/v1/notifications/unread-count"),
    );
    expect(await res.json()).toEqual({ unread: 3 });
    expect(scoped(db)).toContainEqual(["notifications", "eq", ["user_id", USER]]);
    expect(scoped(db)).toContainEqual(["notifications", "eq", ["studio_id", STUDIO]]);
  });

  it("marks the named ones read, only if they are mine and unread", async () => {
    const id = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d50";
    const db = signedIn({ notifications: [{}, { count: 1 }] });
    const res = await (await import("./notifications/read/route")).POST(post({ ids: [id] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unread: 1 });
    const ops = scoped(db);
    expect(ops.some(([, op]) => op === "update")).toBe(true);
    expect(ops).toContainEqual(["notifications", "in", ["id", [id]]]);
    expect(ops).toContainEqual(["notifications", "eq", ["user_id", USER]]);
    expect(ops).toContainEqual(["notifications", "eq", ["studio_id", STUDIO]]);
    expect(ops).toContainEqual(["notifications", "is", ["read_at", null]]);
  });

  it("refuses more than 100 ids, or none, before writing", async () => {
    for (const ids of [
      [],
      Array.from({ length: 101 }, () => "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d50"),
    ]) {
      const db = signedIn({});
      const res = await (await import("./notifications/read/route")).POST(post({ ids }));
      expect(res.status).toBe(400);
      expect(db.supabase.from).not.toHaveBeenCalled();
    }
  });

  it("marks all of mine read, and no one else's", async () => {
    const db = signedIn({ notifications: [{}, { count: 0 }] });
    const res = await (await import("./notifications/read-all/route")).POST(post());
    expect(await res.json()).toEqual({ unread: 0 });
    const ops = scoped(db);
    expect(ops.some(([, op]) => op === "in")).toBe(false);
    expect(ops).toContainEqual(["notifications", "eq", ["user_id", USER]]);
    expect(ops).toContainEqual(["notifications", "eq", ["studio_id", STUDIO]]);
  });

  it("signed-out people get not_signed_in", async () => {
    scope.mockRejectedValue(new ApiError("not_signed_in", "Please sign in."));
    expect(
      (await (await import("./notifications/route")).GET(new Request("http://x"))).status,
    ).toBe(401);
    expect((await (await import("./notifications/read-all/route")).POST(post())).status).toBe(401);
  });
});

describe("GET /internal/cron/jobs", () => {
  const SECRET = "s".repeat(40);
  const cron = async (auth?: string) =>
    (await import("./internal/cron/jobs/route")).GET(
      new Request("https://x/api/v1/internal/cron/jobs", {
        headers: auth ? { authorization: auth } : {},
      }),
    );
  beforeEach(() => vi.stubEnv("CRON_SECRET", SECRET));

  it("refuses anyone without the cron secret", async () => {
    // The refusal is logged by name only (no secret, no request details); cleared below.
    const res = await cron();
    expect(res.status).toBe(401);
    expect((await cron(`Bearer ${"x".repeat(40)}`)).status).toBe(401);
    expect(systemRpc).not.toHaveBeenCalled();
    for (const spy of logs) spy.mockClear();
  });

  it("closes due shops a page at a time in each region with a database, then prunes", async () => {
    systemRpc.mockImplementation(async (_region: string, fn: string) =>
      fn === "close_due_jobs"
        ? {
            data:
              systemRpc.mock.calls.filter((c) => c[1] === "close_due_jobs").length === 1 ? 500 : 3,
            error: null,
          }
        : { data: 7, error: null },
    );
    const res = await cron(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ closedJobs: 503, prunedNotifications: 7 });
    expect(systemRpc.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      ["ca", "close_due_jobs", { p_limit: 500 }],
      ["ca", "close_due_jobs", { p_limit: 500 }],
      ["ca", "prune_notifications", { p_limit: 1000 }],
    ]);
  });

  it("refuses to work on Canadian data outside Montréal (D113)", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    const res = await cron(`Bearer ${SECRET}`);
    expect(res.status).toBe(422);
    expect(systemRpc).not.toHaveBeenCalled();
    for (const spy of logs) spy.mockClear();
  });
});
