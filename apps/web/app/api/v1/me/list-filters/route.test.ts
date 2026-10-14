import { ApiError } from "@daybell/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Saved filter chips (D147, ADR 0026; D96 leak test): a person reads and saves only their own chips, in their own
// studio; a client, job or class named by a chip must be the studio's own (a class, the job's); refusals never repeat
// what was sent, and nothing is logged. The scope and the database are faked: each table answers with the rows that
// pass the filters the route applied, so a missing studio or person filter would leak another's rows here.
vi.mock("server-only", () => ({}));
const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "55555555-5555-4555-8555-555555555555";
const JOB_A = "a0000000-0000-4000-8000-000000000001";
const JOB_A2 = "a0000000-0000-4000-8000-000000000002";
const JOB_B = "b0000000-0000-4000-8000-000000000001";
const CLIENT_A = "c0000000-0000-4000-8000-00000000000a";
const CLIENT_B = "c0000000-0000-4000-8000-00000000000b";
const CLASS_A = "d0000000-0000-4000-8000-00000000000a";
const CLASS_A2 = "d0000000-0000-4000-8000-0000000000a2";

type Row = Record<string, unknown>;
const TABLES: Record<string, Row[]> = {
  jobs: [
    { id: JOB_A, studio_id: A },
    { id: JOB_A2, studio_id: A },
    { id: JOB_B, studio_id: B },
  ],
  clients: [
    { id: CLIENT_A, studio_id: A },
    { id: CLIENT_B, studio_id: B },
  ],
  job_groups: [
    { id: CLASS_A, studio_id: A, job_id: JOB_A },
    { id: CLASS_A2, studio_id: A, job_id: JOB_A2 },
  ],
  list_filter_chips: [
    // Mine, in order 2 then 1 (the route orders them), plus a key Jobs no longer takes.
    {
      studio_id: A,
      user_id: ME,
      page: "jobs",
      job_id: null,
      position: 2,
      filter_key: "client",
      filter_value: CLIENT_A,
    },
    {
      studio_id: A,
      user_id: ME,
      page: "jobs",
      job_id: null,
      position: 1,
      filter_key: "closingThisWeek",
      filter_value: null,
    },
    {
      studio_id: A,
      user_id: ME,
      page: "jobs",
      job_id: null,
      position: 3,
      filter_key: "retired",
      filter_value: null,
    },
    {
      studio_id: A,
      user_id: ME,
      page: "job_subjects",
      job_id: JOB_A,
      position: 1,
      filter_key: "noClass",
      filter_value: null,
    },
    // Another member's, and the same person's in another studio.
    {
      studio_id: A,
      user_id: OTHER,
      page: "jobs",
      job_id: null,
      position: 1,
      filter_key: "pictureDayThisMonth",
      filter_value: null,
    },
    {
      studio_id: B,
      user_id: ME,
      page: "jobs",
      job_id: null,
      position: 1,
      filter_key: "pictureDayThisMonth",
      filter_value: null,
    },
  ],
};

function fakeDatabase(rpcError: { code: string; message: string } | null = null) {
  const calls: unknown[][] = [];
  const from = (table: string) => {
    calls.push(["from", table]);
    const filters: ((row: Row) => boolean)[] = [];
    let order: string | null = null;
    let single = false;
    const rows = () => {
      const found = (TABLES[table] ?? []).filter((row) => filters.every((f) => f(row)));
      if (order) {
        const key = order;
        found.sort((x, y) => Number(x[key]) - Number(y[key]));
      }
      return found;
    };
    const builder = {
      select: (columns: string) => {
        calls.push([table, "select", columns]);
        return builder;
      },
      eq: (column: string, value: unknown) => {
        calls.push([table, "eq", column, value]);
        filters.push((row) => row[column] === value);
        return builder;
      },
      is: (column: string, value: unknown) => {
        calls.push([table, "is", column, value]);
        filters.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        calls.push([table, "in", column, values]);
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      order: (column: string) => {
        order = column;
        return builder;
      },
      maybeSingle: () => {
        single = true;
        return builder;
      },
      // biome-ignore lint/suspicious/noThenProperty: the fake mirrors Supabase's awaitable query builder.
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: single ? (rows()[0] ?? null) : rows(), error: null }),
    };
    return builder;
  };
  const rpc = vi.fn().mockResolvedValue({ data: null, error: rpcError });
  return { supabase: { from, rpc }, calls, rpc };
}

function signIn(studioId = A, rpcError: { code: string; message: string } | null = null) {
  const db = fakeDatabase(rpcError);
  scope.mockResolvedValue({
    supabase: db.supabase,
    studio: { id: studioId, name: "S", slug: "s", region: "ca", role: "photographer" },
    userId: ME,
  });
  return db;
}

