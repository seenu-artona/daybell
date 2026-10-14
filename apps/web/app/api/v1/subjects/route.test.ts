import { afterEach, describe, expect, it, vi } from "vitest";

// People › Subjects (D150, D148, ADR 0028; D96 leak test): every child across the caller's studio's jobs, scoped by
// the studio from studioScope (never the request); a job or client of another studio finds nothing; order data only
// for people who see orders (photographers get null and can't filter by it, whatever the database says); search text
// travels in a POST body only (D113); Canadian studios' children are read in Montréal. The scope and the database are
// faked: the list function answers with the rows of the studio it was asked for, so a wrong studio would leak here.
vi.mock("server-only", () => ({}));
const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB_A1 = "a0000000-0000-4000-8000-000000000001";
const JOB_A2 = "a0000000-0000-4000-8000-000000000002";
const JOB_B = "b0000000-0000-4000-8000-000000000001";

const child = (
  id: string,
  studio: string,
  job: string,
  jobName: string,
  first: string,
  paid: boolean,
) => ({
  studio,
  row: {
    id,
    job_id: job,
    job_name: jobName,
    first_name: first,
    last_name: "Example",
    group_name: "Room 1",
    has_paid_order: paid,
  },
});
const CHILDREN = [
  child("c0000000-0000-4000-8000-000000000001", A, JOB_A1, "Lincoln Fall", "Ava", true),
  child("c0000000-0000-4000-8000-000000000002", A, JOB_A2, "Hillcrest Fall", "Ben", false),
  child("c0000000-0000-4000-8000-000000000003", B, JOB_B, "B Fall", "Bea", true),
];

function signIn(studioId: string, role = "owner", region = "ca") {
  const calls: unknown[][] = [];
  const rpc = (name: string, args: Record<string, unknown>) => {
    calls.push(["rpc", name, args]);
    const rows = CHILDREN.filter((c) => c.studio === args.p_studio_id)
      .map((c) => c.row)
      .filter((r) => !args.p_job_id || r.job_id === args.p_job_id)
      .filter((r) => args.p_show !== "ordered" || r.has_paid_order)
      .filter((r) => args.p_show !== "notOrdered" || !r.has_paid_order);
    return Promise.resolve({
      data: { subjects: rows, total: rows.length, jobs: new Set(rows.map((r) => r.job_id)).size },
      error: null,
    });
  };
  scope.mockResolvedValue({
    supabase: { rpc },
    studio: { id: studioId, name: "S", slug: "s", region, role },
    userId: "u",
  });
  return calls;
}

const get = async (query = "") => {
  const { GET } = await import("./route");
  const res = await GET(new Request(`http://localhost/api/v1/subjects${query}`));
  return { res, body: await res.json() };
};
const search = async (body: unknown) => {
  const { POST } = await import("./search/route");
  const res = await POST(
    new Request("http://localhost/api/v1/subjects/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { res, body: await res.json() };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /subjects (leak test)", () => {
  it("lists every child across the caller's studio's jobs, with the count of children and jobs", async () => {
    const calls = signIn(A);
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      subjects: [
        {
          id: "c0000000-0000-4000-8000-000000000001",
          firstName: "Ava",
          lastName: "Example",
          className: "Room 1",
          job: { id: JOB_A1, name: "Lincoln Fall" },
          hasPaidOrder: true,
        },
        {
          id: "c0000000-0000-4000-8000-000000000002",
          firstName: "Ben",
          lastName: "Example",
          className: "Room 1",
          job: { id: JOB_A2, name: "Hillcrest Fall" },
          hasPaidOrder: false,
        },
      ],
      nextCursor: null,
      total: 2,
      jobs: 2,
    });
    expect(calls).toEqual([
      [
        "rpc",
        "list_studio_children",
        {
          p_studio_id: A,
          p_q: null,
          p_show: null,
          p_job_id: null,
          p_client_id: null,
          p_after: null,
          p_limit: 51,
        },
      ],
    ]);
  });

  it("gives studio B nothing of studio A's, even asked for A's job by id", async () => {
    signIn(B);
    const { body } = await get(`?jobId=${JOB_A1}`);
    expect(body).toEqual({ subjects: [], nextCursor: null, total: 0, jobs: 0 });
  });

  it("filters by Ordered and Not ordered for owners, admins and staff (D148)", async () => {
    for (const role of ["owner", "admin", "staff"]) {
      signIn(A, role);
      expect(
        (await get("?show=ordered")).body.subjects.map((s: { firstName: string }) => s.firstName),
      ).toEqual(["Ava"]);
      expect(
        (await get("?show=notOrdered")).body.subjects.map(
          (s: { firstName: string }) => s.firstName,
        ),
      ).toEqual(["Ben"]);
    }
  });

  it("gives photographers no order data, whatever the database says, and no order filter", async () => {
    const calls = signIn(A, "photographer");
    const { body } = await get();
    expect(body.subjects.map((s: { hasPaidOrder: unknown }) => s.hasPaidOrder)).toEqual([
      null,
      null,
    ]);
    const filtered = await get("?show=ordered");
    expect(filtered.res.status).toBe(403);
    expect(calls).toHaveLength(1);
  });

  it("takes no search text in the address", async () => {
    const calls = signIn(A);
    await get("?q=ava");
    expect(calls[0]?.[2]).toMatchObject({ p_q: null });
  });

  it("is read in Montréal for a Canadian studio", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    const calls = signIn(A, "owner", "ca");
    const { res } = await get();
    expect(res.status).toBe(422);
    expect(calls).toEqual([]);
    const route = await import("./route");
    expect(route.preferredRegion).toBe("yul1");
    expect((await import("./search/route")).preferredRegion).toBe("yul1");
  });
});

describe("POST /subjects/search (D113)", () => {
  it("searches the caller's studio with the name from the body", async () => {
    const calls = signIn(B);
    const { res, body } = await search({ q: "ava", jobId: JOB_A1 });
    expect(res.status).toBe(200);
    expect(body.subjects).toEqual([]);
    expect(calls[0]?.[2]).toMatchObject({ p_studio_id: B, p_q: "ava", p_job_id: JOB_A1 });
  });

  it("refuses the order filter to photographers here too", async () => {
    signIn(A, "photographer");
    const { res } = await search({ q: "ava", show: "notOrdered" });
    expect(res.status).toBe(403);
  });

  it("is refused outside Montréal for a Canadian studio, before the body is read", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    const calls = signIn(A, "owner", "ca");
    const { res } = await search({ q: "ava" });
    expect(res.status).toBe(422);
    expect(calls).toEqual([]);
  });
});
