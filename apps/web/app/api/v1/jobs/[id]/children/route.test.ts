import { afterEach, describe, expect, it, vi } from "vitest";

// The roster list's photo and order columns (D147, ADR 0026; D96 leak test): the job is looked up in the caller's
// studio only, so another studio's job is not found and its children never listed; photo counts reach everyone on
// the team; whether a child has a paid order reaches only those who see orders (never photographers, even if the
// database answered); Canadian rosters are read in Montréal like orders (D113). Scope, keys and database are faked.
vi.mock("server-only", () => ({}));
const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));
vi.mock("@/lib/access-codes", () => ({ accessCodeCryptoKeys: async () => ({}) }));
vi.mock("@/lib/roster", async (original) => {
  const real = await original<typeof import("@/lib/roster")>();
  return {
    ...real,
    // The code is decrypted elsewhere (lib/roster.test.ts); here it is a fixed stand-in.
    toChild: async (row: Parameters<typeof real.toChild>[0]) => ({
      id: row.id,
      jobId: row.job_id,
      group: null,
      firstName: row.first_name,
      lastName: row.last_name,
      studentId: null,
      grade: null,
      parentEmail: null,
      doNotPhotograph: false,
      doNotPublish: false,
      schoolProvided: false,
      accessCode: "K7QM-4XPA",
      duplicate: row.duplicate ?? false,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  };
});

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB_A = "a0000000-0000-4000-8000-000000000001";
const JOBS = [{ id: JOB_A, studio_id: A, status: "selling" }];
const child = (id: string, photo_count: number, has_paid_order: boolean | null) => ({
  id,
  job_id: JOB_A,
  group_id: null,
  first_name: "Ava",
  last_name: "Patel",
  student_id: null,
  grade: null,
  parent_email: null,
  do_not_photograph: false,
  do_not_publish: false,
  school_provided: false,
  access_code_ciphertext: "v1.x",
  duplicate: false,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  photo_count,
  has_paid_order,
});

function signIn(studioId: string, role: string, region = "ca") {
  const calls: unknown[][] = [];
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        calls.push([table, "eq", column, value]);
        filters.push([column, value]);
        return builder;
      },
      maybeSingle: async () => ({
        data:
          JOBS.find((j) => filters.every(([c, v]) => (j as Record<string, unknown>)[c] === v)) ??
          null,
        error: null,
      }),
    };
    return builder;
  };
  const rpc = vi.fn().mockResolvedValue({
    data: {
      children: [
        child("c0000000-0000-4000-8000-000000000001", 3, true),
        child("c0000000-0000-4000-8000-000000000002", 0, false),
      ],
      total: 2,
      duplicates: 0,
    },
    error: null,
  });
  scope.mockResolvedValue({
    supabase: { from, rpc },
    studio: { id: studioId, name: "S", slug: "s", region, role },
    userId: "u",
  });
  return { calls, rpc };
}

const list = async (jobId = JOB_A) =>
  (await import("./route")).GET(new Request(`http://localhost/api/v1/jobs/${jobId}/children`), {
    params: Promise.resolve({ id: jobId }),
  });

afterEach(() => {
  scope.mockReset();
  vi.unstubAllEnvs();
});

describe("GET /jobs/:id/children (D147)", () => {
  it("gives owners, admins and staff each child's photo count and paid order", async () => {
    for (const role of ["owner", "admin", "staff"]) {
      const db = signIn(A, role);
      const res = await list();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(
        body.children.map((c: { photoCount: number; hasPaidOrder: boolean | null }) => [
          c.photoCount,
          c.hasPaidOrder,
        ]),
      ).toEqual([
        [3, true],
        [0, false],
      ]);
      expect(db.calls).toContainEqual(["jobs", "eq", "studio_id", A]);
      expect(db.rpc).toHaveBeenCalledWith(
        "list_children",
        expect.objectContaining({ p_job_id: JOB_A }),
      );
    }
  });

  it("never gives photographers order data, even if the database did", async () => {
    signIn(A, "photographer");
    const body = await (await list()).json();
    expect(body.children.map((c: { photoCount: number }) => c.photoCount)).toEqual([3, 0]);
    expect(body.children.map((c: { hasPaidOrder: unknown }) => c.hasPaidOrder)).toEqual([
      null,
      null,
    ]);
  });

  it("says another studio's job is not found, and lists nothing of it", async () => {
    const db = signIn(B, "owner");
    const res = await list();
    expect(res.status).toBe(404);
    expect(db.calls).toContainEqual(["jobs", "eq", "studio_id", B]);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("reads a Canadian studio's roster in Montréal only (D113)", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = signIn(A, "owner", "ca");
    const res = await list();
    expect(res.status).toBe(422);
    expect(db.rpc).not.toHaveBeenCalled();
    const { preferredRegion } = await import("./route");
    expect(preferredRegion).toBe("yul1");
  });

  it("adds a child to a Canadian studio's roster in Montréal only too, before reading the body (D113)", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = signIn(A, "owner", "ca");
    const { POST } = await import("./route");
    const res = await POST(
      new Request(`http://localhost/api/v1/jobs/${JOB_A}/children`, {
        method: "POST",
        body: "{ not json",
      }),
      { params: Promise.resolve({ id: JOB_A }) },
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("region_unavailable");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
  });
});
