import { afterEach, describe, expect, it, vi } from "vitest";

// One job with its whole checklist (D143; ADR 0017): the same studio-scoped facts query as the Jobs list, so the
// Overview and the list never disagree. The scope and database are faked.
vi.mock("server-only", () => ({}));
const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));

const STUDIO = "studio-a";
const JOB = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const ROW = {
  id: JOB,
  name: "Fall",
  type: "school",
  status: "draft",
  picture_day: "2030-05-01",
  internal_number: "JOB00001",
  subjects_expected: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  client: null,
};

function fakeDatabase(job: unknown, facts: unknown[]) {
  const ops: [string, unknown[]][] = [];
  const chain: object = new Proxy(
    {},
    {
      get: (_target, prop: string) =>
        prop === "then"
          ? (resolve: (v: unknown) => void) => resolve({ data: job, error: null })
          : (...args: unknown[]) => {
              ops.push([prop, args]);
              return chain;
            },
    },
  );
  const rpc = vi.fn().mockResolvedValue({ data: facts, error: null });
  return { supabase: { from: () => chain, rpc }, ops, rpc };
}

const get = async (query = "", id = JOB) =>
  (await import("./route")).GET(new Request(`http://localhost/api/v1/jobs/${id}${query}`), {
    params: Promise.resolve({ id }),
  });

afterEach(() => scope.mockReset());

describe("GET /jobs/:id", () => {
  it("returns the job's whole checklist from the studio-scoped facts", async () => {
    const db = fakeDatabase(ROW, [
      {
        job_id: JOB,
        children: 2,
        qr_eligible: 2,
        qr_with_card: 2,
        has_ready_photo: false,
        failed_photos: 0,
      },
    ]);
    scope.mockResolvedValue({
      supabase: db.supabase,
      studio: { id: STUDIO, role: "staff" },
      userId: "u",
    });
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).job.checklist).toEqual({
      milestone: "pictureDay",
      done: 3,
      total: 5,
      next: "pictureDay",
      tasks: [
        { key: "createJob", milestone: "setUp", done: true },
        { key: "addRoster", milestone: "setUp", done: true },
        { key: "printQrCards", milestone: "setUp", done: true },
        { key: "pictureDay", milestone: "pictureDay", done: false },
        { key: "uploadPhotos", milestone: "photosIn", done: false },
      ],
      onTrack: true,
    });
    expect(db.ops).toContainEqual(["eq", ["studio_id", STUDIO]]);
    expect(db.rpc).toHaveBeenCalledWith("job_checklist_facts", {
      p_studio_id: STUDIO,
      p_job_ids: [JOB],
    });
  });

  it("is not found for a job outside the studio, before any facts are read", async () => {
    const db = fakeDatabase(null, []);
    scope.mockResolvedValue({
      supabase: db.supabase,
      studio: { id: STUDIO, role: "owner" },
      userId: "u",
    });
    expect((await get()).status).toBe(404);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("refuses a ?today= more than a day from UTC", async () => {
    const db = fakeDatabase(ROW, []);
    scope.mockResolvedValue({
      supabase: db.supabase,
      studio: { id: STUDIO, role: "owner" },
      userId: "u",
    });
    expect((await get("?today=2000-01-01")).status).toBe(400);
  });
});
