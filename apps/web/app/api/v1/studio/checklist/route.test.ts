import { afterEach, describe, expect, it, vi } from "vitest";

// Home's checklist (D143; ADR 0017): onboarding for owners and admins until it is first complete (then recorded once),
// Up next for everyone else, every query scoped to the caller's studio, one facts query for all jobs. The scope and
// database are faked; the database's own scoping is covered by 011_one_checklist.test.sql.
vi.mock("server-only", () => ({}));
const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));

const STUDIO = "studio-a";
const as = (role: string, region = "ca") => ({ id: STUDIO, name: "A", slug: "a", region, role });

type Call = { table: string; ops: [string, unknown[]][] };

const utcDay = (offset = 0) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** A stand-in for the Supabase client: each table answers with `rows[table]` and `counts[table]`. */
function fakeDatabase(
  rows: Record<string, unknown>,
  counts: Record<string, number> = {},
  facts: unknown[] = [],
) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: object = new Proxy(
      {},
      {
        get: (_target, prop: string) =>
          prop === "then"
            ? (resolve: (v: unknown) => void) =>
                resolve({ data: rows[table] ?? null, count: counts[table] ?? null, error: null })
            : (...args: unknown[]) => {
                call.ops.push([prop, args]);
                return chain;
              },
      },
    );
    return chain;
  };
  const rpc = vi.fn().mockResolvedValue({ data: facts, error: null });
  return { supabase: { from, rpc }, calls, rpc };
}

const get = async (query = "") =>
  (await import("./route")).GET(new Request(`http://localhost/api/v1/studio/checklist${query}`));

afterEach(() => scope.mockReset());

const job = (id: string, pictureDay: string, status = "draft") => ({
  id,
  name: `Job ${id}`,
  type: "school",
  status,
  picture_day: pictureDay,
});
const fact = (job_id: string, over: Record<string, unknown> = {}) => ({
  job_id,
  children: 0,
  qr_eligible: 0,
  qr_with_card: 0,
  has_ready_photo: false,
  failed_photos: 0,
  ...over,
});

