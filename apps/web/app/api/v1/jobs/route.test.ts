import { afterEach, describe, expect, it, vi } from "vitest";

// The Jobs list's checklist progress (D143; ADR 0017): computed on the server from one facts query for the whole page,
// scoped to the caller's studio. The scope and database are faked.
vi.mock("server-only", () => ({}));
const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));

const STUDIO = "studio-a";
const row = (id: string, status: string, picture_day: string) => ({
  id,
  name: `Job ${id}`,
  type: "school",
  status,
  picture_day,
  internal_number: `JOB${id}`,
  subjects_expected: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  client: null,
});

function fakeDatabase(jobs: unknown[], facts: unknown[]) {
  const ops: [string, unknown[]][] = [];
  const chain: object = new Proxy(
    {},
    {
      get: (_target, prop: string) =>
        prop === "then"
          ? (resolve: (v: unknown) => void) => resolve({ data: jobs, error: null })
          : (...args: unknown[]) => {
              ops.push([prop, args]);
              return chain;
            },
    },
  );
  const rpc = vi.fn().mockResolvedValue({ data: facts, error: null });
  return { supabase: { from: () => chain, rpc }, ops, rpc };
}

afterEach(() => scope.mockReset());

describe("GET /jobs", () => {
  it("adds each job's checklist progress from one studio-scoped facts query", async () => {
    const db = fakeDatabase(
      [row("a", "draft", "2030-05-01"), row("b", "closed", "2026-01-01")],
      [
        {
          job_id: "a",
          children: 2,
          qr_eligible: 2,
          qr_with_card: 0,
          has_ready_photo: false,
          failed_photos: 0,
        },
      ],
    );
    scope.mockResolvedValue({
      supabase: db.supabase,
      studio: { id: STUDIO, name: "A", slug: "a", region: "ca", role: "staff" },
      userId: "u",
    });
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/v1/jobs"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs.map((j: { checklist: unknown }) => j.checklist)).toEqual([
      { milestone: "setUp", done: 2, total: 7, next: "printQrCards" },
      // Closed: it sold, so Start selling is ticked too (ADR 0021).
      { milestone: null, done: 3, total: 7, next: null },
    ]);
    expect(db.ops).toContainEqual(["eq", ["studio_id", STUDIO]]);
    expect(db.rpc).toHaveBeenCalledOnce();
    expect(db.rpc).toHaveBeenCalledWith("job_checklist_facts", {
      p_studio_id: STUDIO,
      p_job_ids: ["a", "b"],
    });
  });

  it("lists only the jobs in a state with ?status= (Home's Jobs selling now, ADR 0021)", async () => {
    const db = fakeDatabase([row("a", "selling", "2030-05-01")], []);
    scope.mockResolvedValue({
      supabase: db.supabase,
      studio: { id: STUDIO, name: "A", slug: "a", region: "ca", role: "staff" },
      userId: "u",
    });
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/v1/jobs?status=selling&limit=5"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(
      body.jobs.map((j: { id: string; closesAt: string | null }) => [j.id, j.closesAt]),
    ).toEqual([["a", null]]);
    expect(db.ops).toContainEqual(["eq", ["studio_id", STUDIO]]);
    expect(db.ops).toContainEqual(["eq", ["status", "selling"]]);
    expect(db.ops).toContainEqual(["limit", [6]]);
    const bad = await GET(new Request("http://localhost/api/v1/jobs?status=live"));
    expect(bad.status).toBe(400);
  });

  it("filters by the Jobs chips and search within the caller's studio only (D147, D96)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const signIn = () => {
      const db = fakeDatabase([], []);
      scope.mockResolvedValue({
        supabase: db.supabase,
        studio: { id: STUDIO, name: "A", slug: "a", region: "ca", role: "photographer" },
        userId: "u",
      });
      return db;
    };
    const { GET } = await import("./route");
    const get = (query: string) => GET(new Request(`http://localhost/api/v1/jobs?${query}`));

    let db = signIn();
    expect((await get(`show=closingThisWeek&today=${today}`)).status).toBe(200);
    expect(db.ops[0]).toEqual(["select", [expect.any(String)]]);
    expect(db.ops).toContainEqual(["eq", ["studio_id", STUDIO]]);
    expect(db.ops).toContainEqual(["eq", ["status", "selling"]]);
    expect(db.ops.find(([op]) => op === "gt")?.[1][0]).toBe("closes_at");
    expect(db.ops.find(([op]) => op === "lte")?.[1][0]).toBe("closes_at");

    db = signIn();
    expect((await get(`show=pictureDayThisMonth&today=${today}`)).status).toBe(200);
    expect(db.ops).toContainEqual(["gte", ["picture_day", `${today.slice(0, 7)}-01`]]);
    expect(db.ops.find(([op]) => op === "lt")?.[1][0]).toBe("picture_day");
    expect(db.ops).toContainEqual(["eq", ["studio_id", STUDIO]]);

    db = signIn();
    const client = "c0000000-0000-4000-8000-000000000001";
    expect((await get(`clientId=${client}`)).status).toBe(200);
    expect(db.ops).toContainEqual(["eq", ["studio_id", STUDIO]]);
    expect(db.ops).toContainEqual(["eq", ["client_id", client]]);

    db = signIn();
    expect((await get(`q=${encodeURIComponent(' Lin"c,oln 50% ')}`)).status).toBe(200);
    expect(db.ops).toContainEqual(["eq", ["studio_id", STUDIO]]);
    // The name or the number, as one quoted pattern: commas and quotes stay literal, wildcards are escaped.
    expect(db.ops).toContainEqual([
      "or",
      ['name.ilike."%Lin\\"c,oln 50\\\\%%",internal_number.ilike."%Lin\\"c,oln 50\\\\%%"'],
    ]);

    signIn();
    expect((await get("clientId=Lincoln")).status).toBe(400);
    expect((await get("show=noOrdersYet")).status).toBe(400);
    expect((await get(`q=${"x".repeat(121)}`)).status).toBe(400);
  });

  it("refuses a ?today= more than a day away from the server's UTC date", async () => {
    const db = fakeDatabase([], []);
    scope.mockResolvedValue({
      supabase: db.supabase,
      studio: { id: STUDIO, name: "A", slug: "a", region: "ca", role: "owner" },
      userId: "u",
    });
    const { GET } = await import("./route");
    const far = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const res = await GET(new Request(`http://localhost/api/v1/jobs?today=${far}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.today).toBe("validation.invalid");
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
