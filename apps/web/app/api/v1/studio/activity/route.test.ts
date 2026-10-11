import { afterEach, describe, expect, it, vi } from "vitest";
import { JOB_ACTIVITY_TYPES } from "@/lib/activity";

// Job activity (D138; ADR 0013): a job of another studio is not found before any event is read, and a job's
// activity is filtered by its id and the job types. The scope and database are faked.
vi.mock("server-only", () => ({}));
const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));

const JOB = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const OWNER = { id: "studio-a", name: "A", slug: "a", region: "ca", role: "owner" };

type Call = { table: string; ops: [string, unknown[]][] };

/** A stand-in for the Supabase client that records each query and answers with `rows[table]`. */
function fakeDatabase(rows: Record<string, unknown>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: object = new Proxy(
      {},
      {
        get: (_target, prop: string) =>
          prop === "then"
            ? (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? null, error: null })
            : (...args: unknown[]) => {
                call.ops.push([prop, args]);
                return chain;
              },
      },
    );
    return chain;
  };
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  return { supabase: { from, rpc }, calls };
}

const get = async (query: string) =>
  (await import("./route")).GET(new Request(`http://localhost/api/v1/studio/activity${query}`));

afterEach(() => scope.mockReset());

describe("GET /studio/activity?jobId=", () => {
  it("answers not_found for a job that isn't the caller's studio's, and reads no events", async () => {
    const db = fakeDatabase({ jobs: null, events: [] });
    scope.mockResolvedValue({ supabase: db.supabase, studio: OWNER, userId: "u" });
    const res = await get(`?jobId=${JOB}`);
    expect(res.status).toBe(404);
    expect(db.calls.map((c) => c.table)).toEqual(["jobs"]);
    expect(db.calls[0]?.ops).toContainEqual(["eq", ["studio_id", "studio-a"]]);
    expect(db.calls[0]?.ops).toContainEqual(["eq", ["id", JOB]]);
  });

  it("filters the job's events by its id and the job activity types", async () => {
    const db = fakeDatabase({ jobs: { id: JOB }, events: [] });
    scope.mockResolvedValue({ supabase: db.supabase, studio: OWNER, userId: "u" });
    const res = await get(`?jobId=${JOB}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activity: [] });
    const events = db.calls.find((c) => c.table === "events");
    expect(events?.ops).toContainEqual(["eq", ["studio_id", "studio-a"]]);
    expect(events?.ops).toContainEqual(["eq", ["subject_id", JOB]]);
    expect(events?.ops).toContainEqual(["in", ["type", [...JOB_ACTIVITY_TYPES]]]);
  });

  it("refuses a job id that isn't an id, and staff", async () => {
    const db = fakeDatabase({});
    scope.mockResolvedValue({ supabase: db.supabase, studio: OWNER, userId: "u" });
    expect((await get("?jobId=Lincoln")).status).toBe(400);
    scope.mockResolvedValue({
      supabase: db.supabase,
      studio: { ...OWNER, role: "staff" },
      userId: "u",
    });
    expect((await get(`?jobId=${JOB}`)).status).toBe(403);
    expect(db.calls).toEqual([]);
  });
});
