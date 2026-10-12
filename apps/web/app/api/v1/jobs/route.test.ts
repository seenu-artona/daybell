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
      { milestone: "setUp", done: 2, total: 6, next: "printQrCards" },
      { milestone: null, done: 2, total: 6, next: null },
    ]);
    expect(db.ops).toContainEqual(["eq", ["studio_id", STUDIO]]);
    expect(db.rpc).toHaveBeenCalledOnce();
    expect(db.rpc).toHaveBeenCalledWith("job_checklist_facts", {
      p_studio_id: STUDIO,
      p_job_ids: ["a", "b"],
    });
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