const route = () => import("./route");
const get = async (query: string) =>
  (await route()).GET(new Request(`http://localhost/api/v1/me/list-filters?${query}`));
const put = async (body: unknown) =>
  (await route()).PUT(
    new Request("http://localhost/api/v1/me/list-filters", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  logs = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
});
afterEach(() => {
  for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  scope.mockReset();
});

describe("GET /me/list-filters", () => {
  it("gives the person their own chips for the list, in order, in their studio only", async () => {
    const db = signIn();
    const res = await get("page=jobs");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      chips: [
        { key: "closingThisWeek", value: null },
        { key: "client", value: CLIENT_A },
      ],
    });
    expect(db.calls).toContainEqual(["list_filter_chips", "eq", "studio_id", A]);
    expect(db.calls).toContainEqual(["list_filter_chips", "eq", "user_id", ME]);
    expect(db.calls).toContainEqual(["list_filter_chips", "is", "job_id", null]);
  });

  it("gives the same person nothing of another studio's", async () => {
    signIn(B);
    const res = await get("page=jobs");
    expect((await res.json()).chips).toEqual([{ key: "pictureDayThisMonth", value: null }]);
  });

  it("a job's tab needs the job, the studio's own", async () => {
    const db = signIn();
    expect((await (await get(`page=job_subjects&jobId=${JOB_A}`)).json()).chips).toEqual([
      { key: "noClass", value: null },
    ]);
    expect(db.calls).toContainEqual(["jobs", "eq", "studio_id", A]);
    expect(db.calls).toContainEqual(["list_filter_chips", "eq", "job_id", JOB_A]);
    expect((await get("page=job_subjects")).status).toBe(400);
    expect((await get(`page=jobs&jobId=${JOB_A}`)).status).toBe(400);
    expect((await get(`page=job_subjects&jobId=${JOB_B}`)).status).toBe(404);
    expect((await get("page=everything")).status).toBe(400);
  });
});

describe("PUT /me/list-filters", () => {
  it("saves the chips through save_list_filters, for the caller's studio", async () => {
    const db = signIn();
    const res = await put({
      page: "jobs",
      chips: [{ key: "closingThisWeek" }, { key: "client", value: CLIENT_A }],
    });
    expect(res.status).toBe(204);
    expect(db.calls).toContainEqual(["clients", "eq", "studio_id", A]);
    expect(db.rpc).toHaveBeenCalledWith("save_list_filters", {
      p_studio_id: A,
      p_page: "jobs",
      p_job_id: null,
      p_chips: [
        { key: "closingThisWeek", value: null },
        { key: "client", value: CLIENT_A },
      ],
    });
  });

  it("refuses another studio's client or job, and another job's class, without saying which", async () => {
    for (const body of [
      { page: "jobs", chips: [{ key: "client", value: CLIENT_B }] },
      { page: "orders", chips: [{ key: "job", value: JOB_B }] },
      { page: "job_subjects", jobId: JOB_A, chips: [{ key: "class", value: CLASS_A2 }] },
    ]) {
      const db = signIn();
      const res = await put(body);
      expect(res.status).toBe(400);
      const error = (await res.json()).error;
      expect(error.fields).toEqual({ chips: "validation.filterChips" });
      expect(JSON.stringify(error)).not.toMatch(/c0000000|b0000000|d0000000/);
      expect(db.rpc).not.toHaveBeenCalled();
    }
    const db = signIn();
    expect(
      (await put({ page: "job_subjects", jobId: JOB_A, chips: [{ key: "class", value: CLASS_A }] }))
        .status,
    ).toBe(204);
    expect(db.calls).toContainEqual(["job_groups", "eq", "job_id", JOB_A]);
    expect(db.calls).toContainEqual(["job_groups", "eq", "studio_id", A]);
  });

  it("refuses another studio's job for a job's tab, and keys the list doesn't take", async () => {
    let db = signIn();
    expect((await put({ page: "job_orders", jobId: JOB_B, chips: [] })).status).toBe(404);
    expect(db.rpc).not.toHaveBeenCalled();
    db = signIn();
    const res = await put({ page: "jobs", chips: [{ key: "grade", value: null }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ chips: "validation.filterChips" });
    expect(db.calls).toEqual([]);
  });

  it("asks who is calling before reading the body (S4)", async () => {
    scope.mockRejectedValue(new ApiError("not_signed_in", "Please sign in."));
    const res = await (await route()).PUT(
      new Request("http://localhost/api/v1/me/list-filters", { method: "PUT", body: "{ not json" }),
    );
    expect(res.status).toBe(401);
  });

  it("turns the database's own refusal into the same field error", async () => {
    signIn(A, { code: "22023", message: "list_filters_job" });
    const res = await put({ page: "jobs", chips: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ chips: "validation.filterChips" });
  });
});