describe("GET /studio/checklist", () => {
  it("shows owners the setup checklist while it isn't complete, and writes nothing", async () => {
    const db = fakeDatabase(
      { studios: { onboarded_at: null, price_list_reviewed_at: null } },
      { jobs: 0 },
    );
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      onboarding: {
        tasks: [
          { key: "account", done: true },
          { key: "payouts", done: false },
          { key: "priceList", done: false },
          { key: "firstJob", done: false },
        ],
      },
      upNext: null,
    });
    expect(db.calls.some((c) => c.ops.some(([op]) => op === "update"))).toBe(false);
    // The team isn't part of onboarding (Seenu, answer 12): neither members nor invites are read.
    expect(db.calls.map((c) => c.table)).toEqual(["studios", "jobs", "payout_accounts"]);
    for (const c of db.calls)
      expect(c.ops).toContainEqual(["eq", [c.table === "studios" ? "id" : "studio_id", STUDIO]]);
  });

  it("ticks Set up payouts only when the payout account is Active, the same for every studio (ADR 0020; Seenu, Oct 12)", async () => {
    const tasksFor = async (studio: ReturnType<typeof as>, account: unknown) => {
      const db = fakeDatabase(
        {
          studios: { onboarded_at: null, price_list_reviewed_at: null },
          payout_accounts: account,
        },
        { jobs: 0 },
      );
      scope.mockResolvedValue({ supabase: db.supabase, studio, userId: "u" });
      return {
        tasks: (await (await get()).json()).onboarding.tasks,
        tables: db.calls.map((c) => c.table),
      };
    };
    for (const status of ["needs_info", "pending_verification", "restricted"])
      expect((await tasksFor(as("owner"), { status })).tasks[1]).toEqual({
        key: "payouts",
        done: false,
      });
    expect((await tasksFor(as("admin"), { status: "active" })).tasks[1]).toEqual({
      key: "payouts",
      done: true,
    });
    // A US studio (no payouts in its region yet) gets the same task, read the same way; it stays open.
    const us = await tasksFor(as("owner", "us"), null);
    expect(us.tasks.map((t: { key: string }) => t.key)).toEqual([
      "account",
      "payouts",
      "priceList",
      "firstJob",
    ]);
    expect(us.tasks[1]).toEqual({ key: "payouts", done: false });
    expect(us.tables).toContain("payout_accounts");
    expect((await tasksFor(as("owner", "us"), { status: "active" })).tasks[1]).toEqual({
      key: "payouts",
      done: true,
    });
  });

  it("ticks Review your price list from the database's stamp, and stays open without it (ADR 0019)", async () => {
    const reviewed = fakeDatabase(
      { studios: { onboarded_at: null, price_list_reviewed_at: "2026-10-12T00:00:00Z" } },
      { jobs: 0 },
    );
    scope.mockResolvedValue({ supabase: reviewed.supabase, studio: as("owner"), userId: "u" });
    expect((await (await get()).json()).onboarding.tasks).toEqual([
      { key: "account", done: true },
      { key: "payouts", done: false },
      { key: "priceList", done: true },
      { key: "firstJob", done: false },
    ]);
    // A job without a reviewed price list doesn't complete onboarding.
    const jobOnly = fakeDatabase(
      { studios: { onboarded_at: null, price_list_reviewed_at: null } },
      { jobs: 1 },
    );
    scope.mockResolvedValue({ supabase: jobOnly.supabase, studio: as("owner"), userId: "u" });
    expect((await (await get()).json()).onboarding.tasks).toEqual([
      { key: "account", done: true },
      { key: "payouts", done: false },
      { key: "priceList", done: false },
      { key: "firstJob", done: true },
    ]);
    expect(jobOnly.calls.some((c) => c.ops.some(([op]) => op === "update"))).toBe(false);
  });

  it("records the first completion once, then answers with Up next", async () => {
    const db = fakeDatabase(
      {
        studios: { onboarded_at: null, price_list_reviewed_at: "2026-10-12T00:00:00Z" },
        jobs: [],
        payout_accounts: { status: "active" },
      },
      { jobs: 1 },
    );
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("admin"), userId: "u" });
    const body = await (await get()).json();
    expect(body).toEqual({ onboarding: null, upNext: { items: [], total: 0 } });
    const update = db.calls.find((c) => c.ops.some(([op]) => op === "update"));
    expect(update?.table).toBe("studios");
    expect(update?.ops).toContainEqual(["eq", ["id", STUDIO]]);
    expect(update?.ops).toContainEqual(["is", ["onboarded_at", null]]);
  });

  it("never shows onboarding again once recorded", async () => {
    const db = fakeDatabase({ studios: { onboarded_at: "2026-10-01T00:00:00Z" }, jobs: [] });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    expect((await (await get()).json()).onboarding).toBeNull();
    expect(db.calls.map((c) => c.table)).toEqual(["studios", "jobs"]);
  });

  it("gives photographers and staff Up next without reading or writing onboarding", async () => {
    for (const role of ["photographer", "staff"]) {
      const db = fakeDatabase({ jobs: [] });
      scope.mockResolvedValue({ supabase: db.supabase, studio: as(role), userId: "u" });
      expect((await (await get()).json()).upNext).toEqual({ items: [], total: 0 });
      expect(db.calls.map((c) => c.table)).toEqual(["jobs"]);
    }
  });

  it("ranks at most one task per job, three shown, most urgent first, in one facts query", async () => {
    const soon = utcDay(3);
    const later = utcDay(60);
    const past = utcDay(-5);
    const db = fakeDatabase(
      {
        jobs: [
          job("a", later),
          job("b", soon),
          job("c", past, "selling"),
          job("d", later),
          job("e", later),
        ],
      },
      {},
      [
        fact("a"),
        fact("b", { children: 4, qr_eligible: 4 }),
        fact("c", { children: 2, qr_eligible: 2, qr_with_card: 2 }),
        fact("d", { children: 1, qr_eligible: 1, qr_with_card: 1, failed_photos: 2 }),
        fact("e"),
      ],
    );
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("photographer"), userId: "u" });
    const body = await (await get()).json();
    expect(body.upNext.total).toBe(5);
    expect(body.upNext.items).toEqual([
      {
        jobId: "c",
        jobName: "Job c",
        task: "uploadPhotos",
        reason: { kind: "photosOverdue", days: 5 },
      },
      {
        jobId: "b",
        jobName: "Job b",
        task: "printQrCards",
        reason: { kind: "dateClose", days: 3 },
      },
      {
        jobId: "d",
        jobName: "Job d",
        task: "reviewFailedPhotos",
        reason: { kind: "brokenPhotos", count: 2 },
      },
    ]);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("job_checklist_facts", {
      p_studio_id: STUDIO,
      p_job_ids: ["a", "b", "c", "d", "e"],
    });
    const jobs = db.calls.find((c) => c.table === "jobs");
    expect(jobs?.ops).toContainEqual(["in", ["status", ["draft", "selling"]]]);
  });

  it("counts days from the browser's day, and refuses a day more than one away from UTC", async () => {
    const db = fakeDatabase({ jobs: [job("a", utcDay(2))] }, {}, [fact("a")]);
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("staff"), userId: "u" });
    const body = await (await get(`?today=${utcDay(1)}`)).json();
    expect(body.upNext.items[0].reason).toEqual({ kind: "dateClose", days: 1 });
    expect((await get(`?today=${utcDay(3)}`)).status).toBe(400);
    expect((await get("?today=12-10-2026")).status).toBe(400);
  });

  it("skips jobs whose only open task is on the Overview itself (Picture day)", async () => {
    const db = fakeDatabase({ jobs: [job("a", utcDay(30))] }, {}, [
      fact("a", {
        children: 1,
        qr_eligible: 1,
        qr_with_card: 1,
        has_ready_photo: true,
        tagging_reviewed: true,
      }),
    ]);
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("staff"), userId: "u" });
    expect((await (await get()).json()).upNext).toEqual({ items: [], total: 0 });
  });

  it("ranks Leftovers and flagged photos as broken, like failed photos (ADR 0018, plan answer 9)", async () => {
    const db = fakeDatabase({ jobs: [job("a", utcDay(-30)), job("b", utcDay(-5))] }, {}, [
      fact("a", { children: 1, qr_eligible: 1, qr_with_card: 1, has_ready_photo: true }),
      fact("b", {
        children: 1,
        qr_eligible: 1,
        qr_with_card: 1,
        has_ready_photo: true,
        leftovers: 3,
        flagged: 1,
      }),
    ]);
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("staff"), userId: "u" });
    const items = (await (await get()).json()).upNext.items;
    expect(items.map((i: { jobId: string; task: string }) => [i.jobId, i.task])).toEqual([
      ["b", "reviewTagging"],
      ["a", "reviewTagging"],
    ]);
    expect(items[0].reason).toEqual({ kind: "taggingProblems", leftovers: 3, flagged: 1 });
    expect(items[1].reason).toEqual({ kind: "nextStep" });
  });

  it("warns with a count only when the active jobs are cut off", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const many = Array.from({ length: 1000 }, (_, i) => job(`j${i}`, utcDay(60)));
    const db = fakeDatabase({ jobs: many });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("staff"), userId: "u" });
    await get();
    expect(warn).toHaveBeenCalledWith("up_next_truncated", 1000);
    warn.mockRestore();
  });
});
